import {
  getDb,
  supportsTransactions,
  socialGraph,
  socialGraphHistory,
  type SocialGraph,
  type NewSocialGraph,
  type NewSocialGraphHistory,
} from '@/db';
import { inArray, sql, gt, lt, and, or, isNotNull } from 'drizzle-orm';
import { asSourceList } from '@/lib/api-sources';
import type { WalletSocialResult } from './types';

// Default staleness period in days
const STALE_AFTER_DAYS = 30;

// How long a persisted negative ("checked, no socials found") suppresses
// re-checking. Wallets rarely gain a first social profile week to week, and a
// wrong negative self-heals at the window boundary, so a month is a reasonable
// trade between API spend and freshness.
// Exported because `app/privacy/page.tsx` states this period to the public, and
// a number written twice is a number that drifts.
export const NEGATIVE_RECHECK_DAYS = 30;

// Retry configuration for robust writes
const DEFAULT_MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 1000; // 1 second

// ============================================================================
// Quality Classification Types
// ============================================================================

// 'negative' means the wallet was checked recently and has no socials — trusted
// like 'high', but the trusted answer is "nothing here".
export type DataQuality =
  | 'high'
  | 'medium'
  | 'low'
  | 'stale'
  | 'missing'
  | 'negative';

export interface SocialGraphQualityResult {
  wallet: string;
  data: SocialGraph | null;
  quality: DataQuality;
  needsRefresh: boolean;
}

export interface UpsertResult {
  succeeded: number;
  failed: number;
  errors: string[];
}

// ============================================================================
// Quality-Aware Lookup Functions
// ============================================================================

/**
 * Get social graph data with quality classification for smart caching
 * Quality tiers:
 * - high: dataQualityScore >= 70 AND not stale → trust completely
 * - medium: has verified flags OR lookupCount > 3 → trust but consider refresh
 * - low: in DB but no verification → use as fallback
 * - stale: staleAt < now → needs API refresh
 * - missing: not in DB
 */
export async function getSocialGraphWithQuality(
  wallets: string[]
): Promise<Map<string, SocialGraphQualityResult>> {
  const db = getDb();
  const results = new Map<string, SocialGraphQualityResult>();

  // Initialize all wallets as missing
  for (const wallet of wallets) {
    results.set(wallet.toLowerCase(), {
      wallet: wallet.toLowerCase(),
      data: null,
      quality: 'missing',
      needsRefresh: true,
    });
  }

  if (!db || wallets.length === 0) return results;

  const lowercaseWallets = wallets.map((w) => w.toLowerCase());
  const now = new Date();

  try {
    const rows = await db
      .select()
      .from(socialGraph)
      .where(inArray(socialGraph.wallet, lowercaseWallets));

    for (const record of rows) {
      const quality = classifyQuality(record, now);
      const isStale = record.staleAt != null && record.staleAt < now;
      // High-quality stale records are served but flagged for background refresh.
      // Fresh negatives never need refresh — expired ones classify as 'stale'.
      const needsRefresh =
        quality !== 'negative' &&
        (quality === 'stale' ||
          quality === 'low' ||
          quality === 'missing' ||
          isStale);

      results.set(record.wallet, {
        wallet: record.wallet,
        data: record,
        quality,
        needsRefresh,
      });
    }

    return results;
  } catch (error) {
    console.error('Social graph quality lookup error:', error);
    return results;
  }
}

/**
 * Classify the quality of a social graph record.
 * Quality score takes precedence over staleness — high-quality data is still
 * trustworthy when stale (wallet-to-social mappings rarely change). The
 * needsRefresh flag in getSocialGraphWithQuality handles background refresh.
 */
function classifyQuality(record: SocialGraph, now: Date): DataQuality {
  const isStale = record.staleAt != null && record.staleAt < now;

  // Persisted negative: checked before, no socials found. Trust it while the
  // recheck window is open; after that, treat as stale so it re-resolves.
  if (!recordHasAnySocial(record)) {
    const checkedAt = record.lastCheckedAt;
    if (
      checkedAt != null &&
      now.getTime() - checkedAt.getTime() <
        NEGATIVE_RECHECK_DAYS * 24 * 60 * 60 * 1000
    ) {
      return 'negative';
    }
    return 'stale';
  }

  // High quality: score >= 70 (verified sources like ENS onchain, Neynar, manual)
  // Serve even when stale — needsRefresh will trigger a background refresh
  if (record.dataQualityScore && record.dataQualityScore >= 70) {
    return 'high';
  }

  // Medium quality: has verified flags OR frequently looked up
  if (
    record.twitterVerified ||
    record.farcasterVerified ||
    (record.lookupCount && record.lookupCount > 3)
  ) {
    return isStale ? 'stale' : 'medium';
  }

  // Stale low-quality data should be refreshed
  if (isStale) {
    return 'stale';
  }

  // Low quality: in DB but no verification
  return 'low';
}

/**
 * Get wallets that need refresh (stale or frequently accessed)
 * Used by the background refresh cron job
 */
export async function getStaleWallets(
  limit: number = 100,
  minLookupCount: number = 5
): Promise<string[]> {
  const db = getDb();
  if (!db) return [];

  const now = new Date();

  try {
    const rows = await db
      .select({ wallet: socialGraph.wallet })
      .from(socialGraph)
      .where(
        and(
          lt(socialGraph.staleAt, now),
          gt(socialGraph.lookupCount, minLookupCount),
          // Never spend refresh-cron slots on persisted negatives — those
          // re-resolve on their own recheck window when actually looked up
          hasAnySocialSql()
        )
      )
      .orderBy(socialGraph.lookupCount)
      .limit(limit);

    return rows.map((r) => r.wallet);
  } catch (error) {
    console.error('Stale wallets query error:', error);
    return [];
  }
}

// ============================================================================
// Robust Write Operations with Retry and Transactions
// ============================================================================

/**
 * Sleep for a specified number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Upsert social graph with retry logic and detailed status reporting
 * Returns detailed status instead of just count to track failures
 */
