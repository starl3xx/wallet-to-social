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
 * as constants, and `app/privacy/page.tsx` states them.
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
 * | OAuth access tokens        | 400 days after they stop working, |
 * |                            | with their usage rows             |
 * | Wallet cache rows          | 7 days (lib/cache-constants.ts)   |
 * | API request records        | 13 months                         |
 * | API rate-limit buckets     | 2 days after their period ends    |
 * | Credit ledger rows         | 7 years, then deleted             |
 * | Credit lots, Stripe ids    | 7 years; purge written, OFF       |
 * | Sanctions screenings       | 5 years, then deleted             |
 * | Lifecycle email records    | While the account exists          |
 *
 * The two removal-system rows run FIRST, and each catches its own errors.
 * Every other branch here is housekeeping; these two are retention promises
 * the privacy policy states, and a promise that stops being kept because an
 * unrelated delete threw is a promise broken silently, on a schedule. The
 * quarantine purge in particular must never wait behind a branch that can
 * fail: past `purge_after` the copy has no reason to exist at all.
 *
 * The retention branches added for STA-45 (cache, API usage, API buckets,
 * payment records) and STA-41 (sanctions screenings) are isolated the same
 * way, each in its own try, because each is a period the privacy page states
 * or will. They run before the housekeeping
 * tail and share one time budget, so a large backlog (the cache had about
 * 498,000 expired rows when it was first wired up) drains over a few daily
 * runs instead of pushing the rest of this job past `maxDuration`.
 *
 * `lifecycle_emails` has no branch on purpose: a row records that a welcome
 * or check-in email went out, which is what stops it going out twice, so it
 * is kept while the account exists and goes with it (ON DELETE CASCADE).
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
import { cleanupAbandonedListJobs } from '@/lib/x-list-worker';
import { cleanupAbandonedClaims } from '@/lib/claim-callback';
import { cleanupIdempotencyKeys } from '@/lib/idempotency';
import { ACCESS_TOKEN_PREFIX } from '@/lib/oauth/grants';
import { cleanExpiredCache } from '@/lib/cache';
import { cleanupOldBuckets } from '@/lib/rate-limiter';
import {
  alertIfListStale,
  alertPendingFreezes,
  sendUnsentAlertRecords,
} from '@/lib/sanctions-alerts';
import {
  clearOldStripeIds,
  countLotsDue,
  countStripeIdsDue,
  deleteOldApiUsage,
  deleteOldLedgerRows,
  deleteOldLots,
  deleteOldScreenings,
  drainBatches,
  RETENTION_DELETE_BATCH,
} from '@/lib/retention';

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

/**
 * How long an OAuth access token's `api_keys` row is kept after the token
 * stops working, whichever comes first of its expiry and its revocation.
 *
 * Every refresh writes a new row (`lib/oauth/grants.ts`) and nothing else
 * ever deleted one. Deleting a row cascades to its `api_usage`,
 * `rate_limit_buckets` and `idempotency_keys` rows, which sets the floor:
 *
 * - at least 366 days, one more than the longest window the admin journey
 *   reads (`MAX_DAYS` in app/api/admin/analytics/journey/route.ts), so no
 *   admin report loses usage it still shows
 * - at least 32 days, so a deleted row can never hold a bucket for the
 *   current calendar month, which the account-wide month quota sums
 *
 * 400 meets both, and it is the analytics horizon above. Keys a person made
 * in the dashboard are never touched here: they last until revoked.
 */
export const OAUTH_TOKEN_RETENTION_DAYS = 400;

/**
 * Token rows deleted per run. Each one takes its usage rows with it, so the
 * bound is on the cascade as much as on the tokens. Steady state is far
 * below it.
 */
export const OAUTH_TOKEN_DELETE_BATCH = 2000;

/**
 * How long a row of `api_usage` (one per API request: key, route template,
 * status, latency, credits) is kept. Thirteen months covers the longest
 * window anything reads, the admin journey's `MAX_DAYS` (365), with a month
 * to spare; `scripts/check-invariants.ts` asserts it against every
 * thirteen-month span, the shortest included.
 */
export const API_USAGE_RETENTION_MONTHS = 13;

/**
 * How long an API rate-limit bucket (`rate_limit_buckets`) is kept after the
 * minute, day or month it counts has ENDED. Aged by its period, never by its
 * row's creation, because the account-wide quota reads the current month's
 * bucket until the month is over; see `bucketRetentionKeys` in
 * lib/rate-limiter.ts. The IP buckets have their own period above.
 */
export const API_BUCKET_RETENTION_DAYS = 2;

