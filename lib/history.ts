import { getDb, lookupHistory, lookupJobs, socialGraph } from '@/db';
import { and, desc, eq, sql, inArray, type SQL } from 'drizzle-orm';
import { LeaseLostError } from './job-lease';
import type { WalletSocialResult } from './types';

export interface SavedLookup {
  id: string;
  name: string | null;
  userId: string | null;
  walletCount: number;
  twitterFound: number;
  farcasterFound: number;
  results: WalletSocialResult[];
  createdAt: Date;
  /**
   * The match gate mirrored from the job that saved this lookup. Null means
   * ungated; a number means the serve route locks every matched row past it,
   * exactly as the job's own results route does.
   */
  matchesDelivered: number | null;
  /** The job behind a gated lookup, which the unlock endpoint is keyed on. */
  jobId: string | null;
}

export type InputSource =
  | 'file_upload'
  | 'text_input'
  | 'contract_import'
  | 'reverse_lookup'
  | 'api'
  | 'seed_cron'
  // A collection we supplied the wallet list for, so a visitor with no data
  // of their own still has a first action. Told apart from contract_import
  // because that one is a paid import of a contract the caller chose, and
  // conflating them would make the funnel unable to say which of the two
  // earns an account (lib/starter-collections.ts).
  | 'starter_collection';

export async function saveLookup(
  results: WalletSocialResult[],
  name?: string,
  userId?: string,
  inputSource?: InputSource,
  /**
   * The job this save belongs to, and its match gate, written with the row
   * rather than mirrored afterwards: a mirror that failed after the save left
   * an ungated saved copy of a gated job, which is the history bypass this
   * column exists to close. `matchesDelivered` null means ungated.
   *
   * With a job, the save happens at most once per job. A finalize can run
   * twice for one job (a slice killed after the save, a holder resumed after
   * losing its lease), and each run used to add another copy of the lookup to
   * the customer's history. `lookup_history.job_id` is unique, so the second
   * run inserts nothing and this returns null; see `historyInsertForJob` for
   * the one thing it does write.
   *
   * `leaseToken` is the worker's claim on the job. The save writes only while
   * that claim still holds, checked in the same statement, and throws
   * `LeaseLostError` when it no longer does.
   */
  gate?: {
    jobId: string;
    matchesDelivered: number | null;
    leaseToken: string;
  }
): Promise<string | null> {
  const db = getDb();
  if (!db) return null;

  const twitterFound = results.filter((r) => r.twitter_handle).length;
  const farcasterFound = results.filter((r) => r.farcaster).length;

  const values = {
    name: name ?? null,
    userId: userId ?? null,
    walletCount: results.length,
    twitterFound,
    farcasterFound,
    results: results,
    inputSource: inputSource ?? null,
    jobId: gate?.jobId ?? null,
    matchesDelivered: gate?.matchesDelivered ?? null,
  };
  if (!gate) {
    const [inserted] = await db
      .insert(lookupHistory)
      .values(values)
      .returning();
    return inserted?.id ?? null;
  }
  const result = (await db.execute(
    historyInsertForJob({ ...values, jobId: gate.jobId }, gate.leaseToken)
  )) as unknown as { rows?: unknown[] } | unknown[];
  // The http driver answers { rows }; a pooled driver answers the array.
  const [row] = (
    Array.isArray(result) ? result : (result.rows ?? [])
  ) as Array<{
    id: string;
    inserted: boolean;
  }>;
  // An id only for a row this call created, so `history_saved` counts saves.
  if (row) return row.inserted ? row.id : null;

  /**
   * No row: either the fence refused (the job is no longer this claim's), or
   * the row exists and its gate already agrees, so the conflict's WHERE was
   * false. Only the first is a problem, and it stops the holder.
   */
  const [held] = await db
    .select({ id: lookupJobs.id })
    .from(lookupJobs)
    .where(
      and(
        eq(lookupJobs.id, gate.jobId),
        eq(lookupJobs.leaseToken, gate.leaseToken),
        eq(lookupJobs.status, 'processing')
      )
    )
    .limit(1);
  if (!held) throw new LeaseLostError(gate.jobId);
  return null;
}

/**
 * A job's history save: insert once, and on a later pass correct the gate,
 * and only while the saving invocation still holds the job.
 *
 * The first pass's row is kept, but not its gate. A charge that threw on the
 * first finalize saved the row ungated; the pass that completes the job then
 * charges and gates it, and a plain DO NOTHING would leave every match open
 * in the saved copy, the bypass `matches_delivered` exists to close. So the
 * conflict brings the stored gate in line with this pass's, and only when it
 * differs, so a re-run that agrees touches nothing. A pass that decided no
 * gate (its charge threw) never clears one: a null here means "not known",
 * and writing it over a real gate would open every locked match in the saved
 * copy. Results are never rewritten here: a customer may have grown the saved
 * copy since.
 *
 * The fence is in the statement, not before it. The worker renews its lease
 * just before saving, but that is a check, and an admin rerun can reset the
 * job and detach its old saved copy between the check and this insert; the
 * stale holder would then insert a row linked to the job, and the rerun's own
 * save would meet it and correct only the gate, never the results (Bugbot on
 * #393). So the row is selected only WHERE EXISTS the job, under this token,
 * still running. `FOR SHARE` makes that check hold until the insert commits:
 * the rerun's reset waits for it, and the detach that follows the reset then
 * sees this row. Without the lock the subquery reads the row as it was when
 * the statement began, and an insert racing the reset could land linked.
 *
 * Raw SQL with every parameter cast, because the HTTP driver sends no type
 * hints (the 42P18 lesson in lib/neynar-budget.ts). `inserted` is `xmax = 0`:
 * true for a row this statement created, false for one it updated. Exported
 * so scripts/check-invariants.ts renders the SQL.
 */
