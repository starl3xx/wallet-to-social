import { getDb } from '@/db';
import { lookupJobs } from '@/db/schema';
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import { batchFetchWeb3Bio } from '@/lib/web3bio';
import { batchFetchNeynar, type NeynarResult } from '@/lib/neynar';
import { batchLookupENS } from '@/lib/ens';
import { getCachedWallets, cacheWalletResults } from '@/lib/cache';
import { saveLookup, type InputSource } from '@/lib/history';
import { stampReachability, stampAlsoOnX } from '@/lib/handle-reachability';
import {
  upsertSocialGraphWithRetry,
  upsertNegativeWallets,
  getSocialGraphWithQuality,
  socialGraphToResult,
  type SocialGraphQualityResult,
} from '@/lib/social-graph';
import {
  findHoldingsColumn,
  parseHoldingsValue,
  calculatePriorityScore,
} from '@/lib/csv-parser';
import { trackEvent } from '@/lib/analytics';
import { chargeForJob } from '@/lib/credits';
import { ANON_MATCHES_PER_JOB } from '@/lib/match-gate';
import { detectKnownAgents, detectAgentFromBio } from '@/lib/agent-detection';
import { reconcileAgentClaim } from '@/lib/agent-claim';
import type { WalletSocialResult } from '@/lib/types';
import type { LookupJob } from '@/db/schema';
import type { UserTier } from '@/lib/access';
import { asSourceList } from '@/lib/api-sources';
import {
  loadSuppressionList,
  scrubResultRow,
  SUPPRESSION_KINDS,
} from '@/lib/suppression';

// Process up to this many wallets per cron invocation
const CHUNK_SIZE = 3000; // Increased from 2000 for faster throughput

/**
 * How long a claim holds a job, in seconds.
 *
 * Longer than any holder can live, which is the whole of the safety argument:
 * every route that calls `processJobChunk` declares a `maxDuration` below this
 * (asserted in `scripts/check-invariants.ts`), and it claims after its
 * invocation has started, so the platform has killed a holder before its lease
 * can run out. A lease that has run out therefore belongs to nobody. The 30
 * seconds over the 300-second routes cover a kill that is not instant and a
 * write already on the wire when it lands.
 *
 * The lease covers one slice, not the job: every exit hands it back, so the
 * next tick takes the job at once rather than waiting this out.
 */
export const LEASE_SECONDS = 330;

/**
 * Consecutive claims a job may take without handing back, before it fails.
 *
 * A slice the platform kills at maxDuration never reaches its catch or its
 * progress save, so nothing marks it failed and the next claim runs the same
 * slice again, for as long as the upstream that made it slow stays slow. Each
 * claim counts itself in `slice_attempts`, every handback resets it, and so a
 * run of kills is visible: each one halves the next slice (`sliceSizeFor`),
 * and the claim after the fifth fails the job, unbilled, with an answer the
 * caller can act on. Before STA-44 the Inngest run finished such jobs in
 * 500-wallet steps; this is what replaces that backstop.
 */
export const MAX_SLICE_ATTEMPTS = 5;

/** What a caller reads when a job used up its attempts. */
export const SLICES_EXHAUSTED =
  'This lookup ran out of time on every attempt and was stopped. Submit the list again.';

/**
 * What a caller reads when a job that has been charged used up its attempts
 * before its rows were saved: an admin rerun of a billed job under a
 * persistent error, or a job an invocation running older code charged before
 * saving anything. Never "submit again", which would bill the resubmission a
 * second time while this debit stands. An error line is logged beside it.
 */
export const BILLED_STOPPED =
  'Processing stopped after this lookup was charged. Contact help@walletlink.social for a rerun or a refund.';

/**
 * Wallets per slice on this claim: the full chunk first, then half after each
 * killed attempt, down to an eighth. Never zero, so the last attempts still
 * make progress.
 */
export function sliceSizeFor(attempts: number): number {
  return CHUNK_SIZE >> Math.min(Math.max(attempts - 1, 0), 3);
}

/**
 * How long, from the claim, the ENS pass may start new batches. The same kind
 * of bound Web3Bio has (`batchDeadlineMs`), so one slow RPC cannot hold a
 * slice past the invocation's end; wallets it never reached are recorded as
 * failed, never as negatives.
 */
export const ENS_SLICE_BUDGET_MS = 120_000;

/**
 * A write after the claim matched no row: another invocation holds the job
 * now, or it finished. The holder that sees this stops and writes nothing
 * more, including no 'failed' over a job someone else completed.
 */
export class LeaseLostError extends Error {
  constructor(jobId: string) {
    super(`Lost the lease on job ${jobId}; another invocation holds it`);
    this.name = 'LeaseLostError';
  }
}

/**
 * The WHERE of every write after the claim: this job, still under the token
 * this claim minted, and still running. Exported so scripts/check-invariants.ts
 * can render it.
 *
 * The lease alone cannot protect the writes. It is safe only while every
 * holder stops before it runs out, and a platform that suspends an invocation
 * rather than killing it (a shared process under Fluid compute, a frozen
 * instance thawed by the next request) can resume one afterwards. Its writes
 * then land on a job another invocation has claimed, advanced or completed:
 * a completed, billed job cut back to the stale holder's rows, or flipped to
 * failed by its catch. Matching on the token makes those writes match nothing.
 */
export function owned(jobId: string, token: string): SQL {
  return and(
    eq(lookupJobs.id, jobId),
    eq(lookupJobs.leaseToken, token),
    eq(lookupJobs.status, 'processing')
  )!;
}

/**
 * Every write to a job after its claim goes through here, and nothing else
 * writes it. Throws `LeaseLostError` when the row is no longer this claim's.
 */
async function writeOwned(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  job: Pick<LookupJob, 'id' | 'leaseToken'>,
  values: PgUpdateSetSource<typeof lookupJobs>
): Promise<void> {
  const rows = await db
    .update(lookupJobs)
    .set(values)
    .where(owned(job.id, job.leaseToken!))
    .returning({ id: lookupJobs.id });
  if (rows.length === 0) throw new LeaseLostError(job.id);
}

/**
 * Re-assert the claim and extend it, before a side effect that must not run
 * twice. A holder that lost the job stops here instead of charging, saving a
 * second history row or writing the graph again.
 */
async function renewLease(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  job: Pick<LookupJob, 'id' | 'leaseToken'>
): Promise<void> {
  await writeOwned(db, job, {
    leasedUntil: sql`now() + make_interval(secs => ${LEASE_SECONDS})`,
  });
}

/**
 * What stands behind a job that may forbid failing it with "submit again".
 *
 * `saved`: every row is saved and only finalize remains, so the next claim
 * finishes it from them. `billed`: a charge for this job has landed, read the
 * way `chargeForJob` writes it (one ledger row per job id, unlock rows
 * aside).
 *
 * The job id is bound as a parameter, never correlated through a column. The
 * first version wrote `${creditLedger.jobId} = ${lookupJobs.id}`, and Drizzle
 * renders a single-table select's columns unqualified, so the subquery read
 * `"job_id" = "id"` against credit_ledger's own columns and was never true.
 * Exported as a query so scripts/check-invariants.ts renders the exact SQL.
 */
export function completionStateQuery(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  jobId: string
) {
  return db
    .select({
      saved: sql<boolean>`${lookupJobs.processedCount} >= jsonb_array_length(${lookupJobs.wallets})`,
      billed: sql<boolean>`exists (select 1 from credit_ledger cl where cl.job_id = ${jobId}::uuid and cl.paid_from <> 'unlock')`,
    })
    .from(lookupJobs)
    .where(eq(lookupJobs.id, jobId))
    .limit(1);
}

async function completionState(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  jobId: string
): Promise<{ saved: boolean; billed: boolean }> {
  const [row] = await completionStateQuery(db, jobId);
  return { saved: Boolean(row?.saved), billed: Boolean(row?.billed) };
}

/**
 * A job nobody is working on right now. The one definition, read by the claim
 * and by the worker's candidate query, so the two cannot disagree. Exported
 * so scripts/check-invariants.ts can render it and read the SQL it produces.
 *
 * - A lease at or past now is free: handed back, or its holder is dead.
 * - No lease on a `pending` row: nothing has claimed it yet.
 * - No lease on a `processing` row: a holder from before leases existed,
 *   meaning the retired Inngest pipeline, or a worker invocation still running
 *   the old code through the deploy that shipped this. Nothing in the row says
 *   whether it is alive except `updated_at`, which both refresh as they go, so
 *   it is waited out for a lease's length from its last write. Nothing written
 *   since leases exist leaves a `processing` row without one.
 *
 * `updated_at` is a timestamp without time zone holding UTC, so it is compared
 * with UTC wall time rather than with `now()` through the session zone.
 */
export function claimable(): SQL {
  return sql`(
    ${lookupJobs.leasedUntil} <= now()
    OR (
      ${lookupJobs.leasedUntil} IS NULL
      AND (
        ${lookupJobs.status} = 'pending'
        OR ${lookupJobs.updatedAt} < (now() AT TIME ZONE 'UTC') - make_interval(secs => ${LEASE_SECONDS})
      )
    )
  )`;
}