/**
 * How long payment records are kept: `credit_ledger`, `credit_lots` and the
 * Stripe ids on `users`, for tax and accounting. The rules for what may go
 * after that are in lib/retention.ts.
 */
export const PAYMENT_RECORD_RETENTION_YEARS = 7;

/**
 * How long a sanctions screening record is kept (`sanctions_screenings`: the
 * payer, the list's publish date, the verdict, the time). Five years, decided
 * 2026-09-25 (Linear STA-41); the lawyer may lengthen it (Linear STA-49).
 */
export const SANCTIONS_SCREENING_RETENTION_YEARS = 5;

/**
 * Whether the purge may delete `credit_lots` rows and clear the Stripe ids on
 * `users` once they pass the period. OFF, deliberately, and it stays off
 * until three things outlive the lot, because today each is read from it:
 *
 * 1. the replay key: a grant for a payment that already bought a lot must
 *    stay a no-op after the lot is gone (the same holds for the legacy tier
 *    grant and `users.stripe_payment_id`)
 * 2. the x402 loyalty count, which counts every settled lot a wallet bought
 * 3. "has bought", which the lifecycle mail reads as "holds a paid lot"
 *
 * Nothing is due before August 2033 (no payment on record is older than
 * August 2026), and the route reports the count that would go on every run,
 * so the switch can be made with the number in hand. `credit_ledger` is not
 * gated: its rule is safe as written, and it runs.
 */
export const PURCHASE_RECORD_PURGE_ENABLED = false;

/**
 * The time the retention branches below share, from when the first of them
 * starts. Each runs at least one batch; after that, a branch stops when the
 * budget is spent and the next daily run carries on. It leaves the rest of
 * `maxDuration` for the housekeeping tail.
 */