export async function upsertSocialGraphWithRetry(
  results: WalletSocialResult[],
  maxRetries: number = DEFAULT_MAX_RETRIES
): Promise<UpsertResult> {
  const db = getDb();
  if (!db || results.length === 0) {
    return { succeeded: 0, failed: 0, errors: [] };
  }

  // Filter to only results with at least one social account
  const validResults = results.filter(hasAnySocialAccount);
  if (validResults.length === 0) {
    return { succeeded: 0, failed: 0, errors: [] };
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const count = await upsertSocialGraphWithTransaction(validResults);
      return { succeeded: count, failed: 0, errors: [] };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Log retry attempt
      console.warn(
        `Social graph upsert attempt ${attempt + 1}/${maxRetries} failed:`,
        lastError.message
      );

      // Don't retry on non-transient errors
      if (isNonTransientError(lastError)) {
        break;
      }

      // Exponential backoff: 1s, 2s, 4s
      if (attempt < maxRetries - 1) {
        const delay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
        await sleep(delay);
      }
    }
  }

  // All retries failed
  return {
    succeeded: 0,
    failed: validResults.length,
    errors: [lastError?.message || 'Unknown error after retries'],
  };
}

/**
 * Check if an error is non-transient (shouldn't retry)
 */
export function isNonTransientError(error: Error): boolean {
  /**
   * A bug in this process is never fixed by asking the database again.
   *
   * Both defects fixed on 2026-08-26 were classified as transient by the list
   * below and retried three times each, at one and two seconds of backoff, on
   * writes that could not have succeeded on any attempt: a `TypeError` from
   * `.some` on a string, and the neon-http driver refusing `transaction()`.
   * Neither message contains any of the words this function looks for.
   *
   * `TypeError` is the load-bearing half. It is raised by this code reaching
   * into a value of the wrong shape, so it is a statement about the program
   * rather than about the connection, and no amount of waiting changes it.
   */
  if (error instanceof TypeError) return true;

  const message = error.message.toLowerCase();
  // A driver that does not implement something will not implement it in a
  // second. Matched on the capability wording rather than on the driver name,
  // so it holds if the driver is swapped.
  if (message.includes('no transactions support')) return true;

  // Schema errors, constraint violations, etc. won't be fixed by retry
  return (
    message.includes('column') ||
    message.includes('constraint') ||
    message.includes('syntax') ||
    message.includes('does not exist') ||
    message.includes('duplicate key')
  );
}

/**
 * What the batch writer needs from whatever it is handed.
 *
 * Structural on purpose, and narrowed to `insert` alone: a transaction and the
 * connection itself agree on that method and on little else, and naming the
 * one capability used keeps the two callers below interchangeable without
 * either of them being cast.
 */
type TransactionLike = Pick<NonNullable<ReturnType<typeof getDb>>, 'insert'>;

/**
 * Upsert social graph data, atomically where the driver allows it
 * (see `supportsTransactions`)
 */