export function historyInsertForJob(
  values: {
    name: string | null;
    userId: string | null;
    walletCount: number;
    twitterFound: number;
    farcasterFound: number;
    results: unknown;
    inputSource: string | null;
    jobId: string;
    matchesDelivered: number | null;
  },
  leaseToken: string
): SQL {
  return sql`INSERT INTO lookup_history (name, user_id, wallet_count, twitter_found, farcaster_found, results, input_source, job_id, matches_delivered)
SELECT ${values.name}::text, ${values.userId}::text, ${values.walletCount}::int, ${values.twitterFound}::int, ${values.farcasterFound}::int, ${JSON.stringify(values.results)}::jsonb, ${values.inputSource}::text, ${values.jobId}::uuid, ${values.matchesDelivered}::int
WHERE EXISTS (SELECT 1 FROM lookup_jobs WHERE id = ${values.jobId}::uuid AND lease_token = ${leaseToken}::uuid AND status = 'processing' FOR SHARE)
ON CONFLICT (job_id) DO UPDATE SET matches_delivered = excluded.matches_delivered WHERE excluded.matches_delivered IS NOT NULL AND lookup_history.matches_delivered IS DISTINCT FROM excluded.matches_delivered
RETURNING id, (xmax = 0) AS inserted`;
}

export async function getLookupHistory(
  limit = 10,
  userId?: string
): Promise<SavedLookup[]> {
  const db = getDb();
  if (!db) return [];

  // Filter by userId if provided
  const whereClause = userId ? eq(lookupHistory.userId, userId) : undefined;

  const rows = await db
    .select()
    .from(lookupHistory)
    .where(whereClause)
    .orderBy(desc(lookupHistory.createdAt))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    userId: row.userId,
    walletCount: row.walletCount,
    twitterFound: row.twitterFound,
    farcasterFound: row.farcasterFound,
    results: row.results as WalletSocialResult[],
    createdAt: row.createdAt,
    matchesDelivered: row.matchesDelivered,
    jobId: row.jobId,
  }));
}

// Lightweight version that only fetches summary columns (no JSONB results)
export interface LookupSummary {
  id: string;
  name: string | null;
  walletCount: number;
  twitterFound: number;
  farcasterFound: number;
  createdAt: Date;
}

export async function getHistorySummaries(
  limit = 10,
  userId?: string,
  offset = 0
): Promise<LookupSummary[]> {
  const db = getDb();
  if (!db) return [];

  const whereClause = userId ? eq(lookupHistory.userId, userId) : undefined;

  const rows = await db
    .select({
      id: lookupHistory.id,
      name: lookupHistory.name,
      walletCount: lookupHistory.walletCount,
      twitterFound: lookupHistory.twitterFound,
      farcasterFound: lookupHistory.farcasterFound,
      createdAt: lookupHistory.createdAt,
    })
    .from(lookupHistory)
    .where(whereClause)
    .orderBy(desc(lookupHistory.createdAt))
    .limit(limit)
    .offset(offset);

  return rows;
}

export async function getHistoryCount(userId?: string): Promise<number> {
  const db = getDb();
  if (!db) return 0;

  const whereClause = userId ? eq(lookupHistory.userId, userId) : undefined;

  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(lookupHistory)
    .where(whereClause);

  return result?.count || 0;
}

export async function getLookupById(id: string): Promise<SavedLookup | null> {
  const db = getDb();
  if (!db) return null;

  const rows = await db
    .select()
    .from(lookupHistory)
    .where(eq(lookupHistory.id, id))
    .limit(1);

  if (rows.length === 0) return null;

  const row = rows[0];
  return {
    id: row.id,
    name: row.name,
    userId: row.userId,
    walletCount: row.walletCount,
    twitterFound: row.twitterFound,
    farcasterFound: row.farcasterFound,
    results: row.results as WalletSocialResult[],
    createdAt: row.createdAt,
    matchesDelivered: row.matchesDelivered,
    jobId: row.jobId,
  };
}

/**
 * Clear the gate mirror after an unlock. Keyed on the job, not the lookup,
 * because the unlock endpoint holds the job and the history row is findable
 * only through it.
 */
