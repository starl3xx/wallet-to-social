import {
  getDb,
  socialGraph,
  socialGraphHistory,
  type SocialGraph,
  type NewSocialGraph,
  type NewSocialGraphHistory,
} from '@/db';
import { inArray, sql } from 'drizzle-orm';
import type { WalletSocialResult } from './types';

// Default staleness period in days
const STALE_AFTER_DAYS = 30;

/**
 * Calculate data quality score (0-100) based on sources and verification status
 * Higher scores indicate more reliable data
 */
function calculateQualityScore(
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
      case 'ens_onchain':
        score += 30;
        break;
      case 'neynar': // Neynar provides verified Farcaster data with linked socials
        score += 25;
        break;
      case 'web3bio': // Aggregated data - good but less direct
        score += 15;
        break;
      case 'manual': // Admin-verified data
        score += 35;
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
  // Twitter is considered verified if it comes from ENS onchain or manual verification
  return sources.some(
    (s) => s === 'ens' || s === 'ens_onchain' || s === 'manual'
  );
}

/**
 * Determine if Farcaster data is verified (from high-confidence source)
 */
function isFarcasterVerified(sources: string[]): boolean {
  // Farcaster is considered verified if it comes from Neynar (direct API) or manual
  return sources.some((s) => s === 'neynar' || s === 'manual');
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
 * Check if a result has at least one social account worth storing
 */
function hasAnySocialAccount(result: WalletSocialResult): boolean {
  return !!(
    result.twitter_handle ||
    result.farcaster ||
    result.lens ||
    result.github ||
    result.ens_name
  );
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
  // Remove 'cache' and 'graph' from permanent storage - only track actual API sources
  combined.delete('cache');
  combined.delete('graph');
  return Array.from(combined);
}

/**
 * Upsert wallet results into social_graph with merge logic
 * - Only stores wallets with at least one social account
 * - Merges new data with existing, never overwrites with empty values
 * - Updates follower counts and timestamps
 * - Sets data quality scores and verification flags
 * - Logs changes to audit trail
 */
export async function upsertSocialGraph(
  results: WalletSocialResult[]
): Promise<number> {
  const db = getDb();
  if (!db || results.length === 0) return 0;

  // Filter to only results with at least one social account
  const validResults = results.filter(hasAnySocialAccount);
  if (validResults.length === 0) return 0;

  const wallets = validResults.map((r) => r.wallet.toLowerCase());

  try {
    // Fetch existing records for merge
    const existing = await db
      .select()
      .from(socialGraph)
      .where(inArray(socialGraph.wallet, wallets));

    const existingMap = new Map(existing.map((e) => [e.wallet, e]));

    // Collect changes for audit logging
    const allChanges: Array<{
      wallet: string;
      changes: Array<{
        field: string;
        oldValue: string | null | undefined;
        newValue: string | null | undefined;
      }>;
      changeSource: string | null;
    }> = [];

    // Prepare upsert rows with merge logic
    const rows: NewSocialGraph[] = validResults.map((r) => {
      const walletLower = r.wallet.toLowerCase();
      const prev = existingMap.get(walletLower);

      // Calculate merged values
      const newTwitter = r.twitter_handle || prev?.twitterHandle || null;
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

      if (changes.length > 0) {
        // Use the primary source from the incoming data for the change source
        const changeSource = r.source?.[0] ?? null;
        allChanges.push({ wallet: walletLower, changes, changeSource });
      }

      return {
        wallet: walletLower,
        ensName: newEnsName,
        twitterHandle: newTwitter,
        twitterUrl: r.twitter_url || prev?.twitterUrl || null,
        farcaster: newFarcaster,
        farcasterUrl: r.farcaster_url || prev?.farcasterUrl || null,
        // Always update follower counts if we have new data
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
        // Quality metadata
        twitterVerified,
        farcasterVerified,
        dataQualityScore: qualityScore,
        lastVerificationAt: new Date(),
        staleAt: calculateStaleAt(),
      };
    });

    // Upsert in batches of 100
    let upserted = 0;
    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i, i + 100);

      await db
        .insert(socialGraph)
        .values(batch)
        .onConflictDoUpdate({
          target: socialGraph.wallet,
          set: {
            ensName: sql`COALESCE(EXCLUDED.ens_name, ${socialGraph.ensName})`,
            twitterHandle: sql`COALESCE(EXCLUDED.twitter_handle, ${socialGraph.twitterHandle})`,
            twitterUrl: sql`COALESCE(EXCLUDED.twitter_url, ${socialGraph.twitterUrl})`,
            farcaster: sql`COALESCE(EXCLUDED.farcaster, ${socialGraph.farcaster})`,
            farcasterUrl: sql`COALESCE(EXCLUDED.farcaster_url, ${socialGraph.farcasterUrl})`,
            fcFollowers: sql`COALESCE(EXCLUDED.fc_followers, ${socialGraph.fcFollowers})`,
            fcFid: sql`COALESCE(EXCLUDED.fc_fid, ${socialGraph.fcFid})`,
            lens: sql`COALESCE(EXCLUDED.lens, ${socialGraph.lens})`,
            github: sql`COALESCE(EXCLUDED.github, ${socialGraph.github})`,
            sources: sql`EXCLUDED.sources`,
            lastUpdatedAt: sql`EXCLUDED.last_updated_at`,
            lookupCount: sql`${socialGraph.lookupCount} + 1`,
            // Quality metadata updates
            twitterVerified: sql`EXCLUDED.twitter_verified OR ${socialGraph.twitterVerified}`,
            farcasterVerified: sql`EXCLUDED.farcaster_verified OR ${socialGraph.farcasterVerified}`,
            dataQualityScore: sql`GREATEST(EXCLUDED.data_quality_score, ${socialGraph.dataQualityScore})`,
            lastVerificationAt: sql`EXCLUDED.last_verification_at`,
            staleAt: sql`EXCLUDED.stale_at`,
          },
        });

      upserted += batch.length;
    }

    // Log changes to audit trail (fire and forget - don't block on this)
    Promise.all(
      allChanges.map((c) =>
        logHistoryChanges(c.wallet, c.changes, c.changeSource)
      )
    ).catch((error) => console.error('Audit log batch error:', error));

    return upserted;
  } catch (error) {
    console.error('Social graph upsert error:', error);
    return 0;
  }
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
    lens: record.lens ?? undefined,
    github: record.github ?? undefined,
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
        sql`${socialGraph.wallet} IN ${lowercaseWallets} AND ${socialGraph.lastUpdatedAt} > ${since}`
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
export async function getRecentManualEdits(
  limit = 10
): Promise<SocialGraph[]> {
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
        totalWallets: sql<number>`COUNT(*)::int`,
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