async function upsertSocialGraphWithTransaction(
  rawResults: WalletSocialResult[]
): Promise<number> {
  const db = getDb();
  if (!db) return 0;

  /**
   * `source` is normalised here, once, before anything reads it.
   *
   * The field is typed `string[]` and that type is a claim about data we did
   * not create: our own CSV export writes `source` as a comma-joined string,
   * and a customer who re-uploads that export sends the string back. Every
   * other surface already defends against it (`lib/job-processor.ts` on the
   * resume path, `app/page.tsx` and the admin table on the display paths); the
   * write path was the one that did not, and it is the path that persists.
   *
   * It failed two different ways on the same input, which is why the guard is
   * here rather than at each use. `isTwitterVerified(r.source ?? [])` threw
   * `.some is not a function` and killed the whole batch, recorded against a
   * real job on 2026-08-25. `mergeSources` failed more quietly on the same
   * value: `...(newSources ?? [])` spreads a string into single characters, so
   * a provenance list becomes `['w','e','b','3',…]` and is stored that way.
   * The loud one is the lucky case.
   *
   * `?? []` was never the right guard: it defends against null, and null was
   * not the shape that occurs.
   */
  const validResults: WalletSocialResult[] = rawResults.map((r) => ({
    ...r,
    source: asSourceList(r.source),
  }));

  const wallets = validResults.map((r) => r.wallet.toLowerCase());

  // Fetch existing records for merge
  const existing = await db
    .select()
    .from(socialGraph)
    .where(inArray(socialGraph.wallet, wallets));

  const existingMap = new Map(existing.map((e) => [e.wallet, e]));

  // Prepare upsert rows and audit records
  const { rows, auditRecords } = prepareUpsertData(validResults, existingMap);

  /**
   * The writes, run against whichever executor the caller has: a transaction
   * where the driver has one, the connection itself where it does not.
   *
   * Extracted so the two paths cannot diverge. The alternative was to write the
   * batch loop twice, and a second copy of an upsert with twenty-two conflict
   * clauses is a guarantee that one of them will drift.
   */
  const writeAll = async (tx: TransactionLike): Promise<number> => {
    let upserted = 0;

    // Upsert in batches of 100
    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i, i + 100);

      await tx
        .insert(socialGraph)
        .values(batch)
        .onConflictDoUpdate({
          target: socialGraph.wallet,
          set: {
            ensName: sql`COALESCE(EXCLUDED.ens_name, ${socialGraph.ensName})`,
            // The renamed_from guard again, at the SQL layer, because a row
            // that was not in existingMap (read before a concurrent resolve)
            // arrives here with the dead handle as EXCLUDED.
            twitterHandle: sql`CASE
              WHEN lower(EXCLUDED.twitter_handle) = lower(${socialGraph.twitterRenamedFrom}) THEN ${socialGraph.twitterHandle}
              ELSE COALESCE(EXCLUDED.twitter_handle, ${socialGraph.twitterHandle}) END`,
            twitterUrl: sql`CASE
              WHEN lower(EXCLUDED.twitter_handle) = lower(${socialGraph.twitterRenamedFrom}) THEN ${socialGraph.twitterUrl}
              ELSE COALESCE(EXCLUDED.twitter_url, ${socialGraph.twitterUrl}) END`,
            farcaster: sql`COALESCE(EXCLUDED.farcaster, ${socialGraph.farcaster})`,
            farcasterUrl: sql`COALESCE(EXCLUDED.farcaster_url, ${socialGraph.farcasterUrl})`,
            fcFollowers: sql`COALESCE(EXCLUDED.fc_followers, ${socialGraph.fcFollowers})`,
            fcFid: sql`COALESCE(EXCLUDED.fc_fid, ${socialGraph.fcFid})`,
            lens: sql`COALESCE(EXCLUDED.lens, ${socialGraph.lens})`,
            github: sql`COALESCE(EXCLUDED.github, ${socialGraph.github})`,
            sources: sql`EXCLUDED.sources`,
            lastUpdatedAt: sql`EXCLUDED.last_updated_at`,
            lookupCount: sql`${socialGraph.lookupCount} + 1`,
            twitterVerified: sql`EXCLUDED.twitter_verified OR ${socialGraph.twitterVerified}`,
            farcasterVerified: sql`EXCLUDED.farcaster_verified OR ${socialGraph.farcasterVerified}`,
            dataQualityScore: sql`GREATEST(EXCLUDED.data_quality_score, ${socialGraph.dataQualityScore})`,
            lastVerificationAt: sql`EXCLUDED.last_verification_at`,
            lastCheckedAt: sql`EXCLUDED.last_checked_at`,
            staleAt: sql`EXCLUDED.stale_at`,
            // Agent fields — use OR for booleans (COALESCE doesn't work since false is non-null)
            isAgent: sql`EXCLUDED.is_agent OR ${socialGraph.isAgent}`,
            agentName: sql`COALESCE(EXCLUDED.agent_name, ${socialGraph.agentName})`,
            agentFramework: sql`COALESCE(EXCLUDED.agent_framework, ${socialGraph.agentFramework})`,
            agentType: sql`COALESCE(EXCLUDED.agent_type, ${socialGraph.agentType})`,
            agentTokenSymbol: sql`COALESCE(EXCLUDED.agent_token_symbol, ${socialGraph.agentTokenSymbol})`,
            agentDetectionSource: sql`COALESCE(EXCLUDED.agent_detection_source, ${socialGraph.agentDetectionSource})`,
            agentVerified: sql`EXCLUDED.agent_verified OR ${socialGraph.agentVerified}`,
          },
        });

      upserted += batch.length;
    }

    // Insert audit records alongside the rows they describe
    if (auditRecords.length > 0) {
      // Batch audit records too
      for (let i = 0; i < auditRecords.length; i += 100) {
        const auditBatch = auditRecords.slice(i, i + 100);
        await tx.insert(socialGraphHistory).values(auditBatch);
      }
    }

    return upserted;
  };

  /**
   * Atomicity where the driver offers it, and the writes either way.
   *
   * This called `db.transaction()` unconditionally, which `neon-http` answers
   * with a throw rather than a fallback, so on any environment that does not
   * set `USE_CONNECTION_POOLING=true` every index write failed. Production sets
   * it and is unaffected; a local run, a preview, or a fresh deploy did not,
   * and `.env.example` never mentioned it, so the failure was invisible until
   * it showed up in `lookup_jobs.social_graph_write_errors`.
   *
   * Dropping to sequential writes is the right degradation, and it is worth
   * saying why rather than treating it as a compromise. Every statement here is
   * idempotent: the upsert is `onConflictDoUpdate` keyed on the wallet, and the
   * history rows are append-only. So a run interrupted halfway leaves a
   * prefix of the batch written, which the next lookup of those wallets
   * re-derives and re-writes. Against that, a throw leaves nothing written and
   * the same interruption costs the whole batch. Partial progress on an
   * idempotent write beats no progress.
   */
  if (supportsTransactions()) {
    return await db.transaction(async (tx) => writeAll(tx));
  }
  return await writeAll(db);
}

/**
 * Prepare upsert data and audit records
 */