/**
 * The row to resume from, or the row restarted from nothing when its saved
 * progress cannot be resumed.
 *
 * `processed_count` is a resume point only when `partial_results` holds every
 * wallet before it, which is what this worker writes: each slice initializes a
 * row for every wallet it takes, suppressed ones included, and the progress
 * save writes them all back. The retired Inngest pipeline wrote the count as a
 * count and saved no rows until it finished, so a job it left part-way (one in
 * flight at the deploy that retired it) would resume past wallets nobody
 * saved and complete without them. Such a row starts again at the first
 * wallet, with its counts zeroed so nothing is counted twice. Billing cannot
 * double either way: `chargeForJob` is keyed on the job id.
 *
 * Checked wallet by wallet rather than by comparing lengths, because a list
 * can repeat an address, and then the saved rows are legitimately fewer than
 * the count. Never throws: it runs before the failure handler exists.
 */
export function resumeFromSavedPrefix(job: LookupJob): LookupJob {
  if (job.processedCount <= 0) return job;
  const saved = new Set<unknown>(
    ((job.partialResults || []) as Array<WalletSocialResult | null>).map(
      (r) => r?.wallet
    )
  );
  const upTo = Math.min(job.processedCount, job.wallets.length);
  for (let i = 0; i < upTo; i++) {
    const w: unknown = job.wallets[i];
    if (!saved.has(typeof w === 'string' ? w.toLowerCase() : w)) {
      return {
        ...job,
        processedCount: 0,
        partialResults: null,
        twitterFound: 0,
        farcasterFound: 0,
        anySocialFound: 0,
        cacheHits: 0,
      };
    }
  }
  return job;
}

export interface JobOptions {
  /**
   * The browser session that started this job, when a browser did.
   *
   * Stored on the row so `lookup_completed`, emitted minutes later by a worker
   * that has only the job, can carry the same session as `lookup_started`.
   * Undefined for the seed cron and the public API, which have no visit behind
   * them.
   */
  sessionId?: string;
  includeENS?: boolean;
  fastMode?: boolean;
  saveToHistory?: boolean;
  historyName?: string;
  userId?: string;
  /**
   * The `users.id` to debit, set only when a signed-in account created the job.
   *
   * Separate from `userId`, which for an anonymous caller is a localStorage
   * value that a cleared cache resets. Guessing at uuid shape to tell them
   * apart would charge a ledger row to a string that is not an account, so the
   * caller states it instead: `/api/jobs` sets this from the session and
   * nowhere else can.
   */
  meteredUserId?: string;
  /**
   * The anonymous gate for THIS job, decided at submit time from the caller's
   * remaining daily allowance. Absent for a signed-in caller, and absent on
   * jobs created before the meter shipped, both of which fall back to the
   * per-job constant.
   */
  anonMatchGate?: number;
  tier?: UserTier;
  /**
   * Whether this job gets the paid result fields (priority score, Farcaster
   * follower counts). Set by `/api/jobs` from the credit entitlement or a
   * legacy tier, because a pack buyer's `tier` stays `free` and a tier check
   * here would strip from a paying customer exactly what the pack promised.
   * Jobs created before this field existed fall back to the tier check.
   */
  paidData?: boolean;
  canUseNeynar?: boolean;
  canUseENS?: boolean;
  inputSource?: InputSource;
  /** Contract behind a contract import, recorded for the admin Jobs table. */
  sourceContract?: {
    contractAddress: string;
    chain: string;
    tokenName?: string;
    tokenSymbol?: string;
    contractType?: string;
    totalHolders?: number;
    truncated?: boolean;
  };
}

/**
 * Whether this job's results carry the paid fields.
 *
 * One function because the answer is now needed twice and in two different
 * places in the pipeline: the priority score and the Farcaster count are
 * stripped mid-run, and the X follower count cannot be, because nothing has
 * fetched it yet at that point. Two hand-rolled copies of a rule that reads
 * `paidData ?? tier` is how one of them comes to disagree with the other,
 * and the direction it would fail is toward giving paid data away.
 */
export function jobGetsPaidFields(options: JobOptions): boolean {
  return (
    options.paidData ?? (options.tier === 'pro' || options.tier === 'unlimited')
  );
}

export interface ProcessResult {
  completed: boolean;
  processedCount: number;
  twitterFound: number;
  farcasterFound: number;
  anySocialFound: number;
  cacheHits: number;
  error?: string;
  /**
   * The claim found another holder's live lease, so nothing was done. Not an
   * error: the holder finishes the slice and the next tick takes the job.
   */
  busy?: boolean;
}

/**
 * Process a chunk of wallets for a job.
 *
 * The only lookup pipeline. Called by the cron worker every minute, and once
 * straight after submission by both job routes, inline for ten addresses or
 * fewer and through `after()` above that. Every caller goes through the claim
 * below, so no two of them ever work one job at once.
 */