export const RETENTION_BUDGET_MS = 30_000;

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

  /**
   * OAuth access tokens that can never authenticate again, isolated the same
   * way. A row goes only when all of these hold:
   *
   * - `oauth_grant_id` is set and the key carries the access-token prefix,
   *   two independent marks, so a key a person made (`wts_live_`) is never
   *   in reach
   * - it stopped working, by expiry or revocation, more than
   *   OAUTH_TOKEN_RETENTION_DAYS ago. `LEAST` skips a NULL, and every access
   *   token is minted with `expires_at`; a row with neither date is kept.
   *
   * Aged from when the token stopped working, never from `created_at`, and
   * with `now()` in SQL rather than a JS Date. The cascade takes the row's
   * usage, bucket and replay rows with it; see the constant for why the
   * period is long enough that no report or quota notices.
   */
  let oauthAccessTokens: number | null = null;
  try {
    const deleted = (await db.execute(sql`
      WITH spent AS (
        SELECT id FROM api_keys
        WHERE oauth_grant_id IS NOT NULL
          AND starts_with(key_prefix, ${ACCESS_TOKEN_PREFIX})
          AND LEAST(expires_at, revoked_at) < now() - make_interval(days => ${OAUTH_TOKEN_RETENTION_DAYS})
        LIMIT ${OAUTH_TOKEN_DELETE_BATCH}
      )
      DELETE FROM api_keys k USING spent WHERE k.id = spent.id
      RETURNING 1
    `)) as unknown as { rows: unknown[] };
    oauthAccessTokens = deleted.rows.length;
  } catch (error) {
    console.error('OAuth access token cleanup error:', error);
  }

  /**
   * The STA-45 retention branches. Each in its own try, for the reason the
   * quarantine purge is; the cache goes last because it is the only one
   * with a real backlog, so it takes whatever the budget has left.
   */
  const retentionDeadline = Date.now() + RETENTION_BUDGET_MS;

  let apiUsageRows: number | null = null;
  try {
    apiUsageRows = await drainBatches(
      () =>
        deleteOldApiUsage(
          db,
          API_USAGE_RETENTION_MONTHS,
          RETENTION_DELETE_BATCH
        ),
      retentionDeadline
    );
  } catch (error) {
    console.error('API usage cleanup error:', error);
  }

  let apiBuckets: number | null = null;
  try {
    apiBuckets = await cleanupOldBuckets(
      API_BUCKET_RETENTION_DAYS,
      retentionDeadline,
      db
    );
  } catch (error) {
    console.error('API rate-limit bucket cleanup error:', error);
  }

  let creditLedgerRows: number | null = null;
  try {
    creditLedgerRows = await drainBatches(
      () =>
        deleteOldLedgerRows(
          db,
          PAYMENT_RECORD_RETENTION_YEARS,
          RETENTION_DELETE_BATCH
        ),
      retentionDeadline
    );
  } catch (error) {
    console.error('Credit ledger cleanup error:', error);
  }

  // STA-41: the screening record, five years (deleteOldScreenings).
  let sanctionsScreenings: number | null = null;
  try {
    sanctionsScreenings = await drainBatches(
      () =>
        deleteOldScreenings(
          db,
          SANCTIONS_SCREENING_RETENTION_YEARS,
          RETENTION_DELETE_BATCH
        ),
      retentionDeadline
    );
  } catch (error) {
    console.error('Sanctions screening cleanup error:', error);
  }

  /**
   * Lots and Stripe ids: counted every run, deleted only when the flag is
   * on. `purged: false` with a non-zero count is the signal that the
   * decision in the flag's comment is due.
   */
  let purchaseRecords: {
    purged: boolean;
    creditLots: number;
    stripeIds: number;
  } | null = null;
  try {
    if (PURCHASE_RECORD_PURGE_ENABLED) {
      const creditLots = await drainBatches(
        () =>
          deleteOldLots(
            db,
            PAYMENT_RECORD_RETENTION_YEARS,
            RETENTION_DELETE_BATCH
          ),
        retentionDeadline
      );
      const stripeIds = await drainBatches(
        () =>
          clearOldStripeIds(
            db,
            PAYMENT_RECORD_RETENTION_YEARS,
            RETENTION_DELETE_BATCH
          ),
        retentionDeadline
      );
      purchaseRecords = { purged: true, creditLots, stripeIds };
    } else {
      purchaseRecords = {
        purged: false,
        creditLots: await countLotsDue(db, PAYMENT_RECORD_RETENTION_YEARS),
        stripeIds: await countStripeIdsDue(db, PAYMENT_RECORD_RETENTION_YEARS),
      };
    }
  } catch (error) {
    console.error('Purchase record purge error:', error);
  }

  let walletCacheRows: number | null = null;
  try {
    walletCacheRows = await cleanExpiredCache(retentionDeadline, db);
  } catch (error) {
    console.error('Wallet cache cleanup error:', error);
  }

  const auth = await cleanupExpiredAuth();
  const ipBuckets = await cleanupOldIpBuckets(IP_BUCKET_RETENTION_HOURS);
  const authorizationRequests = await cleanupAuthorizationRequests();
  // An X list job whose consent screen was closed: the member list and the
  // PKCE verifier go, the row stays as a record that it was started.
  const abandonedListJobs = await cleanupAbandonedListJobs();
  // The same shape one flow over: an identity claim whose consent screen was
  // closed leaves a wallet signature and a live PKCE verifier behind.
  const abandonedClaims = await cleanupAbandonedClaims();
  // Batch replay rows; the TTL lives with the writer in lib/idempotency.ts.
  const idempotencyRows = await cleanupIdempotencyKeys();

  const cutoff = new Date(
    Date.now() - ANALYTICS_RETENTION_DAYS * 24 * 60 * 60 * 1000
  );
  const analytics = await db
    .delete(analyticsEvents)
    .where(lt(analyticsEvents.createdAt, cutoff))
    .returning();

  /**
   * Not a deletion: the watchdog for the sanctions alerts (STA-41). The
   * refresh cron emails a stale list, a freeze and the durable alert records,
   * but a job that has stopped running cannot report that it stopped, so this
   * daily job checks the same database state and sends the same emails under
   * the same claims. Last, after the housekeeping, because a slow mail
   * provider must not cost the deletes above; every send has its own timeout.
   * Never throws.
   */
  const sanctionsListAlert = await alertIfListStale(db);
  const sanctionsFreezeAlert = await alertPendingFreezes(db);
  const sanctionsAlertRecords = await sendUnsentAlertRecords(db);

  return NextResponse.json({
    sessions: auth.sessionsDeleted,
    magicLinkTokens: auth.tokensDeleted,
    ipBuckets,
    authorizationRequests,
    abandonedListJobs,
    abandonedClaims,
    idempotencyRows,
    analyticsEvents: analytics.length,
    // null means the branch did not run (table absent, or its error is in
    // the logs); 0 means it ran and found nothing due.
    quarantinePurged,
    jobPayloadsStripped,
    oauthAccessTokens,
    apiUsageRows,
    apiBuckets,
    creditLedgerRows,
    sanctionsScreenings,
    sanctionsListAlert,
    sanctionsFreezeAlert,
    sanctionsAlertRecords,
    purchaseRecords,
    walletCacheRows,
  });
}

export const POST = run;
export const GET = run;