function prepareUpsertData(
  validResults: WalletSocialResult[],
  existingMap: Map<string, SocialGraph>
): { rows: NewSocialGraph[]; auditRecords: NewSocialGraphHistory[] } {
  const auditRecords: NewSocialGraphHistory[] = [];

  const rows: NewSocialGraph[] = validResults.map((r) => {
    const walletLower = r.wallet.toLowerCase();
    const prev = existingMap.get(walletLower);

    // Calculate merged values.
    //
    // A handle equal to `twitterRenamedFrom` is the dead string a live source
    // (Farcaster, through a fresh resolve) still carries for a wallet whose
    // X account the conflict resolver has already moved. Taking it would put
    // the unreachable handle back and reopen the conflict, so the stored one
    // stays.
    const incomingTwitter =
      r.twitter_handle &&
      prev?.twitterRenamedFrom &&
      r.twitter_handle.toLowerCase() === prev.twitterRenamedFrom.toLowerCase()
        ? null
        : r.twitter_handle;
    const newTwitter = incomingTwitter || prev?.twitterHandle || null;
    const newFarcaster = r.farcaster || prev?.farcaster || null;
    const newEnsName = r.ens_name || prev?.ensName || null;
    const newLens = r.lens || prev?.lens || null;
    const newGithub = r.github || prev?.github || null;

    // Merge sources
    const mergedSources = mergeSources(r.source, prev?.sources);

    // Calculate quality metadata
    const qualityScore = calculateQualityScore(
      mergedSources,
      !!newTwitter,
      !!newFarcaster
    );
    const twitterVerified =
      prev?.twitterVerified || isTwitterVerified(r.source ?? []);
    const farcasterVerified =
      prev?.farcasterVerified || isFarcasterVerified(r.source ?? []);

    // Track changes for audit log
    const changes: Array<{
      field: string;
      oldValue: string | null | undefined;
      newValue: string | null | undefined;
    }> = [];

    if (prev?.twitterHandle !== newTwitter) {
      changes.push({
        field: 'twitter_handle',
        oldValue: prev?.twitterHandle,
        newValue: newTwitter,
      });
    }
    if (prev?.farcaster !== newFarcaster) {
      changes.push({
        field: 'farcaster',
        oldValue: prev?.farcaster,
        newValue: newFarcaster,
      });
    }
    if (prev?.ensName !== newEnsName) {
      changes.push({
        field: 'ens_name',
        oldValue: prev?.ensName,
        newValue: newEnsName,
      });
    }
    if (prev?.lens !== newLens) {
      changes.push({
        field: 'lens',
        oldValue: prev?.lens,
        newValue: newLens,
      });
    }
    if (prev?.github !== newGithub) {
      changes.push({
        field: 'github',
        oldValue: prev?.github,
        newValue: newGithub,
      });
    }

    // Add audit records for actual changes
    const changeSource = r.source?.[0] ?? null;
    for (const change of changes) {
      if (
        change.oldValue !== change.newValue &&
        (change.oldValue || change.newValue)
      ) {
        auditRecords.push({
          wallet: walletLower,
          fieldChanged: change.field,
          oldValue: change.oldValue ?? null,
          newValue: change.newValue ?? null,
          changeSource,
        });
      }
    }

    return {
      wallet: walletLower,
      ensName: newEnsName,
      twitterHandle: newTwitter,
      twitterUrl:
        (incomingTwitter && r.twitter_url) || prev?.twitterUrl || null,
      farcaster: newFarcaster,
      farcasterUrl: r.farcaster_url || prev?.farcasterUrl || null,
      fcFollowers: r.fc_followers ?? prev?.fcFollowers ?? null,
      fcFid:
        ((r as Record<string, unknown>).fc_fid as number | null) ??
        prev?.fcFid ??
        null,
      lens: newLens,
      github: newGithub,
      sources: mergedSources,
      firstSeenAt: prev?.firstSeenAt ?? new Date(),
      lastUpdatedAt: new Date(),
      lookupCount: (prev?.lookupCount ?? 0) + 1,
      twitterVerified,
      farcasterVerified,
      dataQualityScore: qualityScore,
      lastVerificationAt: new Date(),
      lastCheckedAt: new Date(),
      staleAt: calculateStaleAt(),
      // Agent fields — use || for booleans so false doesn't shadow a prior true
      isAgent: r.is_agent || prev?.isAgent || false,
      agentName: r.agent_name ?? prev?.agentName ?? null,
      agentFramework: r.agent_framework ?? prev?.agentFramework ?? null,
      agentType: r.agent_type ?? prev?.agentType ?? null,
      agentTokenSymbol: r.agent_token_symbol ?? prev?.agentTokenSymbol ?? null,
      agentDetectionSource: prev?.agentDetectionSource ?? null,
      agentVerified: r.agent_verified || prev?.agentVerified || false,
    };
  });

  return { rows, auditRecords };
}

/**
 * Calculate data quality score (0-100) based on sources and verification status
 * Higher scores indicate more reliable data
 */
/**
 * Exported so a repair can recompute a score rather than guess what it used to
 * be. Reimplementing this in SQL for the repair would have been the quick way
 * and would have given the repair its own opinion about trust.
 */
export function calculateQualityScore(
  sources: string[],
  hasTwitter: boolean,
  hasFarcaster: boolean
): number {
  let score = 0;

  // Base score for having data
  if (hasTwitter) score += 20;
  if (hasFarcaster) score += 20;

  // Source reliability bonuses
  for (const source of sources) {
    switch (source) {
      case 'ens': // Onchain ENS text records - highest confidence
        score += 30;
        break;
      case 'ens_onchain':
        // Same source class as 'ens' — must not stack with it, or
        // twitter(20) + ens(30) + ens_onchain(30) = 80 crosses the 70 trust
        // line for a wallet whose Farcaster side was never checked (same
        // de-stack rule as farcaster_sweep/neynar)
        if (!sources.includes('ens')) score += 30;
        break;
      case 'neynar': // Neynar provides verified Farcaster data with linked socials
        score += 25;
        break;
      case 'web3bio': // Aggregated data - good but less direct
        score += 15;
        break;
      case 'eas':
      case 'clanker':
      case 'ethos':
      case 'debank_tweet':
      case 'sybil_list':
      case 'snapshot_profile':
      case 'opensea_profile':
        // Attested sources where the owner established both halves: a wallet
        // signature plus an account sign-in, an onchain attestation issued after
        // the same proof, a token deploy the account itself requested, or a
        // bind-by-tweet flow posted from the account after a wallet connect.
        // Peers of a Farcaster verification, and scored the same.
        //
        // It DOES stack with 'farcaster_sweep', unlike the pairs above, and
        // that is deliberate rather than an oversight. Those de-stack because
        // they read the same underlying record twice. This is an independent
        // attestation of the same fact, so two of them really is more evidence
        // than one.
        score += 25;
        break;
      case 'manual': // Admin-verified data
        score += 35;
        break;
      case 'farcaster_sweep':
        // Protocol-wide bulk ingest — the same underlying data as 'neynar',
        // so it must not stack with it: farcaster(20) + neynar(25) +
        // sweep(25) = 70 would cross the trust line and mark a wallet
        // "fully known" when only its Farcaster side was ever checked
        // (e.g. a fast-mode lookup that skipped Web3Bio).
        if (!sources.includes('neynar')) score += 25;
        break;
      default:
        score += 5; // Unknown sources get minimal credit
    }
  }

  // Cap at 100
  return Math.min(100, score);
}

/**
 * Determine if Twitter data is verified (from high-confidence source)
 */
function isTwitterVerified(sources: string[]): boolean {
  // Twitter is considered verified when the owner established it themselves:
  // an onchain ENS record, a review by us, or an identity platform where they
  // signed with the wallet and signed in to the account.
  //
  // 'ethos' belongs here because the sweep writes twitter_verified = true for
  // the rows it fills. Leaving it out meant the next live lookup that merged
  // one of those rows would recompute the flag as false and silently unverify a
  // handle nothing had disproved. 'eas', 'clanker' and 'debank_tweet' are here
  // for exactly the same reason: every source ingested through
  // lib/attested-links.ts writes twitter_verified = true, so a recompute that
  // does not know the source replays the ethos bug.
  return sources.some(
    (s) =>
      s === 'ens' ||
      s === 'ens_onchain' ||
      s === 'manual' ||
      s === 'ethos' ||
      s === 'eas' ||
      s === 'clanker' ||
      s === 'debank_tweet' ||
      s === 'sybil_list' ||
      s === 'snapshot_profile' ||
      s === 'opensea_profile'
  );
}