export async function processJobChunk(jobId: string): Promise<ProcessResult> {
  const db = getDb();
  if (!db) {
    return {
      completed: true,
      processedCount: 0,
      twitterFound: 0,
      farcasterFound: 0,
      anySocialFound: 0,
      cacheHits: 0,
      error: 'Database not configured',
    };
  }

  /**
   * Claim by UPDATE, never by read-then-write.
   *
   * This read the row and then wrote `status = 'processing'` whatever it
   * found, so a second invocation arriving meanwhile (the next cron tick while
   * a slow slice still ran, or the Inngest pipeline this used to race) read
   * the same `processed_count` and worked the same wallets again: duplicate
   * provider calls, two finalizes, two history rows. One statement now does
   * the checking and the claiming, so there is no window between them, and a
   * holder's lease hides the row from every other claim until it is handed
   * back or runs out.
   */
  const [claimed] = await db
    .update(lookupJobs)
    .set({
      status: 'processing',
      startedAt: sql`coalesce(${lookupJobs.startedAt}, now() AT TIME ZONE 'UTC')`,
      leasedUntil: sql`now() + make_interval(secs => ${LEASE_SECONDS})`,
      leaseToken: sql`gen_random_uuid()`,
      sliceAttempts: sql`${lookupJobs.sliceAttempts} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(lookupJobs.id, jobId),
        inArray(lookupJobs.status, ['pending', 'processing']),
        claimable()
      )
    )
    .returning();

  if (!claimed) {
    // Not ours to work. Read what it is only to report it.
    const [row] = await db
      .select({
        status: lookupJobs.status,
        processedCount: lookupJobs.processedCount,
        twitterFound: lookupJobs.twitterFound,
        farcasterFound: lookupJobs.farcasterFound,
        anySocialFound: lookupJobs.anySocialFound,
        cacheHits: lookupJobs.cacheHits,
      })
      .from(lookupJobs)
      .where(eq(lookupJobs.id, jobId))
      .limit(1);

    if (!row) {
      return {
        completed: true,
        processedCount: 0,
        twitterFound: 0,
        farcasterFound: 0,
        anySocialFound: 0,
        cacheHits: 0,
        error: 'Job not found',
      };
    }

    const { status, ...stats } = row;
    if (status === 'completed' || status === 'failed') {
      return { completed: true, ...stats };
    }
    return { completed: false, busy: true, ...stats };
  }

  const job = resumeFromSavedPrefix(claimed);
  const sliceStartedAt = Date.now();

  try {
    /**
     * Past the cap. A job whose rows are all saved is finished from them
     * (it falls through to finalize below). Anything else stops here, and
     * the answer depends on whether it was charged: a billed job is never
     * told to submit again, because the debit stands and a resubmission
     * would be charged a second time.
     */
    if (job.sliceAttempts > MAX_SLICE_ATTEMPTS) {
      const { saved, billed } = await completionState(db, job.id);
      if (!saved) {
        const message = billed ? BILLED_STOPPED : SLICES_EXHAUSTED;
        if (billed) {
          console.error(
            `Job ${job.id} stopped after its charge landed, ${MAX_SLICE_ATTEMPTS} attempts without saving: needs a rerun or a refund`
          );
        }
        await writeOwned(db, job, {
          status: 'failed',
          errorMessage: message,
          updatedAt: new Date(),
          leasedUntil: sql`now()`,
          sliceAttempts: 0,
        });
        return {
          completed: true,
          processedCount: job.processedCount,
          twitterFound: job.twitterFound,
          farcasterFound: job.farcasterFound,
          anySocialFound: job.anySocialFound,
          cacheHits: job.cacheHits,
          error: message,
        };
      }
    }

    const options = job.options as JobOptions;
    const originalData = (job.originalData || {}) as Record<
      string,
      Record<string, string>
    >;
    const allWallets = job.wallets;
    const startIndex = job.processedCount;

    // Get chunk to process: smaller after each attempt the platform killed.
    const walletsToProcess = allWallets.slice(
      startIndex,
      startIndex + sliceSizeFor(job.sliceAttempts)
    );

    if (walletsToProcess.length === 0) {
      // All done - finalize job
      return await finalizeJob(db, job);
    }

    // Initialize or load partial results
    const results = new Map<string, WalletSocialResult>();
    const partialResults = (job.partialResults || []) as WalletSocialResult[];
    for (const r of partialResults) {
      // Normalised on the way in, because a row written before the spread
      // order above was corrected still carries a string here, and this job
      // may be a resume rather than a first run. Without it, the very next
      // `[...existing.source, 'cache']` spreads that string into characters.
      results.set(r.wallet, { ...r, source: asSourceList(r.source) });
    }

    // Detect holdings column
    const firstWallet = walletsToProcess[0]?.toLowerCase();
    const firstData = originalData[firstWallet] || {};
    const dataColumns = Object.keys(firstData);
    const holdingsColumn = findHoldingsColumn(dataColumns);

    // Initialize results for this chunk
    for (const wallet of walletsToProcess) {
      const walletLower = wallet.toLowerCase();
      if (!results.has(walletLower)) {
        const walletData = originalData[walletLower] || {};

        let holdings: number | undefined;
        if (holdingsColumn && walletData[holdingsColumn]) {
          holdings =
            parseHoldingsValue(walletData[holdingsColumn]) ?? undefined;
        }

        /**
         * The uploaded columns first, then the fields we own.
         *
         * This was the other way round, and a column name could therefore
         * overwrite a field the pipeline depends on. `source` is the one that
         * bites: our own CSV export writes it as a comma-joined string
         * (`ExportButton.tsx`), so a customer who exported results and
         * re-uploaded that file replaced `string[]` with `"web3bio,neynar"`.
         *
         * Nothing then threw. Every later stage does `[...existing.source,
         * 'cache']`, and spreading a string spreads its characters, so the
         * provenance for that job quietly became a list of letters.
         * `source.includes('neynar')` kept returning true by substring match,
         * and `source.length === 1 && source[0] === 'none'` started reading a
         * character count. The only surface loud enough to notice was the
         * admin job viewer, which calls `.map` and crashed.
         *
         * `wallet` and `holdings` had the same exposure: a `wallet` column
         * would have replaced the lowercased key everything else looks up by,
         * and a `holdings` column would have put the raw cell back over the
         * parsed number.
         *
         * Uploaded columns are still carried through for export. They simply
         * no longer win a collision with a field this function computed.
         */
        results.set(walletLower, {
          ...walletData,
          wallet: walletLower,
          source: [],
          holdings,
        });
      }
    }

    // =========================================================================
    // PRE-FLIGHT: the suppression filter. Runs before anything reads or
    // resolves, and it is load-bearing, not an optimisation.
    //
    // A suppressed wallet must never reach the external resolvers, because
    // asking an upstream about a person who asked us to stop is still
    // processing them. It must never touch wallet_cache or social_graph
    // reads either: after a backup restore, a deleted row can transiently
    // exist again, and this filter is what keeps it unserved until the next
    // write re-suppresses it. And it must never enter upsertNegativeWallets,
    // because the suppression trigger silently drops that write, which would
    // turn the one persisted "checked, nothing found" row into a fresh
    // external pipeline on every future lookup: re-collection moving from
    // monthly to per-lookup, for exactly the person who objected.
    //
    // Dropped wallets keep their initialised row above, so they surface in
    // the results as ordinary not-found rows (same shape as a wallet with no
    // record: the keys are absent and `source` stays empty) and, carrying no
    // handle, they count in no match stat and bill nothing.
    //
    // Fail closed: a failed list read throws and the job is marked failed,
    // unbilled, with "submit the list again" as the caller-facing answer.
    // Proceeding unfiltered is the one behaviour this feature cannot allow.
    // =========================================================================
    const suppression = await loadSuppressionList();
    const suppressedWallets = suppression.get('wallet')!;
    const activeWallets =
      suppressedWallets.size === 0
        ? walletsToProcess
        : walletsToProcess.filter(
            (w) => !suppressedWallets.has(w.toLowerCase())
          );

    const neynarApiKey = process.env.NEYNAR_API_KEY;
    let cacheHits = job.cacheHits;
    let graphHits = 0;
    let graphNegativeHits = 0;
    let uncachedWallets = activeWallets;

    // =========================================================================
    // STEP 0: Check known_agents table (highest confidence agent detection)
    // Pre-populate agent fields for known wallets before any API calls
    // =========================================================================
    /**
     * The agent's OWN X handle, kept past this block.
     *
     * STEP 0 runs before the social graph is read, so nothing here knows yet
     * what the address owner published. The reconciliation that decides
     * whether the agent claim survives that happens after STEP 1, and this map
     * is how it gets the one field it needs without a second query.
     */
    const agentOwnHandles = new Map<string, string | undefined>();

    try {
      const knownAgentResults = await detectKnownAgents(activeWallets);
      for (const [wallet, agentData] of knownAgentResults) {
        agentOwnHandles.set(wallet, agentData.agent_twitter_handle);
        const existing = results.get(wallet);
        if (existing) {
          results.set(wallet, {
            ...existing,
            is_agent: agentData.is_agent,
            agent_name: agentData.agent_name,
            agent_framework: agentData.agent_framework,
            agent_type: agentData.agent_type,
            agent_token_symbol: agentData.agent_token_symbol,
            agent_verified: agentData.agent_verified,
            /**
             * Copied like the rest. It was the one field `AgentDetectionResult`
             * carried that nothing ever read, so the column existed in two
             * tables, documented a four-value vocabulary, and held NULL on
             * every row ever written.
             */
            agent_detection_source: agentData.agent_detection_source,
          });
        }
      }
    } catch (error) {
      console.error('Known agents detection error:', error);
    }

    // =========================================================================
    // STEP 1: Check social_graph FIRST (primary data source)
    // High-quality records are trusted completely, reducing API calls
    // =========================================================================
    await updateJobStage(db, job, 'graph');

    const walletsNeedingLookup: string[] = [];
    try {
      const graphResults = await getSocialGraphWithQuality(activeWallets);

      for (const [wallet, graphResult] of graphResults) {
        const existing = results.get(wallet)!;

        if (graphResult.quality === 'negative') {
          // Persisted negative within its recheck window: this wallet was
          // already run through the full pipeline and has no socials. Skip
          // all API calls; the result stays empty. 'graph:none' (not 'graph')
          // so provenance doesn't claim data that was never found.
          results.set(wallet, {
            ...existing,
            source: [...existing.source, 'graph:none'],
          });
          graphNegativeHits++;
        } else if (
          graphResult.quality === 'high' &&
          graphResult.data &&
          !graphResult.needsRefresh
        ) {
          // Trust high-quality data completely - skip all API calls for this wallet
          results.set(wallet, mergeGraphRow(existing, graphResult.data));
          graphHits++;
        } else if (graphResult.quality === 'medium' && graphResult.data) {
          // Medium quality: use as base but still consider API refresh
          results.set(wallet, mergeGraphRow(existing, graphResult.data));
          // Medium quality still needs lookup to potentially refresh data
          walletsNeedingLookup.push(wallet);
        } else {
          // Low, stale, or missing - needs full lookup.
          //
          // The stored row is deliberately not applied on the normal path even
          // when one exists. Every field merges as `stored || existing`, so
          // seeding a stale value here would make the fresh answer lose to the
          // old one when the live pass returns.
          //
          // A fast scan has no live pass, and the same silence would hand back
          // an empty row for a wallet the index can answer for: a high-quality
          // record one day past its refresh window, or a low-confidence one.
          // "Answers from our index only" has to include those, so a fast scan
          // takes what is stored. The counters are left alone on purpose. They
          // measure how often the graph spared us a refresh, and this row still
          // wanted one.
          if (options.fastMode && graphResult.data) {
            results.set(wallet, mergeGraphRow(existing, graphResult.data));
          }
          walletsNeedingLookup.push(wallet);
        }
      }
    } catch (error) {
      console.error('Social graph lookup error:', error);
      // On error, fall back to looking up all non-suppressed wallets. Never
      // walletsToProcess: this fallback must not become the path that walks
      // a suppressed wallet into the external pipeline.
      walletsNeedingLookup.push(...activeWallets);
    }

    // Track social graph hit rate for this chunk
    if (graphHits > 0 || graphNegativeHits > 0) {
      trackEvent('social_graph_hit', {
        userId: options.userId || job.userId || undefined,
        metadata: {
          jobId: job.id,
          hitCount: graphHits,
          // Negative hits reported separately so hit-rate dashboards don't
          // conflate "served data" with "served a trusted empty answer"
          negativeHitCount: graphNegativeHits,
          totalWallets: walletsToProcess.length,
          hitRate: Math.round(
            ((graphHits + graphNegativeHits) / walletsToProcess.length) * 100
          ),
        },
      });
    }

    const misses = walletsNeedingLookup.length;
    if (misses > 0) {
      trackEvent('social_graph_miss', {
        userId: options.userId || job.userId || undefined,
        metadata: {
          jobId: job.id,
          missCount: misses,
          totalWallets: walletsToProcess.length,
        },
      });
    }

    // =========================================================================
    // STEP 2: Check cache for wallets that need lookup
    // =========================================================================
    await updateJobStage(db, job, 'cache');

    // Check cache for wallets not served by high-quality graph data.
    // Includes negative cache entries (source: ['none']) — wallets previously
    // checked with no social data found, so we skip redundant API calls.
    try {
      const cached = await getCachedWallets(walletsNeedingLookup);
      cacheHits += cached.size;

      for (const [wallet, data] of cached) {
        const isNegativeHit =
          data.source.length === 1 && data.source[0] === 'none';
        const existing = results.get(wallet)!;
        if (isNegativeHit) {
          // Negative cache: wallet was checked before with no results — skip APIs
          results.set(wallet, {
            ...existing,
            source: [...existing.source, 'cache'],
          });
        } else {
          results.set(wallet, mergeCacheRow(existing, data));
        }
      }

      uncachedWallets = walletsNeedingLookup.filter(
        (w) => !cached.has(w.toLowerCase())
      );
    } catch (error) {
      console.error('Cache error:', error);
      uncachedWallets = walletsNeedingLookup;
    }

    // =========================================================================
    // STEP 3: Call external APIs for remaining uncached wallets
    // ENS and Neynar run in parallel since they're independent. Web3Bio runs
    // after both, filtered to only wallets still missing Twitter.
    //
    // Fast mode stops before this step. It answers from the social graph and
    // the cache and nothing else: no live source is called, nothing is written
    // back, and no negative is persisted. That is what the interface now
    // promises ("answers from our index only"), and it is why a fast scan
    // costs the same whether the list holds 200 wallets or 200,000.
    //
    // It used to skip Web3Bio alone and still call Neynar, which made "fast"
    // an ambiguous middle: slower than an index read, cheaper than a real scan,
    // and impossible to describe to a user in one line. The sweep has since
    // taken Farcaster coverage to complete, so what that call added is, for the
    // most part, already in the graph the step above already read.
    // =========================================================================
    // Wallets whose external check failed (not "not found") — those must never
    // be persisted as negatives, or an API outage would poison the graph with
    // false "no socials" answers for the whole recheck window.
    const apiFailedWallets = new Set<string>();

    if (uncachedWallets.length > 0 && !options.fastMode) {
      const canUseNeynar = neynarApiKey && options.canUseNeynar !== false;
      const canUseENS = options.includeENS && options.canUseENS !== false;

      // Run ENS + Neynar in parallel (ENS is slow RPC, Neynar is fast batch)
      await updateJobStage(db, job, canUseENS ? 'ens' : 'neynar');

      const [ensResults, neynarResults] = await Promise.all([
        canUseENS
          ? batchLookupENS(uncachedWallets, undefined, undefined, undefined, {
              deadline: sliceStartedAt + ENS_SLICE_BUDGET_MS,
              failedWallets: apiFailedWallets,
            }).catch((error) => {
              console.error('ENS lookup error:', error);
              return new Map<
                string,
                {
                  ensName?: string;
                  twitter?: string;
                  twitterUrl?: string;
                  github?: string;
                }
              >();
            })
          : Promise.resolve(
              new Map<
                string,
                {
                  ensName?: string;
                  twitter?: string;
                  twitterUrl?: string;
                  github?: string;
                }
              >()
            ),
        canUseNeynar
          ? batchFetchNeynar(
              uncachedWallets,
              neynarApiKey,
              undefined,
              undefined,
              {
                failedWallets: apiFailedWallets,
              }
            ).catch((error) => {
              console.error('Neynar fetch error:', error);
              for (const w of uncachedWallets)
                apiFailedWallets.add(w.toLowerCase());
              return new Map<string, NeynarResult>();
            })
          : Promise.resolve(new Map<string, NeynarResult>()),
      ]);

      // Apply ENS results
      for (const [wallet, data] of ensResults) {
        const existing = results.get(wallet)!;
        results.set(wallet, {
          ...existing,
          ens_name: data.ensName || existing.ens_name,
          twitter_handle: data.twitter || existing.twitter_handle,
          twitter_url: data.twitterUrl || existing.twitter_url,
          github: data.github || existing.github,
          source: [...existing.source, 'ens'],
        });
      }

      // Apply Neynar results (including bio for agent detection)
      await updateJobStage(db, job, 'neynar');
      for (const [wallet, data] of neynarResults) {
        const existing = results.get(wallet)!;
        results.set(wallet, {
          ...existing,
          twitter_handle: existing.twitter_handle || data.twitter_handle,
          twitter_url: existing.twitter_url || data.twitter_url,
          farcaster: data.farcaster || existing.farcaster,
          farcaster_url: data.farcaster_url || existing.farcaster_url,
          fc_followers: data.fc_followers,
          fc_fid: data.fc_fid,
          fc_bio: data.fc_bio,
          /**
           * Attested, and recorded as such on the row that just learned it.
           *
           * This result came from `bulk-by-address`, which maps an address to
           * a Farcaster user through that user's VERIFIED addresses: the owner
           * proved the address on Farcaster, which is the definition the
           * attested sentence uses. The flag was previously only ever set by
           * the graph merge, so a first lookup of a wallet the index had never
           * seen carried the account without the attestation that produced it.
           *
           * That gap was not cosmetic. `lib/agent-claim.ts` withdraws an agent
           * claim when an attested identity contradicts it, and with the flag
           * absent the rule saw nothing to contradict anything: the badge
           * survived on exactly the rows where the evidence against it had just
           * arrived, and `prepareUpsertData` then wrote `is_agent` into a graph
           * whose OR can never take it back.
           */
          farcaster_verified: data.farcaster
            ? true
            : existing.farcaster_verified,
          source: existing.source.includes('neynar')
            ? existing.source
            : [...existing.source, 'neynar'],
        });
      }

      // Bio-based agent detection for wallets not already identified
      for (const [wallet, data] of neynarResults) {
        const existing = results.get(wallet);
        if (existing && !existing.is_agent && data.fc_bio) {
          const bioResult = detectAgentFromBio(data.fc_bio);
          if (bioResult) {
            results.set(wallet, {
              ...existing,
              is_agent: true,
              agent_verified: false,
              /**
               * Copied, like the catalog branch copies it. `detectAgentFromBio`
               * has always returned this and the merge always dropped it, so
               * every bio-keyword row stored NULL and was indistinguishable
               * from a catalog match written before the column was written at
               * all. Which is the whole reason the column was worth filling.
               */
              agent_detection_source: bioResult.agent_detection_source,
            });
          }
        }
      }

      // Filter wallets that still need Twitter lookup after ENS + Neynar
      const walletsNeedingWeb3Bio = uncachedWallets.filter((wallet) => {
        const existing = results.get(wallet.toLowerCase());
        return !existing?.twitter_handle;
      });

      // Run Web3Bio only for wallets without Twitter (slow — 1 request per wallet)
      if (walletsNeedingWeb3Bio.length > 0) {
        await updateJobStage(db, job, 'web3bio');
        const web3BioResults = await batchFetchWeb3Bio(
          walletsNeedingWeb3Bio,
          undefined,
          undefined,
          {
            failedWallets: apiFailedWallets,
          }
        );

        for (const [wallet, data] of web3BioResults) {
          const existing = results.get(wallet)!;
          results.set(wallet, {
            ...existing,
            ens_name: existing.ens_name || data.ens_name,
            twitter_handle: existing.twitter_handle || data.twitter_handle,
            twitter_url: existing.twitter_url || data.twitter_url,
            farcaster: data.farcaster || existing.farcaster,
            farcaster_url: data.farcaster_url || existing.farcaster_url,
            lens: data.lens || existing.lens,
            github: existing.github || data.github,
            source: existing.source.includes('web3bio')
              ? existing.source
              : [...existing.source, 'web3bio'],
          });
        }
      }

      // Cache looked-up wallets, including negative results ("not found").
      try {
        const walletsToCache = uncachedWallets
          .map((w) => {
            const wl = w.toLowerCase();
            /**
             * A wallet nobody reached is not a wallet with nothing (Bugbot,
             * 2026-08-25, High).
             *
             * `apiFailedWallets` already blocks the 30-day graph negative, and
             * the deadline adds every wallet it skips to it. It did not block
             * this one: a skipped wallet has no socials and no source, falls
             * into the `['none']` branch below, and is cached as "checked, has
             * nothing" for seven days. Later lookups read that and skip the
             * APIs, so the false negative outlives the incident that caused it
             * and no retry corrects it.
             *
             * Same failure the deadline was written to avoid, on the shorter
             * of the two TTLs, which is why guarding only the graph looked
             * complete.
             */
            if (apiFailedWallets.has(wl)) return null;
            const r = results.get(wl)!;
            if (r.source.includes('cache')) return null;
            const hasSocial =
              r.twitter_handle ||
              r.farcaster ||
              r.ens_name ||
              r.lens ||
              r.github;
            if (!hasSocial && r.source.length === 0) {
              return { ...r, source: ['none'] as string[] };
            }
            return r.source.length > 0 ? r : null;
          })
          .filter((r): r is WalletSocialResult => r !== null);

        if (walletsToCache.length > 0) {
          await cacheWalletResults(walletsToCache);
        }
      } catch (error) {
        console.error('Cache write error:', error);
      }

      // Persist negatives to the social graph so future lookups skip the APIs
      // entirely (the wallet_cache negative above only lives 7 days). Only
      // wallets that completed the full pipeline count: canUseNeynar=false
      // means Farcaster was never checked, and apiFailedWallets covers
      // per-batch/per-wallet API failures. A fast scan never reaches here.
      if (canUseNeynar) {
        const negativeWallets = uncachedWallets.filter((w) => {
          const wl = w.toLowerCase();
          if (apiFailedWallets.has(wl)) return false;
          const r = results.get(wl)!;
          const hasSocial =
            r.twitter_handle || r.farcaster || r.ens_name || r.lens || r.github;
          return !hasSocial && r.source.length === 0;
        });

        if (negativeWallets.length > 0) {
          try {
            await upsertNegativeWallets(negativeWallets);
          } catch (error) {
            console.error('Negative persistence error:', error);
          }
        }
      }
    }

    // Social graph enrichment is now done FIRST (see STEP 1 above)
    // This ensures we use high-quality cached data before calling external APIs

    /**
     * An owner-attested identity outranks a scraped agent claim.
     *
     * `known_agents` is scraped from a launch protocol's own API, whose
     * per-agent `walletAddress` is frequently the CREATOR's wallet. Measured
     * against production on 2026-09-19: of the 536 agent wallets that resolve
     * to an X handle, 492 carry an attested identity that is not the agent's
     * own. Left alone the table prints a badge reading `HOWLR` beside a wallet
     * whose owner published `@thedojieth`, which is an inference presented
     * over the top of the strongest evidence the index holds.
     *
     * ## Why it sits exactly here
     *
     * After STEP 1, 2 and 3, so every row has whatever socials it is going to
     * get, whether they came from the graph, the cache or a live call. It was
     * briefly moved inside STEP 3 to precede the cache write, and that put it
     * on the uncached path ONLY: a graph hit or a cache hit never reached it,
     * STEP 0 re-stamped `is_agent` from the catalog, `mergeGraphRow` kept that
     * stamp over a backfilled row, and finalize wrote the claim back and undid
     * the backfill. Coverage of every row is worth more than preceding the
     * cache write.
     *
     * Before the paid-field gate below, because that gate strips fields and
     * this reads none of them, and long before the graph write in finalize,
     * which is the write that matters: `social_graph` ORs `is_agent` and can
     * never take one back.
     *
     * ## What it means for `wallet_cache`
     *
     * The cache write in STEP 3 runs earlier, so a row whose claim is
     * withdrawn here was already cached carrying it, and `mergeCacheRow` ORs
     * it back on the next lookup. That is harmless rather than fine: every
     * path that serves a cached row merges it into `results` and then arrives
     * here, so the claim is withdrawn again before anything reads it, and
     * nothing serves `wallet_cache` directly. The cached value is a fact
     * about the catalog that this rule overrides on every pass. Moving the
     * cache write down here instead would need `apiFailedWallets` hoisted out
     * of STEP 3 and would put caching after the paid-field gate, which strips
     * `fc_followers` and would poison the cache for paying customers.
     */
    let agentClaimsWithdrawn = 0;
    for (const rawWallet of activeWallets) {
      /**
       * Lowercased on both lookups. `results` is keyed by
       * `wallet.toLowerCase()` and `agentOwnHandles` by the lowercase
       * `known_agents` row, while `activeWallets` carries whatever case the
       * customer's file had, so a mixed-case address missed both maps and
       * skipped withdrawal entirely.
       */
      const wallet = rawWallet.toLowerCase();
      const result = results.get(wallet);
      if (!result) continue;
      /**
       * CATALOG claims only, and an earlier version of this comment had the
       * reasoning exactly backwards.
       *
       * The defect this rule exists for is specific to `known_agents`: a
       * third party names an ADDRESS as an agent's, and that address is
       * frequently the creator's. A bio-keyword claim is not that. It is made
       * about the Farcaster account attached to THIS wallet, which the wallet
       * owner verified, so an attested Farcaster identity does not contradict
       * it, it IS its evidence.
       *
       * Reconciling bio claims therefore withdrew every one of them, and the
       * fix that set `farcaster_verified` on a fresh Neynar resolve is what
       * made it unconditional: bio detection runs after Neynar, so the flag is
       * always set by the time the claim exists, the wallet is never in
       * `agentOwnHandles`, and `agentClaimHolds` saw an attestation with no
       * matching handle every single time.
       *
       * Membership of the map is the test rather than the handle's value: the
       * map holds an entry for every catalog match, with `undefined` where the
       * catalog knows no account for the agent.
       */
      if (!agentOwnHandles.has(wallet)) continue;
      if (reconcileAgentClaim(result, agentOwnHandles.get(wallet))) {
        agentClaimsWithdrawn++;
        results.set(wallet, result);
      }
    }
    if (agentClaimsWithdrawn > 0) {
      console.log(
        `Agent claims withdrawn on ${agentClaimsWithdrawn} wallet(s): an attested identity said otherwise`
      );
    }

    // Priority scores and follower counts are paid result fields: any pack, or
    // a legacy tier. See JobOptions.paidData for why this is not a tier check.
    const isPaidTier = jobGetsPaidFields(options);
    for (const [wallet, result] of results) {
      if (!isPaidTier) {
        // Free accounts do not get the paid fields. `x_followers` is NOT
        // stripped here and that is not an omission: nothing has set it yet.
        // It arrives from `stampReachability`, which runs in
        // `finalizeJobWithResults`, long after this loop. It is stripped
        // there instead, beside the stamp that produces it.
        result.priority_score = undefined;
        result.fc_followers = undefined;
      } else {
        result.priority_score = calculatePriorityScore(
          result.holdings,
          result.fc_followers
        );
      }
      results.set(wallet, result);
    }

    /**
     * Scrub suppressed identifiers out of every in-flight row, before any
     * stat is counted and before the rows are written back to the job.
     *
     * The pre-flight above covers suppressed wallets, but a suppressed
     * HANDLE can still arrive here: a live resolve of some other,
     * unsuppressed wallet returns whatever the upstream still maps to it.
     * The triggers strip that from social_graph and wallet_cache on write,
     * but nothing guards the job row or the stats. Left in, the handle
     * would count into anySocialFound and be billed as a match that the
     * serve-time filter then hides, and it would persist inside
     * partial_results, which the per-removal amend has already run over.
     *
     * The whole map rather than this chunk, because the progress save below
     * writes the whole map back to partial_results: rows loaded from a
     * resume must not re-save a mapping a removal amended away mid-job.
     */
    if (SUPPRESSION_KINDS.some((k) => (suppression.get(k)?.size ?? 0) > 0)) {
      for (const [wallet, result] of results) {
        results.set(wallet, scrubResultRow(result, suppression));
      }
    }

    // Calculate stats for this chunk
    const chunkResults = walletsToProcess.map((w) =>
      results.get(w.toLowerCase())!
    );
    const twitterFound =
      job.twitterFound + chunkResults.filter((r) => r.twitter_handle).length;
    const farcasterFound =
      job.farcasterFound + chunkResults.filter((r) => r.farcaster).length;
    const anySocialFound =
      job.anySocialFound +
      chunkResults.filter((r) => r.twitter_handle || r.farcaster).length;

    const newProcessedCount = startIndex + walletsToProcess.length;
    const allResults = Array.from(results.values());

    // Check if job is complete
    const isComplete = newProcessedCount >= allWallets.length;

    if (isComplete) {
      // Finalize: save to history and social graph
      await finalizeJobWithResults(
        db,
        job,
        allResults,
        twitterFound,
        farcasterFound,
        anySocialFound,
        cacheHits
      );
      return {
        completed: true,
        processedCount: newProcessedCount,
        twitterFound,
        farcasterFound,
        anySocialFound,
        cacheHits,
      };
    }

    // Save progress for resume
    await writeOwned(db, job, {
      processedCount: newProcessedCount,
      partialResults: allResults,
      twitterFound,
      farcasterFound,
      anySocialFound,
      cacheHits,
      updatedAt: new Date(),
      // Handed back for the next slice. Now, not NULL: see claimable().
      leasedUntil: sql`now()`,
      sliceAttempts: 0,
    });

    return {
      completed: false,
      processedCount: newProcessedCount,
      twitterFound,
      farcasterFound,
      anySocialFound,
      cacheHits,
    };
  } catch (error) {
    /**
     * Not ours any more: another invocation holds the job, or finished it.
     * Stop without a write. Marking it failed here is exactly the stale
     * overwrite the token exists to prevent.
     */
    if (error instanceof LeaseLostError) {
      console.warn(error.message);
      return {
        completed: false,
        busy: true,
        processedCount: job.processedCount,
        twitterFound: job.twitterFound,
        farcasterFound: job.farcasterFound,
        anySocialFound: job.anySocialFound,
        cacheHits: job.cacheHits,
      };
    }

    console.error('Job processing error:', error);

    // Mark job as failed, if it is still ours to mark and not already billed.
    try {
      const { saved, billed } = await completionState(db, job.id);
      if (saved || billed) {
        /**
         * Handed back unfailed, and the attempt count kept: the next claim
         * finishes a saved job from its rows, and retries a billed one until
         * the cap, which then stops it with the charged-job answer rather
         * than "submit again".
         */
        await writeOwned(db, job, {
          updatedAt: new Date(),
          leasedUntil: sql`now()`,
        });
        return {
          completed: false,
          processedCount: job.processedCount,
          twitterFound: job.twitterFound,
          farcasterFound: job.farcasterFound,
          anySocialFound: job.anySocialFound,
          cacheHits: job.cacheHits,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
      await writeOwned(db, job, {
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        retryCount: job.retryCount + 1,
        updatedAt: new Date(),
        leasedUntil: sql`now()`,
        sliceAttempts: 0,
      });
    } catch (writeError) {
      if (!(writeError instanceof LeaseLostError)) throw writeError;
    }

    return {
      completed: true,
      processedCount: job.processedCount,
      twitterFound: job.twitterFound,
      farcasterFound: job.farcasterFound,
      anySocialFound: job.anySocialFound,
      cacheHits: job.cacheHits,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Merge a stored `social_graph` row onto an in-flight result.
 *
 * This literal existed twice, character for character, and now three times over
 * with the fast-scan path. It decides provenance for every row the graph
 * serves, so two copies of it is two chances to diverge on which side wins.
 *
 * The field policy is not uniform, and each rule is deliberate:
 *
 * - Identity fields take the stored value first. The graph is the better
 *   source; `existing` at this point holds little more than the wallet.
 * - Attestation merges with `??`, not `||`. A `twitter_verified: false` is the
 *   graph saying "consulted, not attested", which is a real answer that `||`
 *   would throw away.
 * - Agent fields keep `existing` first. `detectKnownAgents` has already run
 *   against the curated list, and that list outranks the graph.
 */
function mergeGraphRow(
  existing: WalletSocialResult,
  row: NonNullable<SocialGraphQualityResult['data']>
): WalletSocialResult {
  const stored = socialGraphToResult(row);
  return {
    ...existing,
    ens_name: stored.ens_name || existing.ens_name,
    twitter_handle: stored.twitter_handle || existing.twitter_handle,
    twitter_url: stored.twitter_url || existing.twitter_url,
    farcaster: stored.farcaster || existing.farcaster,
    farcaster_url: stored.farcaster_url || existing.farcaster_url,
    fc_followers: stored.fc_followers || existing.fc_followers,
    fc_fid: stored.fc_fid || existing.fc_fid,
    lens: stored.lens || existing.lens,
    github: stored.github || existing.github,
    twitter_verified: stored.twitter_verified ?? existing.twitter_verified,
    /**
     * Carried explicitly, because the spread above is `...existing` and the
     * in-flight result never has this: only the graph row does. Leaving it off
     * the list would read the column, map it, and then drop it one function
     * later, which is the exact shape `agent_detection_source` failed in.
     */
    twitter_renamed_from:
      stored.twitter_renamed_from ?? existing.twitter_renamed_from,
    farcaster_verified:
      stored.farcaster_verified ?? existing.farcaster_verified,
    source: [...existing.source, 'graph'],
    is_agent: existing.is_agent || stored.is_agent,
    agent_name: existing.agent_name || stored.agent_name,
    agent_framework: existing.agent_framework || stored.agent_framework,
    agent_type: existing.agent_type || stored.agent_type,
    agent_token_symbol:
      existing.agent_token_symbol || stored.agent_token_symbol,
    agent_verified: existing.agent_verified || stored.agent_verified,
    agent_detection_source:
      existing.agent_detection_source || stored.agent_detection_source,
  };
}

/**
 * Merge a `wallet_cache` row onto an in-flight result.
 *
 * This was `{ ...existing, ...data }`, which is not the same thing and loses
 * data. `getCachedWallets` builds every field explicitly, so an empty one
 * arrives as a present key holding `undefined` rather than as an absent key,
 * and a spread writes that `undefined` over whatever the graph step already
 * found. A wallet whose graph row held a Farcaster name and whose cache row
 * held only a Twitter handle came out of this step with no Farcaster name.
 *
 * The cache is fresher than a graph row that reached this step, so it wins
 * where it has an answer, and only where it has one. Agent fields keep the same
 * exception as above: the curated list outranks both.
 */
function mergeCacheRow(
  existing: WalletSocialResult,
  data: WalletSocialResult
): WalletSocialResult {
  return {
    ...existing,
    ens_name: data.ens_name ?? existing.ens_name,
    twitter_handle: data.twitter_handle ?? existing.twitter_handle,
    twitter_url: data.twitter_url ?? existing.twitter_url,
    farcaster: data.farcaster ?? existing.farcaster,
    farcaster_url: data.farcaster_url ?? existing.farcaster_url,
    fc_followers: data.fc_followers ?? existing.fc_followers,
    fc_fid: data.fc_fid ?? existing.fc_fid,
    lens: data.lens ?? existing.lens,
    github: data.github ?? existing.github,
    source: [...existing.source, 'cache'],
    is_agent: existing.is_agent || data.is_agent,
    agent_name: existing.agent_name || data.agent_name,
    agent_framework: existing.agent_framework || data.agent_framework,
    agent_type: existing.agent_type || data.agent_type,
    agent_token_symbol: existing.agent_token_symbol || data.agent_token_symbol,
    agent_verified: existing.agent_verified || data.agent_verified,
    agent_detection_source:
      existing.agent_detection_source || data.agent_detection_source,
  };
}

async function updateJobStage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  job: Pick<LookupJob, 'id' | 'leaseToken'>,
  stage: string
) {
  await writeOwned(db, job, { currentStage: stage, updatedAt: new Date() });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function finalizeJob(db: any, job: LookupJob): Promise<ProcessResult> {
  const results = (job.partialResults || []) as WalletSocialResult[];
  return finalizeJobWithResults(
    db,
    job,
    results,
    job.twitterFound,
    job.farcasterFound,
    job.anySocialFound,
    job.cacheHits
  );
}

async function finalizeJobWithResults(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  job: LookupJob,
  results: WalletSocialResult[],
  twitterFound: number,
  farcasterFound: number,
  anySocialFound: number,
  cacheHits: number
): Promise<ProcessResult> {
  const options = job.options as JobOptions;

  /**
   * Stamped here, and BEFORE history is written.
   *
   * This is the path the product actually uses: the UI posts to /api/jobs, and
   * everything funnels through this function. Stamping only the SSE route left
   * the feature reaching no real user at all.
   *
   * Before `saveLookup` because it mutates these objects in place. Saving first
   * would persist rows without the mark, so reopening a saved lookup would drop
   * the dead-handle warnings and the export filtering that the live view had.
   */
  await stampReachability(results);

  /**
   * The second X account, stamped here for the same reasons and in the same
   * order.
   *
   * Here rather than in the graph read, because a result reaches this point by
   * three paths (the graph, the cache, a fresh resolve) and the conflict hangs
   * off the wallet whichever path produced the row. This is the one place all
   * three have merged and nothing has been written yet, so one query covers
   * the whole batch and `saveLookup` persists what the live view showed.
   */
  await stampAlsoOnX(results);

  /**
   * The X follower count is a paid field, and this is the only place it can be
   * taken away.
   *
   * The paid-field strip runs mid-pipeline, before any of these stamps, so it
   * cannot reach a value `stampReachability` has not produced yet. Stripping
   * there and stamping here would hand every free account a follower count,
   * and it would do it silently: the column would simply be populated, which
   * looks like it working. The reachability mark itself stays for everyone,
   * because a dead handle is a warning rather than a paid figure.
   *
   * Before `saveLookup` for the same reason the stamps are: this array is what
   * gets persisted, so a value not removed here is a value stored and served
   * again on every reopen.
   */
  if (!jobGetsPaidFields(options)) {
    for (const r of results) r.x_followers = undefined;
  }

  /**
   * The priority score, recomputed here because this is the first moment its
   * inputs all exist.
   *
   * The mid-pipeline pass above sets it from holdings and Farcaster followers
   * alone, and it has to: `x_followers` arrives from `stampReachability`
   * several hundred lines later. So the column a customer sorts and exports
   * by ignored X reach entirely, on a product sold on X reach.
   *
   * AFTER the strip immediately above, not before. A free job has had
   * `x_followers` removed by then, so its score is computed from the same
   * inputs it always was, and a paid job keeps both terms. Computing before
   * the strip would fold a paid signal into a free row's score, which is the
   * quiet half of giving a paid field away.
   *
   * Guarded, because a free job's `priority_score` was already set to
   * undefined mid-pipeline and recomputing it here would hand the field back
   * to exactly the accounts the strip took it from.
   */
  if (jobGetsPaidFields(options)) {
    for (const r of results) {
      r.priority_score = calculatePriorityScore(
        r.holdings,
        r.fc_followers,
        r.x_followers
      );
    }
  }

  /**
   * The last look before anything durable is written from this array.
   *
   * `saveLookup` below writes lookup_history.results, which no trigger
   * guards and which the per-removal amend can no longer reach (it already
   * ran, before this job finished). The chunk-level scrub covered rows as
   * they were processed, but a removal can land between a chunk and this
   * finalize, and `finalizeJob` can arrive here straight off stored partial
   * results without a chunk pass at all. The list is re-read rather than
   * threaded through, so the freshest removal wins; a failed read throws
   * and the job fails closed, unbilled, rather than saving unchecked rows.
   *
   * After the stamps, deliberately: `stampAlsoOnX` reads handle_conflicts,
   * and in the window where a restore has resurrected a deleted conflict
   * row it can stamp a suppressed handle back on as `twitter_also`.
   */
  const suppression = await loadSuppressionList();
  if (SUPPRESSION_KINDS.some((k) => (suppression.get(k)?.size ?? 0) > 0)) {
    for (let i = 0; i < results.length; i++) {
      results[i] = scrubResultRow(results[i], suppression);
    }
    /**
     * The stats are recomputed from what will actually be served and
     * saved. The accumulated chunk counts were taken before this scrub, so
     * a removal landing mid-job would otherwise leave them one higher than
     * the rows show: the customer is billed (`chargeForJob` reads
     * `anySocialFound` below) for a match they never receive, and the
     * off-by-one between meta stats and served rows is itself a removal
     * oracle. `results` is the complete array here, so recounting is exact
     * and equals the accumulation whenever nothing was scrubbed.
     */
    twitterFound = results.filter((r) => r.twitter_handle).length;
    farcasterFound = results.filter((r) => r.farcaster).length;
    anySocialFound = results.filter(
      (r) => r.twitter_handle || r.farcaster
    ).length;
  }

  /**
   * Charge before anything durable is written, so the gate is decided by
   * the time the history row and the completion row are built: both carry
   * `matches_delivered` in their own insert/update, and there is no window
   * where a job is completed-but-ungated or saved-but-unmirrored (the shape
   * Bugbot caught: a debit that landed, a gate write that failed, and every
   * match served on a job the worker will never revisit).
   *
   * A resumed job that reaches this twice recovers the first pass's
   * decision: the ledger insert is unique per job, and the duplicate path
   * reads the row back, so the gate is rebuilt identically on retry. The
   * inverse crash (charged, then killed, or the completion write fails)
   * leaves the rows saved just below: the next claim finds every row saved,
   * goes straight to this finalize without calling a provider, and completes
   * the job. Neither the attempt cap nor the failure path fails a job in that
   * state (`completionState`), so a billed job is never told to submit again,
   * and the debit is never doubled.
   *
   * `anySocialFound` is the meter: wallets carrying an X handle or a
   * Farcaster account. Misses are free, which is the whole pricing
   * position. Called for every job by a signed-in account, including
   * zero-match ones: legacy accounts are never charged but their
   * submitted-wallet counts feed the daily anti-enumeration ceiling. A
   * charge that throws is never fatal; the cost is one uncharged, ungated
   * job, strictly better than a completed job that reports as failed.
   */
  let matchesDelivered: number | null = null;
  let gateIsFresh = false;
  /**
   * What an anonymous caller is allowed to see from THIS job. Clamped to the
   * per-job constant so a stale or hand-edited option cannot widen the gate.
   */
  const anonGate = Math.min(
    ANON_MATCHES_PER_JOB,
    Math.max(0, options.anonMatchGate ?? ANON_MATCHES_PER_JOB)
  );

  /**
   * The finished rows, saved before anything is charged.
   *
   * From the charge on, this job may be billed. If the platform kills this
   * invocation anywhere past here, the next claim finds `processed_count`
   * equal to the list and every row saved, goes straight to finalize from
   * them with no provider pass, and does not count toward the attempt cap
   * (reset here). The same write re-asserts the claim and extends it, which
   * is the renewal the charge needs.
   */
  await writeOwned(db, job, {
    processedCount: job.wallets.length,
    partialResults: results,
    twitterFound,
    farcasterFound,
    anySocialFound,
    cacheHits,
    updatedAt: new Date(),
    sliceAttempts: 0,
    leasedUntil: sql`now() + make_interval(secs => ${LEASE_SECONDS})`,
  });
  if (options.meteredUserId) {
    try {
      const charge = await chargeForJob(
        options.meteredUserId,
        job.id,
        anySocialFound,
        job.wallets.length,
        options.tier ?? 'free'
      );
      /**
       * The gate arms on either meter now, and on `delivered` rather than
       * `billed`.
       *
       * It used to arm only when `paidFrom === 'free'`, so a pack job was
       * never gated: it was billed for every match, `drawDown` collected what
       * the lots held, and the rest was given away silently. Since
       * `canSubmit` allows ten times the balance in WALLETS, and ten times
       * the wallets is 2.37 times the matches at the measured rate, a Trial
       * pack bought at 250 matches could be shown about 593 — and the
       * contract importer asked for exactly that ceiling, so it landed there
       * by construction rather than by accident.
       *
       * `delivered` is `billed` plus the near-miss margin, so a list that
       * overshoots slightly still comes back whole and only a genuine
       * overshoot meets the gate.
       *
       * `legacy` and the uncharged paths report `delivered` equal to the
       * match count, so this comparison leaves them alone without needing to
       * name them.
       */
      if (charge.delivered < anySocialFound) {
        matchesDelivered = charge.delivered;
        gateIsFresh = !charge.duplicate;
      }
    } catch (error) {
      console.error('Credit charge failed (job still succeeded):', error);
    }
  } else if (job.userId && anySocialFound > anonGate) {
    /**
     * The anonymous gate. `job.userId` (the caller's local id) is required
     * because a system job — the seed cron, refresh-stale — has no owner and
     * serves no wallet rows to anyone; gating it would be a lock on a door
     * nobody can open.
     *
     * The size comes from `options.anonMatchGate`, reserved against the
     * caller's daily allowance when the job was accepted, because that is the
     * only moment the address is known. It is stored on the job rather than
     * recomputed so a resumed finalize rebuilds the same gate: recomputing
     * would read a different remaining budget and silently move the line.
     *
     * The constant is the fallback, for a signed-in caller that never reserved
     * one and for jobs created before the meter shipped.
     */
    matchesDelivered = anonGate;
    gateIsFresh = true;
  }

  // Save to history if requested
  if (options.saveToHistory) {
    await renewLease(db, job);
    try {
      // Always keyed on the job, gated or not: the unique job_id makes a
      // second finalize's save a no-op, which returns null.
      const lookupId = await saveLookup(
        results,
        options.historyName,
        options.userId || job.userId || undefined,
        options.inputSource,
        { jobId: job.id, matchesDelivered }
      );

      /**
       * `history_saved` fires here, where the save happened, and nowhere else.
       *
       * The event type and `Analytics.historySaved` have both existed since
       * January and neither was ever called, so "History save rate" on the
       * admin panel was a structural 0% and the funnel step under it was a
       * structural zero. Same shape as the `page_view` gap that
       * `PageViewTracker` was written to close.
       *
       * Server-side rather than from the browser, because saving is a checkbox
       * the user sets before submitting and the request that honours it is
       * this one. A client event would record the intent; this records what was
       * actually written, which is the thing worth a rate. So only when a
       * row was inserted: a finalize that runs twice saves once, and counts
       * once.
       */
      if (lookupId) {
        trackEvent('history_saved', {
          userId: options.userId || job.userId || undefined,
          sessionId: job.sessionId ?? undefined,
          metadata: {
            jobId: job.id,
            lookupId,
            walletCount: results.length,
          },
        });
      }
    } catch (error) {
      console.error('History save error:', error);
    }
  }

  // Persist positive results to social graph with retry logic
  let socialGraphWriteStatus: 'success' | 'partial' | 'failed' | null = null;
  let socialGraphWriteErrors: string[] = [];

  /**
   * A fast scan writes nothing back, and this is the reason it must not.
   *
   * Every row it produced came out of the graph or the cache. Nothing was
   * confirmed against a live source. `upsertSocialGraphWithRetry` resets
   * `staleAt` and `lastCheckedAt`, so writing those rows would stamp unverified
   * data as freshly checked, and a later deep scan would trust the stamp and
   * skip the very sources meant to confirm it. One fast scan would suppress the
   * next real one for the whole trust window, and the rows it protects are
   * exactly the stale ones a fast scan now serves.
   */
  const positiveResults = options.fastMode
    ? []
    : results.filter(
        (r) =>
          r.twitter_handle || r.farcaster || r.lens || r.github || r.ens_name
      );

  if (positiveResults.length > 0) {
    await renewLease(db, job);
    const writeResult = await upsertSocialGraphWithRetry(positiveResults);

    // Determine write status
    if (writeResult.failed === 0) {
      socialGraphWriteStatus = 'success';
      console.log(
        `Social graph: persisted ${writeResult.succeeded} of ${positiveResults.length} wallets`
      );
    } else if (writeResult.succeeded > 0) {
      socialGraphWriteStatus = 'partial';
      socialGraphWriteErrors = writeResult.errors;
      console.warn(
        `Social graph: partial write - ${writeResult.succeeded} succeeded, ${writeResult.failed} failed`
      );
    } else {
      socialGraphWriteStatus = 'failed';
      socialGraphWriteErrors = writeResult.errors;
      console.error(
        'CRITICAL: Social graph persist completely failed:',
        writeResult.errors
      );
    }

    // Track write failures in analytics
    if (writeResult.failed > 0) {
      trackEvent('lookup_completed', {
        userId: options.userId || job.userId || undefined,
        // The job row, not `options`: a resumed chunk is processed by a worker
        // whose options came off the row anyway, and the row is the only copy
        // that survives the queue.
        sessionId: job.sessionId ?? undefined,
        metadata: {
          jobId: job.id,
          eventSubtype: 'social_graph_write_failed',
          failed: writeResult.failed,
          succeeded: writeResult.succeeded,
          errors: writeResult.errors,
        },
      });
    }
  }

  // Mark job as complete with write status
  const completedAt = new Date();
  await writeOwned(db, job, {
    status: 'completed',
    processedCount: job.wallets.length,
    partialResults: results,
    twitterFound,
    farcasterFound,
    anySocialFound,
    cacheHits,
    completedAt,
    updatedAt: new Date(),
    socialGraphWriteStatus,
    socialGraphWriteErrors:
      socialGraphWriteErrors.length > 0 ? socialGraphWriteErrors : null,
    // The match gate, atomic with completion: a job is never readable as
    // completed-but-ungated when the allowance covered only part of it.
    matchesDelivered,
    leasedUntil: sql`now()`,
    sliceAttempts: 0,
  });

  if (matchesDelivered !== null && gateIsFresh) {
    trackEvent('limit_hit', {
      userId: options.userId || job.userId || undefined,
      sessionId: job.sessionId ?? undefined,
      metadata: {
        reason: 'match_gate',
        jobId: job.id,
        matchesFound: anySocialFound,
        matchesDelivered,
        matchesLocked: anySocialFound - matchesDelivered,
      },
    });
  }

  // Track lookup completed event
  const durationMs =
    completedAt.getTime() -
    (job.startedAt?.getTime() || job.createdAt.getTime());
  const matchRate =
    job.wallets.length > 0 ? (anySocialFound / job.wallets.length) * 100 : 0;

  trackEvent('lookup_completed', {
    userId: options.userId || job.userId || undefined,
    sessionId: job.sessionId ?? undefined,
    metadata: {
      jobId: job.id,
      walletCount: job.wallets.length,
      twitterFound,
      farcasterFound,
      anySocialFound,
      cacheHits,
      matchRate: Math.round(matchRate * 100) / 100,
      durationMs,
      tier: options.tier,
      socialGraphWriteStatus,
    },
  });

  return {
    completed: true,
    processedCount: job.wallets.length,
    twitterFound,
    farcasterFound,
    anySocialFound,
    cacheHits,
  };
}

/**
 * Create a new lookup job
 */
export async function createJob(
  wallets: string[],
  originalData: Record<string, Record<string, string>>,
  options: JobOptions
): Promise<string> {
  const db = getDb();
  if (!db) {
    throw new Error('Database not configured');
  }

  const [job] = await db
    .insert(lookupJobs)
    .values({
      wallets,
      originalData,
      options,
      userId: options.userId,
      sessionId: options.sessionId,
    })
    .returning();

  return job.id;
}

/**
 * Get job by ID
 */
/**
 * The poll-shaped read: everything a status endpoint needs and nothing it
 * must not load. On a large job, `wallets` and `partial_results` are
 * megabytes of jsonb, and a poll that deserialises them to report a
 * percentage makes the cheapest call on the surface the most expensive one
 * to serve. Counts are computed where the data already lives.
 */
export interface JobStatusRow {
  id: string;
  status: string;
  userId: string | null;
  processedCount: number;
  currentStage: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  anySocialFound: number;
  /** The match gate; see `lookup_jobs.matches_delivered`. Null = ungated. */
  matchesDelivered: number | null;
  walletCount: number;
}

export async function getJobStatus(
  jobId: string
): Promise<JobStatusRow | null> {
  const db = getDb();
  if (!db) return null;

  const [row] = await db
    .select({
      id: lookupJobs.id,
      status: lookupJobs.status,
      userId: lookupJobs.userId,
      processedCount: lookupJobs.processedCount,
      currentStage: lookupJobs.currentStage,
      createdAt: lookupJobs.createdAt,
      startedAt: lookupJobs.startedAt,
      completedAt: lookupJobs.completedAt,
      anySocialFound: lookupJobs.anySocialFound,
      matchesDelivered: lookupJobs.matchesDelivered,
      walletCount: sql<number>`jsonb_array_length(${lookupJobs.wallets})`,
    })
    .from(lookupJobs)
    .where(eq(lookupJobs.id, jobId))
    .limit(1);

  return row || null;
}

/**
 * One page of a completed job, sliced and filtered inside Postgres so the
 * page ships and the job stays put. The wallets slice keeps submission
 * order (the order authority the response echoes); the result rows are the
 * subset whose wallet falls in that slice. Ordinality is 1-based; casts are
 * explicit because the HTTP driver sends no parameter type hints (the 42P18
 * lesson in lib/neynar-budget.ts).
 */
export interface JobResultsPage {
  wallets: string[];
  rows: WalletSocialResult[];
}

export async function getJobResultsPage(
  jobId: string,
  offset: number,
  limit: number
): Promise<JobResultsPage | null> {
  const db = getDb();
  if (!db) return null;

  const rows = await db.execute(sql`
    WITH page AS (
      SELECT lower(w.value) AS wallet, w.ordinality AS ord
      FROM lookup_jobs j,
           jsonb_array_elements_text(j.wallets) WITH ORDINALITY AS w
      WHERE j.id = ${jobId}::uuid
        AND w.ordinality > ${offset}::int
        AND w.ordinality <= ${offset + limit}::int
    )
    SELECT
      (SELECT coalesce(jsonb_agg(wallet ORDER BY ord), '[]'::jsonb)
         FROM page) AS wallets,
      (SELECT coalesce(jsonb_agg(elem), '[]'::jsonb)
         FROM lookup_jobs j2,
              jsonb_array_elements(j2.partial_results) AS elem
        WHERE j2.id = ${jobId}::uuid
          AND lower(elem->>'wallet') IN (SELECT wallet FROM page)) AS rows
  `);

  // The http driver answers { rows }; a pooled driver answers the array
  // itself. Read both shapes rather than guessing which client built db.
  const raw = rows as unknown as { rows?: unknown[] } | unknown[];
  const first = (Array.isArray(raw) ? raw[0] : raw.rows?.[0]) as
    { wallets: string[]; rows: WalletSocialResult[] } | undefined;
  if (!first) return null;
  return { wallets: first.wallets ?? [], rows: first.rows ?? [] };
}

/**
 * How many billable matches sit before a page boundary, for the match gate.
 *
 * The v1 route serves one page at a time, and whether a page's match is open
 * depends on how many matches precede it in the whole job. Counted in
 * Postgres for the same reason the page itself is: a gated job is bounded by
 * the free submission cap, but there is no reason to ship the whole payload
 * to count a prefix. The predicate is the billing predicate: an X handle or
 * a Farcaster account.
 */
export async function countMatchedBefore(
  jobId: string,
  offset: number
): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  if (offset <= 0) return 0;

  const rows = await db.execute(sql`
    SELECT count(*)::int AS n
    FROM lookup_jobs j,
         jsonb_array_elements(j.partial_results) AS elem
    WHERE j.id = ${jobId}::uuid
      AND lower(elem->>'wallet') IN (
        SELECT lower(w.value)
        FROM lookup_jobs j2,
             jsonb_array_elements_text(j2.wallets) WITH ORDINALITY AS w
        WHERE j2.id = ${jobId}::uuid
          AND w.ordinality <= ${offset}::int)
      AND (coalesce(elem->>'twitter_handle', '') <> ''
        OR coalesce(elem->>'farcaster', '') <> '')
  `);

  const raw = rows as unknown as { rows?: unknown[] } | unknown[];
  const first = (Array.isArray(raw) ? raw[0] : raw.rows?.[0]) as
    { n: number } | undefined;
  return first?.n ?? 0;
}

export async function getJob(jobId: string): Promise<LookupJob | null> {
  const db = getDb();
  if (!db) {
    return null;
  }

  const [job] = await db
    .select()
    .from(lookupJobs)
    .where(eq(lookupJobs.id, jobId))
    .limit(1);

  return job || null;
}

/**
 * Get multiple pending jobs to process in parallel
 * This allows the cron worker to clear the queue faster
 */
export async function getNextPendingJobs(
  limit: number = 5
): Promise<LookupJob[]> {
  const db = getDb();
  if (!db) {
    return [];
  }

  // Get pending jobs first. Only claimable ones: a job another invocation
  // holds would be admitted against the wallet budget and then refused by the
  // claim, spending this tick's budget on nothing.
  const pendingJobs = await db
    .select()
    .from(lookupJobs)
    .where(and(eq(lookupJobs.status, 'pending'), claimable()))
    .orderBy(lookupJobs.createdAt)
    .limit(limit);

  if (pendingJobs.length >= limit) {
    return pendingJobs;
  }

  // Then jobs part-way through: handed back between slices, or left by a
  // holder that died, whose lease has run out.
  const remainingLimit = limit - pendingJobs.length;
  const processingJobs = await db
    .select()
    .from(lookupJobs)
    .where(and(eq(lookupJobs.status, 'processing'), claimable()))
    .orderBy(lookupJobs.createdAt)
    .limit(remainingLimit);

  return [...pendingJobs, ...processingJobs];
}
