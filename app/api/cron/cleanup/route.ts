/**
 * Deletes what nothing else deletes.
 *
 * Three cleanup functions existed and nothing called any of them. Expired
 * sessions, spent magic-link tokens and hourly IP rate-limit buckets therefore
 * accumulated from the day each table was created, and `check-invariants.ts`
 * had nothing to say about it because none of them claimed a retention period.
 *
 * That was worth fixing on its own, and it became necessary when the privacy
 * policy was written: a policy that names a retention period no code enforces
 * is a claim with nothing able to contradict it, which is the exact shape of
 * defect this repository has now shipped four times. So the periods are here,
 * as constants, and `docs-site/privacy.mdx` states them.
 *
 * | What                       | Kept for                          |
 * | -------------------------- | --------------------------------- |
 * | Sessions                   | Until they expire, then deleted   |
 * | Magic-link tokens          | 24 hours after they were created  |
 * | IP rate-limit buckets      | 24 hours                          |
 * | Authorization requests     | Until they expire, then deleted   |
 * | Analytics events           | 400 days                          |
 * | Idempotency replay rows    | 24 hours (lib/idempotency.ts)     |
 * | Job payloads               | 30 days, row and stats kept       |
 * | Removal quarantine copies  | Until purge_after, then deleted   |
 *
 * The two removal-system rows run FIRST, and each catches its own errors.
 * Every other branch here is housekeeping; these two are retention promises
 * the privacy policy states, and a promise that stops being kept because an
 * unrelated delete threw is a promise broken silently, on a schedule. The
 * quarantine purge in particular must never wait behind a branch that can
 * fail: past `purge_after` the copy has no reason to exist at all.
 *
 * `lookup_history` deliberately has NO row in this table. A saved lookup is
 * kept until its owner deletes it (DELETE /api/history/[id]) or a removal
 * amends the identifiers out of it; a TTL here would delete customers' saved
 * work to nobody's benefit.
 *
 * Analytics is the one addition rather than a wiring-up. It had no expiry at
 * all, and an event carries a browser id and sometimes an email, so an
 * unbounded table is a growing pile of behavioural data nobody decided to keep.
 * 400 days is the longest a browser will hold a first-party cookie under the
 * Chrome cap, which makes it the longest window in which the id in a row could
 * still identify the same browser.
 *
 * GET is supported for a manual trigger and behaves identically, including the
 * secret check.
 */