/**
 * Determine if Farcaster data is verified (from high-confidence source)
 */
function isFarcasterVerified(sources: string[]): boolean {
  // Farcaster is considered verified if it comes from Neynar (direct API),
  // the protocol-wide bulk sweep (same underlying data), or manual entry
  return sources.some(
    (s) => s === 'neynar' || s === 'farcaster_sweep' || s === 'manual'
  );
}

/**
 * Calculate stale_at timestamp (default: 30 days from now)
 */
function calculateStaleAt(): Date {
  const staleAt = new Date();
  staleAt.setDate(staleAt.getDate() + STALE_AFTER_DAYS);
  return staleAt;
}

/**
 * Log a change to the social_graph_history table for audit trail
 */
async function logHistoryChange(
  wallet: string,
  fieldChanged: string,
  oldValue: string | null | undefined,
  newValue: string | null | undefined,
  changeSource: string | null
): Promise<void> {
  // Only log if there's an actual change
  if (oldValue === newValue) return;
  if (!oldValue && !newValue) return;

  const db = getDb();
  if (!db) return;

  try {
    const historyEntry: NewSocialGraphHistory = {
      wallet: wallet.toLowerCase(),
      fieldChanged,
      oldValue: oldValue ?? null,
      newValue: newValue ?? null,
      changeSource,
    };

    await db.insert(socialGraphHistory).values(historyEntry);
  } catch (error) {
    // Don't fail the main operation if history logging fails
    console.error('Social graph history log error:', error);
  }
}

/**
 * Log multiple field changes efficiently
 */
async function logHistoryChanges(
  wallet: string,
  changes: Array<{
    field: string;
    oldValue: string | null | undefined;
    newValue: string | null | undefined;
  }>,
  changeSource: string | null
): Promise<void> {
  const db = getDb();
  if (!db) return;

  // Filter to only actual changes
  const actualChanges = changes.filter(
    (c) => c.oldValue !== c.newValue && (c.oldValue || c.newValue)
  );

  if (actualChanges.length === 0) return;

  try {
    const historyEntries: NewSocialGraphHistory[] = actualChanges.map((c) => ({
      wallet: wallet.toLowerCase(),
      fieldChanged: c.field,
      oldValue: c.oldValue ?? null,
      newValue: c.newValue ?? null,
      changeSource,
    }));

    await db.insert(socialGraphHistory).values(historyEntries);
  } catch (error) {
    console.error('Social graph history batch log error:', error);
  }
}

/**
 * Check if a result has at least one social account worth storing.
 *
 * This predicate exists in three shapes (result-level, record-level, SQL) so
 * every reader and writer agrees on what counts as a positive row. Negative
 * rows — persisted "checked, nothing found" markers — are exactly the rows
 * these return false for. Keep the field sets identical.
 */
export function hasAnySocialAccount(result: WalletSocialResult): boolean {
  return !!(
    result.twitter_handle ||
    result.farcaster ||
    result.lens ||
    result.github ||
    result.ens_name
  );
}

/** Same predicate for a social_graph row. */
export function recordHasAnySocial(record: SocialGraph): boolean {
  return !!(
    record.twitterHandle ||
    record.farcaster ||
    record.lens ||
    record.github ||
    record.ensName
  );
}

/** Same predicate as a SQL condition for drizzle where clauses. */
export function hasAnySocialSql() {
  return or(
    isNotNull(socialGraph.twitterHandle),
    isNotNull(socialGraph.farcaster),
    isNotNull(socialGraph.lens),
    isNotNull(socialGraph.github),
    isNotNull(socialGraph.ensName)
  );
}

/**
 * Persist negative results: wallets that went through the full external
 * pipeline and came back with no socials. Storing that costs one row; NOT
 * storing it means re-buying the same API calls every time the wallet shows
 * up in a list (roughly 80% of a typical holder list resolves to nothing).
 *
 * Never touches social columns on conflict, so a negative re-check can't
 * erase an existing positive row — it only refreshes last_checked_at.
 */
export async function upsertNegativeWallets(
  wallets: string[]
): Promise<number> {
  const db = getDb();
  if (!db || wallets.length === 0) return 0;

  const now = new Date();
  let upserted = 0;

  for (let i = 0; i < wallets.length; i += 100) {
    const batch = wallets.slice(i, i + 100).map((w) => ({
      wallet: w.toLowerCase(),
      sources: ['none'],
      dataQualityScore: 0,
      lastCheckedAt: now,
      lastUpdatedAt: now,
      // Explicit, and from the same clock as the other two.
      //
      // Leaving it out let the column default to Postgres `now()`, which is the
      // transaction's start time and therefore later than this JS timestamp,
      // taken before the query was even sent. Every negative landed with
      // `first_seen_at` after its own `last_updated_at`: a row updated before it
      // existed, 28,000 times over. Harmless, and the sort of harmless that
      // makes a person distrust every other timestamp in the table.
      firstSeenAt: now,
    }));

    try {
      await db
        .insert(socialGraph)
        .values(batch)
        .onConflictDoUpdate({
          target: socialGraph.wallet,
          set: {
            lastCheckedAt: sql`EXCLUDED.last_checked_at`,
            lastUpdatedAt: sql`EXCLUDED.last_updated_at`,
            lookupCount: sql`${socialGraph.lookupCount} + 1`,
          },
        });
      upserted += batch.length;
    } catch (error) {
      // Non-fatal: a missed negative just means one redundant API call later
      console.error('Negative wallet upsert error:', error);
    }
  }

  return upserted;
}

/**
 * Merge source arrays, keeping unique values and removing 'cache'
 */