export async function clearLookupGate(jobId: string): Promise<void> {
  const db = getDb();
  if (!db) return;

  await db
    .update(lookupHistory)
    .set({ matchesDelivered: null })
    .where(eq(lookupHistory.jobId, jobId));
}

/**
 * Clear the gate on one saved lookup, keyed by the lookup itself.
 *
 * The job-keyed clear above serves the unlock; this one serves the PATCH
 * handler's self-heal, which holds a lookup whose gate suppression has
 * emptied and no job in hand.
 */
export async function clearLookupGateById(lookupId: string): Promise<void> {
  const db = getDb();
  if (!db) return;

  await db
    .update(lookupHistory)
    .set({ matchesDelivered: null })
    .where(eq(lookupHistory.id, lookupId));
}

export async function updateLookup(
  id: string,
  results: WalletSocialResult[]
): Promise<boolean> {
  const db = getDb();
  if (!db) return false;

  const twitterFound = results.filter((r) => r.twitter_handle).length;
  const farcasterFound = results.filter((r) => r.farcaster).length;

  const updated = await db
    .update(lookupHistory)
    .set({
      walletCount: results.length,
      twitterFound,
      farcasterFound,
      results: results,
    })
    .where(eq(lookupHistory.id, id))
    .returning();

  return updated.length > 0;
}

/**
 * Hard delete, not a hidden flag. A saved lookup is the customer's copy of a
 * result set, and deleting their copy is their call; keeping a shadow of it
 * after they asked would be retention nobody agreed to. The caller checks
 * ownership first (the route does, the same way its GET does).
 */
export async function deleteLookup(id: string): Promise<boolean> {
  const db = getDb();
  if (!db) return false;

  const deleted = await db
    .delete(lookupHistory)
    .where(eq(lookupHistory.id, id))
    .returning();

  return deleted.length > 0;
}

export async function updateLookupName(
  id: string,
  name: string
): Promise<boolean> {
  const db = getDb();
  if (!db) return false;

  const updated = await db
    .update(lookupHistory)
    .set({ name })
    .where(eq(lookupHistory.id, id))
    .returning();

  return updated.length > 0;
}

/**
 * Mark a lookup as viewed, updating the lastViewedAt timestamp
 */
export async function markLookupViewed(id: string): Promise<void> {
  const db = getDb();
  if (!db) return;

  try {
    await db
      .update(lookupHistory)
      .set({ lastViewedAt: new Date() })
      .where(eq(lookupHistory.id, id));
  } catch (error) {
    console.error('Mark lookup viewed error:', error);
  }
}

/**
 * Get lastViewedAt timestamp for a lookup
 */
export async function getLookupLastViewedAt(id: string): Promise<Date | null> {
  const db = getDb();
  if (!db) return null;

  try {
    const rows = await db
      .select({ lastViewedAt: lookupHistory.lastViewedAt })
      .from(lookupHistory)
      .where(eq(lookupHistory.id, id))
      .limit(1);

    return rows[0]?.lastViewedAt || null;
  } catch (error) {
    console.error('Get lookup last viewed error:', error);
    return null;
  }
}

/**
 * Get enrichment counts for multiple lookups
 * Returns a map of lookupId -> number of wallets enriched since lastViewedAt
 */
export async function getEnrichmentCounts(
  lookupIds: string[]
): Promise<Map<string, number>> {
  const db = getDb();
  const result = new Map<string, number>();
  if (!db || lookupIds.length === 0) return result;

  try {
    // First, get all lookups with their lastViewedAt and results
    const lookups = await db
      .select({
        id: lookupHistory.id,
        lastViewedAt: lookupHistory.lastViewedAt,
        results: lookupHistory.results,
      })
      .from(lookupHistory)
      .where(inArray(lookupHistory.id, lookupIds));

    // For each lookup, count wallets enriched since lastViewedAt
    for (const lookup of lookups) {
      // If never viewed, skip (no "new" enrichments to show)
      if (!lookup.lastViewedAt) {
        result.set(lookup.id, 0);
        continue;
      }

      const results = lookup.results as WalletSocialResult[];
      const wallets = results.map((r) => r.wallet.toLowerCase());

      if (wallets.length === 0) {
        result.set(lookup.id, 0);
        continue;
      }

      // Count wallets in social_graph updated after lastViewedAt. The
      // has-social clause keeps negative re-checks (which bump last_updated_at
      // without adding data) from showing as "new matches"
      const [countResult] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(socialGraph)
        .where(
          sql`${socialGraph.wallet} IN ${wallets} AND ${socialGraph.lastUpdatedAt} > ${lookup.lastViewedAt}
              AND (${socialGraph.twitterHandle} IS NOT NULL OR ${socialGraph.farcaster} IS NOT NULL
                   OR ${socialGraph.ensName} IS NOT NULL OR ${socialGraph.lens} IS NOT NULL
                   OR ${socialGraph.github} IS NOT NULL)`
        );

      result.set(lookup.id, countResult?.count || 0);
    }

    return result;
  } catch (error) {
    console.error('Get enrichment counts error:', error);
    return result;
  }
}