import { NextRequest, NextResponse } from 'next/server';
import { lt, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { analyticsEvents } from '@/db/schema';
import { cleanupExpiredAuth } from '@/lib/auth';
import { cleanupOldIpBuckets } from '@/lib/ip-rate-limiter';
import { cleanupAuthorizationRequests } from '@/lib/oauth/requests';
import { cleanupIdempotencyKeys } from '@/lib/idempotency';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** See the table above. Named so the policy and the delete cannot disagree. */
export const ANALYTICS_RETENTION_DAYS = 400;
export const IP_BUCKET_RETENTION_HOURS = 24;
/**
 * How long a job keeps its payload: the wallet list, the CSV columns that
 * came with it, and the results. After this the row stays (status, counts,
 * timestamps, so listings and analytics still render) but the identifiers
 * are gone. `lookup_history` is where a customer keeps a lookup on purpose;
 * a job row keeping the same data forever by accident was retention nobody
 * decided on.
 *
 * The quarantine purge below has no constant here on purpose: its deadline
 * rides on each row as `purge_after`, written by the code that quarantines
 * (the same split as the idempotency TTL living in lib/idempotency.ts).
 */
export const JOB_PAYLOAD_RETENTION_DAYS = 30;
/**
 * Rows stripped per run. The strip rewrites jsonb, which is the heaviest
 * write in this file, and the first run faces every job ever created; a
 * bound keeps the run inside maxDuration and the daily schedule drains the
 * backlog in a few days. Steady state is well under one batch per day.
 */
export const JOB_PAYLOAD_STRIP_BATCH = 500;

async function run(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getDb();
  if (!db) {
    return NextResponse.json({ error: 'No database' }, { status: 503 });
  }

  /**
   * Quarantine purge, before anything that can throw.
   *
   * The quarantine table holds the pre-deletion copy of rows a removal
   * erased, kept only so a removal inside the undo window can be reversed.
   * Past `purge_after` it is the most sensitive data we hold with the least
   * reason to hold it, so this branch runs first and catches its own errors:
   * a failure anywhere else in this job must not extend that retention by
   * even a day. (Sequenced awaits mean an uncaught throw abandons every
   * branch after it, which for housekeeping is tolerable and for this is
   * not.)
   *
   * `to_regclass` first, because migrations here are hand-applied after
   * deploy: in the window where this code is live and the table is not, the
   * skip is expected and must not spend an error log. `null` in the response
   * means "did not run", and the reason is in the logs only when it is real.
   */
  let quarantinePurged: number | null = null;
  try {
    const present = (await db.execute(
      sql`SELECT to_regclass('public.suppression_quarantine') IS NOT NULL AS present`
    )) as unknown as { rows: Array<{ present: boolean }> };
    if (present.rows[0]?.present) {
      const purged = (await db.execute(sql`
        DELETE FROM suppression_quarantine
        WHERE purge_after <= now()
        RETURNING 1
      `)) as unknown as { rows: unknown[] };
      quarantinePurged = purged.rows.length;
    }
  } catch (error) {
    console.error('Quarantine purge error:', error);
  }

  /**
   * Job payload strip: the other stated retention period, isolated the same
   * way. The row survives with its stats so every `jsonb_array_length`
   * consumer (admin usage, dashboards, the wins strip, job listings) keeps
   * reading true numbers: the wallet list is replaced by an array of nulls
   * of the SAME length, never by an empty one. `wallets -> 0 <> 'null'` is
   * the already-stripped test that keeps the daily run from rewriting rows
   * it has already stripped.
   *
   * Terminal jobs strip at 30 days from creation. A job still marked
   * pending/processing is exempt until `updated_at` is also past the cutoff:
   * the worker touches `updated_at` on every claim, so a non-terminal job
   * untouched for 30 days is abandoned, not in flight, and its payload ages
   * out with everything else. `options` stays: it holds settings
   * (includeENS, saveToHistory, historyName, sourceContract), verified
   * against JobOptions in lib/job-processor.ts, and no subject identifiers.
   */
  let jobPayloadsStripped: number | null = null;
  try {
    const stripped = (await db.execute(sql`
      WITH expired AS (
        SELECT id FROM lookup_jobs
        WHERE created_at < now() - make_interval(days => ${JOB_PAYLOAD_RETENTION_DAYS})
          AND (status IN ('completed', 'failed')
            OR updated_at < now() - make_interval(days => ${JOB_PAYLOAD_RETENTION_DAYS}))
          AND (original_data IS NOT NULL
            OR partial_results IS NOT NULL
            OR (jsonb_array_length(wallets) > 0 AND wallets -> 0 <> 'null'::jsonb))
        LIMIT ${JOB_PAYLOAD_STRIP_BATCH}
      )
      UPDATE lookup_jobs j
      SET wallets = (
            SELECT coalesce(jsonb_agg(NULL::text), '[]'::jsonb)
            FROM jsonb_array_elements(j.wallets)
          ),
          original_data = NULL,
          partial_results = NULL
      FROM expired
      WHERE j.id = expired.id
      RETURNING j.id
    `)) as unknown as { rows: unknown[] };
    jobPayloadsStripped = stripped.rows.length;
  } catch (error) {
    console.error('Job payload strip error:', error);
  }

  const auth = await cleanupExpiredAuth();
  const ipBuckets = await cleanupOldIpBuckets(IP_BUCKET_RETENTION_HOURS);
  const authorizationRequests = await cleanupAuthorizationRequests();
  // Batch replay rows; the TTL lives with the writer in lib/idempotency.ts.
  const idempotencyRows = await cleanupIdempotencyKeys();

  const cutoff = new Date(
    Date.now() - ANALYTICS_RETENTION_DAYS * 24 * 60 * 60 * 1000
  );
  const analytics = await db
    .delete(analyticsEvents)
    .where(lt(analyticsEvents.createdAt, cutoff))
    .returning();

  return NextResponse.json({
    sessions: auth.sessionsDeleted,
    magicLinkTokens: auth.tokensDeleted,
    ipBuckets,
    authorizationRequests,
    idempotencyRows,
    analyticsEvents: analytics.length,
    // null means the branch did not run (table absent, or its error is in
    // the logs); 0 means it ran and found nothing due.
    quarantinePurged,
    jobPayloadsStripped,
  });
}

export const POST = run;
export const GET = run;