function mergeSources(
  newSources: string[] | undefined,
  existingSources: string[] | null | undefined
): string[] {
  const combined = new Set<string>([
    ...(existingSources ?? []),
    ...(newSources ?? []),
  ]);
  // Remove 'cache' and 'graph' from permanent storage - only track actual API
  // sources. 'none'/'graph:none' are negative markers — once a wallet gains
  // socials they'd otherwise leak into the positive row's sources (and give
  // calculateQualityScore an unearned bonus).
  combined.delete('cache');
  combined.delete('graph');
  combined.delete('none');
  combined.delete('graph:none');
  return Array.from(combined);
}

/**
 * Upsert wallet results into social_graph with merge logic
 * - Only stores wallets with at least one social account
 * - Merges new data with existing, never overwrites with empty values
 * - Updates follower counts and timestamps
 * - Sets data quality scores and verification flags
 * - Logs changes to audit trail
 *
 * @deprecated Use upsertSocialGraphWithRetry for new code - it provides
 * retry logic and transaction support for more reliable writes
 */
export async function upsertSocialGraph(
  results: WalletSocialResult[]
): Promise<number> {
  // Delegate to the retry-enabled version with 1 attempt for backward compatibility
  const result = await upsertSocialGraphWithRetry(results, 1);

  // Return count for backward compatibility (throws if result.failed > 0)
  if (result.failed > 0 && result.errors.length > 0) {
    throw new Error(result.errors[0]);
  }

  return result.succeeded;
}

/**
 * Get social graph data for wallets (used for enrichment after API calls)
 */
export async function getSocialGraphData(
  wallets: string[]
): Promise<Map<string, SocialGraph>> {
  const db = getDb();
  if (!db || wallets.length === 0) return new Map();

  const lowercaseWallets = wallets.map((w) => w.toLowerCase());

  try {
    const rows = await db
      .select()
      .from(socialGraph)
      .where(inArray(socialGraph.wallet, lowercaseWallets));

    return new Map(rows.map((r) => [r.wallet, r]));
  } catch (error) {
    console.error('Social graph read error:', error);
    return new Map();
  }
}

/**
 * Convert SocialGraph record to partial WalletSocialResult format for merging
 */
export function socialGraphToResult(
  record: SocialGraph
): Partial<WalletSocialResult> {
  return {
    ens_name: record.ensName ?? undefined,
    twitter_handle: record.twitterHandle ?? undefined,
    twitter_url: record.twitterUrl ?? undefined,
    farcaster: record.farcaster ?? undefined,
    farcaster_url: record.farcasterUrl ?? undefined,
    fc_followers: record.fcFollowers ?? undefined,
    fc_fid: record.fcFid ?? undefined,
    lens: record.lens ?? undefined,
    github: record.github ?? undefined,
    // Attestation, carried through so the UI can distinguish an identity the
    // owner published from one that was matched. Previously dropped here, which
    // left the client with no way to tell them apart.
    twitter_verified: record.twitterVerified ?? undefined,
    farcaster_verified: record.farcasterVerified ?? undefined,
    is_agent: record.isAgent ?? undefined,
    agent_name: record.agentName ?? undefined,
    agent_framework: record.agentFramework ?? undefined,
    agent_type: record.agentType ?? undefined,
    agent_token_symbol: record.agentTokenSymbol ?? undefined,
    agent_verified: record.agentVerified ?? undefined,
  };
}

/**
 * Upsert wallet with 'manual' source (admin enrichment)
 * This allows admins to manually add/edit social data for any wallet.
 * The 'manual' source takes precedence and is tracked separately.
 * Manual edits set verified flags and highest quality score.
 */
export async function upsertManualSocialGraph(
  wallet: string,
  data: { twitterHandle?: string; farcaster?: string; ensName?: string }
): Promise<SocialGraph | null> {
  const db = getDb();
  if (!db) return null;

  const walletLower = wallet.toLowerCase();

  try {
    // Fetch existing record to merge
    const existing = await db
      .select()
      .from(socialGraph)
      .where(sql`${socialGraph.wallet} = ${walletLower}`)
      .limit(1);

    const prev = existing[0];

    // Merge sources, adding 'manual' if not present
    const newSources = mergeSources(['manual'], prev?.sources);

    // Calculate merged values
    const newTwitter = data.twitterHandle || prev?.twitterHandle || null;
    const newFarcaster = data.farcaster || prev?.farcaster || null;
    const newEnsName = data.ensName || prev?.ensName || null;

    // Track changes for audit log
    const changes: Array<{
      field: string;
      oldValue: string | null | undefined;
      newValue: string | null | undefined;
    }> = [];

    if (data.twitterHandle && prev?.twitterHandle !== data.twitterHandle) {
      changes.push({
        field: 'twitter_handle',
        oldValue: prev?.twitterHandle,
        newValue: data.twitterHandle,
      });
    }
    if (data.farcaster && prev?.farcaster !== data.farcaster) {
      changes.push({
        field: 'farcaster',
        oldValue: prev?.farcaster,
        newValue: data.farcaster,
      });
    }
    if (data.ensName && prev?.ensName !== data.ensName) {
      changes.push({
        field: 'ens_name',
        oldValue: prev?.ensName,
        newValue: data.ensName,
      });
    }

    const row: NewSocialGraph = {
      wallet: walletLower,
      ensName: newEnsName,
      twitterHandle: newTwitter,
      twitterUrl: data.twitterHandle
        ? `https://x.com/${data.twitterHandle}`
        : prev?.twitterUrl || null,
      farcaster: newFarcaster,
      farcasterUrl: data.farcaster
        ? `https://warpcast.com/${data.farcaster}`
        : prev?.farcasterUrl || null,
      fcFollowers: prev?.fcFollowers ?? null,
      fcFid: prev?.fcFid ?? null,
      lens: prev?.lens || null,
      github: prev?.github || null,
      sources: newSources,
      firstSeenAt: prev?.firstSeenAt ?? new Date(),
      lastUpdatedAt: new Date(),
      lookupCount: (prev?.lookupCount ?? 0) + 1,
      // Manual edits get highest verification status
      twitterVerified: !!newTwitter,
      farcasterVerified: !!newFarcaster,
      dataQualityScore: 100, // Manual verification = highest confidence
      lastVerificationAt: new Date(),
      lastCheckedAt: new Date(),
      staleAt: calculateStaleAt(),
    };

    const [result] = await db
      .insert(socialGraph)
      .values(row)
      .onConflictDoUpdate({
        target: socialGraph.wallet,
        set: {
          ensName: sql`COALESCE(EXCLUDED.ens_name, ${socialGraph.ensName})`,
          twitterHandle: sql`COALESCE(EXCLUDED.twitter_handle, ${socialGraph.twitterHandle})`,
          twitterUrl: sql`COALESCE(EXCLUDED.twitter_url, ${socialGraph.twitterUrl})`,
          farcaster: sql`COALESCE(EXCLUDED.farcaster, ${socialGraph.farcaster})`,
          farcasterUrl: sql`COALESCE(EXCLUDED.farcaster_url, ${socialGraph.farcasterUrl})`,
          sources: sql`EXCLUDED.sources`,
          lastUpdatedAt: sql`EXCLUDED.last_updated_at`,
          lookupCount: sql`${socialGraph.lookupCount} + 1`,
          // Manual verification always sets highest quality
          twitterVerified: sql`EXCLUDED.twitter_verified OR ${socialGraph.twitterVerified}`,
          farcasterVerified: sql`EXCLUDED.farcaster_verified OR ${socialGraph.farcasterVerified}`,
          dataQualityScore: sql`100`,
          lastVerificationAt: sql`EXCLUDED.last_verification_at`,
          lastCheckedAt: sql`EXCLUDED.last_checked_at`,
          staleAt: sql`EXCLUDED.stale_at`,
        },
      })
      .returning();

    // Log changes to audit trail
    if (changes.length > 0) {
      logHistoryChanges(walletLower, changes, 'manual').catch((error) =>
        console.error('Manual edit audit log error:', error)
      );
    }

    return result;
  } catch (error) {
    console.error('Manual social graph upsert error:', error);
    // Re-throw to allow API to see actual error
    throw error;
  }
}

/**
 * Find wallets that have been updated/enriched since a given date
 * Used to show "new matches" notifications for users
 */
export async function getEnrichedWalletsSince(
  wallets: string[],
  since: Date
): Promise<string[]> {
  const db = getDb();
  if (!db || wallets.length === 0) return [];

  const lowercaseWallets = wallets.map((w) => w.toLowerCase());

  try {
    const rows = await db
      .select({ wallet: socialGraph.wallet })
      .from(socialGraph)
      .where(
        // The has-social clause keeps negative re-checks (which bump
        // last_updated_at without adding data) out of "new matches" badges
        sql`${socialGraph.wallet} IN ${lowercaseWallets} AND ${socialGraph.lastUpdatedAt} > ${since}
            AND (${socialGraph.twitterHandle} IS NOT NULL OR ${socialGraph.farcaster} IS NOT NULL
                 OR ${socialGraph.ensName} IS NOT NULL OR ${socialGraph.lens} IS NOT NULL
                 OR ${socialGraph.github} IS NOT NULL)`
      );

    return rows.map((r) => r.wallet);
  } catch (error) {
    console.error('Enriched wallets query error:', error);
    return [];
  }
}

/**
 * Get a single wallet from social_graph by address
 */
export async function getSocialGraphWallet(
  wallet: string
): Promise<SocialGraph | null> {
  const db = getDb();
  if (!db) return null;

  try {
    const rows = await db
      .select()
      .from(socialGraph)
      .where(sql`${socialGraph.wallet} = ${wallet.toLowerCase()}`)
      .limit(1);

    return rows[0] || null;
  } catch (error) {
    console.error('Social graph wallet lookup error:', error);
    return null;
  }
}

/**
 * Get recent manual edits from social_graph (for admin UI)
 */
export async function getRecentManualEdits(limit = 10): Promise<SocialGraph[]> {
  const db = getDb();
  if (!db) return [];

  try {
    const rows = await db
      .select()
      .from(socialGraph)
      .where(sql`'manual' = ANY(${socialGraph.sources})`)
      .orderBy(sql`${socialGraph.lastUpdatedAt} DESC`)
      .limit(limit);

    return rows;
  } catch (error) {
    console.error('Recent manual edits query error:', error);
    return [];
  }
}

/**
 * Get stats about the social graph
 * Uses COUNT aggregates instead of loading entire table for efficiency
 */
export async function getSocialGraphStats(): Promise<{
  totalWallets: number;
  withTwitter: number;
  withFarcaster: number;
  withLens: number;
  withGithub: number;
}> {
  const db = getDb();
  if (!db)
    return {
      totalWallets: 0,
      withTwitter: 0,
      withFarcaster: 0,
      withLens: 0,
      withGithub: 0,
    };

  try {
    // Use COUNT aggregates instead of loading entire table
    // This is ~99% faster for tables with 100K+ rows
    const result = await db
      .select({
        // Only positive rows — persisted negatives would otherwise inflate
        // the denominator every coverage ratio is computed against
        totalWallets: sql<number>`COUNT(*) FILTER (WHERE ${socialGraph.twitterHandle} IS NOT NULL OR ${socialGraph.farcaster} IS NOT NULL OR ${socialGraph.ensName} IS NOT NULL OR ${socialGraph.lens} IS NOT NULL OR ${socialGraph.github} IS NOT NULL)::int`,
        withTwitter: sql<number>`COUNT(*) FILTER (WHERE ${socialGraph.twitterHandle} IS NOT NULL)::int`,
        withFarcaster: sql<number>`COUNT(*) FILTER (WHERE ${socialGraph.farcaster} IS NOT NULL)::int`,
        withLens: sql<number>`COUNT(*) FILTER (WHERE ${socialGraph.lens} IS NOT NULL)::int`,
        withGithub: sql<number>`COUNT(*) FILTER (WHERE ${socialGraph.github} IS NOT NULL)::int`,
      })
      .from(socialGraph);

    return {
      totalWallets: result[0]?.totalWallets ?? 0,
      withTwitter: result[0]?.withTwitter ?? 0,
      withFarcaster: result[0]?.withFarcaster ?? 0,
      withLens: result[0]?.withLens ?? 0,
      withGithub: result[0]?.withGithub ?? 0,
    };
  } catch (error) {
    console.error('Social graph stats error:', error);
    return {
      totalWallets: 0,
      withTwitter: 0,
      withFarcaster: 0,
      withLens: 0,
      withGithub: 0,
    };
  }
}

/**
 * Push a manual correction out into the saved lookups that already show it.
 *
 * A completed lookup is normally a record of what was true when it ran, and
 * that is right: an exported list should not change under its owner. A MANUAL
 * correction is the one exception, because it exists only to say the stored
 * value was wrong. Leaving a known-wrong handle in place republishes an error
 * we have already agreed is an error.
 *
 * ## Both tables, because customers read the second one
 *
 * `lookup_jobs.partial_results` is the job record; `lookup_history.results` is
 * what a person reopens from Saved lookups, written when the job finishes.
 * Amending only the job leaves the customer-facing copy wrong while reporting
 * success, which is worse than not propagating at all.
 *
 * ## Values come from the merged graph row, not the request
 *
 * The caller passes the row `upsertManualSocialGraph` returned, so the saved
 * lookup ends up agreeing with the graph exactly. Taking them from the form
 * body instead would write a null for every field the editor left blank and
 * clear identities the edit never touched, where the upsert itself merges.
 */
export async function propagateManualCorrection(
  wallet: string,
  fields: {
    twitter_handle?: string | null;
    farcaster?: string | null;
    ens_name?: string | null;
  }
): Promise<number> {
  const db = getDb();
  if (!db) return 0;

  const walletLower = wallet.toLowerCase();
  const patch = Object.fromEntries(
    Object.entries(fields).filter(([, v]) => v !== undefined)
  );
  if (Object.keys(patch).length === 0) return 0;

  /**
   * A handle is not the only thing a stored row says about a handle.
   *
   * The saved row also carries `twitter_url`, `farcaster_url` and
   * `twitter_reachability`. The table links from the stored URL and strikes
   * through from the stored reachability, so replacing the handle alone leaves
   * a row that shows the corrected name, opens the OLD profile, and still reads
   * as dead. That is precisely the case this feature was built for, where the
   * superseded handle had already been stamped unreachable.
   */
  const nextTwitter =
    'twitter_handle' in patch
      ? (patch.twitter_handle as string | null)
      : undefined;
  const nextFarcaster =
    'farcaster' in patch ? (patch.farcaster as string | null) : undefined;
  if (nextTwitter !== undefined) {
    patch.twitter_url = nextTwitter ? `https://x.com/${nextTwitter}` : null;
  }
  if (nextFarcaster !== undefined) {
    patch.farcaster_url = nextFarcaster
      ? `https://warpcast.com/${nextFarcaster}`
      : null;
  }

  const match = JSON.stringify([{ wallet: walletLower }]);

  /** Rewrite one JSONB results array, returning null when nothing matched. */
  const amend = (
    rows: Array<Record<string, unknown>>
  ): Array<Record<string, unknown>> | null => {
    if (!Array.isArray(rows)) return null;
    let touched = false;
    const next = rows.map((row) => {
      if (typeof row?.wallet !== 'string') return row;
      if (row.wallet.toLowerCase() !== walletLower) return row;
      touched = true;

      const merged: Record<string, unknown> = { ...row, ...patch };

      /**
       * A new handle inherits no verdict from the old one.
       *
       * Reachability is a measurement of a specific handle. Carrying the
       * previous handle's result across a correction would keep striking the
       * row through and keep it out of the Twitter export, on evidence about a
       * name this wallet no longer uses. Cleared rather than guessed at: the
       * corrected handle is unchecked until the liveness sweep reaches it, and
       * unchecked renders neutral, which is the honest state.
       */
      const oldHandle =
        typeof row.twitter_handle === 'string' ? row.twitter_handle : null;
      const changed =
        nextTwitter !== undefined &&
        (oldHandle ?? '').toLowerCase() !== (nextTwitter ?? '').toLowerCase();
      if (changed) {
        merged.twitter_reachability = null;
        merged.twitter_reachability_checked_at = null;
        /**
         * Same for the second attested handle. It is a fact about the pair
         * (this handle and that one, both live), and a correction may well
         * have just made the pair one handle. The next lookup re-stamps it
         * from the conflicts table if it still applies.
         */
        merged.twitter_also = null;
      }
      return merged;
    });
    return touched ? next : null;
  };

  let amended = 0;
  try {
    /**
     * Containment rather than a scan: `@>` asks Postgres whether the array
     * holds an object with this wallet. A saved lookup can hold 10,000 rows, so
     * pulling every one into memory to look would not stay cheap.
     */
    const jobs = (await db.execute(sql`
      SELECT id, partial_results AS rows FROM lookup_jobs
      WHERE partial_results IS NOT NULL AND partial_results @> ${match}::jsonb
    `)) as unknown as {
      rows: Array<{ id: string; rows: Array<Record<string, unknown>> }>;
    };

    for (const job of jobs.rows) {
      const next = amend(job.rows);
      if (!next) continue;
      await db.execute(sql`
        UPDATE lookup_jobs SET partial_results = ${JSON.stringify(next)}::jsonb WHERE id = ${job.id}
      `);
    }

    const history = (await db.execute(sql`
      SELECT id, results AS rows FROM lookup_history
      WHERE results IS NOT NULL AND results @> ${match}::jsonb
    `)) as unknown as {
      rows: Array<{ id: string; rows: Array<Record<string, unknown>> }>;
    };

    for (const h of history.rows) {
      const next = amend(h.rows);
      if (!next) continue;
      await db.execute(sql`
        UPDATE lookup_history SET results = ${JSON.stringify(next)}::jsonb WHERE id = ${h.id}
      `);
      // Counted on the customer-facing table only, so the number the admin sees
      // is the number of saved lookups a person could actually reopen.
      amended++;
    }
    return amended;
  } catch (error) {
    /**
     * Never fails the correction itself. The graph write has already happened,
     * and a stale saved lookup is where we were before this existed.
     */
    console.error('propagateManualCorrection failed:', error);
    return amended;
  }
}
