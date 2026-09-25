/**
 * The retention deletes the daily cleanup runs (app/api/cron/cleanup/route.ts),
 * one bounded batch per call.
 *
 * The periods live in the route, as constants the privacy page reads; the
 * statements live here and take the period and the database as arguments, so
 * the exact SQL the cron runs can be run against a local Postgres with rows
 * that must go and rows that must stay. Every statement:
 *
 * - selects a bounded batch in a CTE, then deletes by primary key with the
 *   age predicate repeated on the target row, so a row a concurrent writer
 *   changed after the CTE read it is re-checked before it goes
 * - compares against `now() AT TIME ZONE 'UTC'`. Every column here is a
 *   timestamp without time zone holding UTC wall time (JS Dates through
 *   Drizzle, or `defaultNow()` under the GMT session), so the comparison must
 *   not depend on the session's zone
 * - returns how many rows it removed, so the route can report it
 *
 * ## Payment records
 *
 * Kept `PAYMENT_RECORD_RETENTION_YEARS` (7), for tax and accounting, and then
 * purged. The code reads these tables for more than accounting, so a row goes
 * only when nothing live can still depend on it:
 *
 * - `credit_ledger` rows are the free allowance's meter (30 days), the legacy
 *   daily ceiling (24 hours) and the per-job idempotency key for a charge and
 *   an unlock. A row goes when it is past the period, no unexpired lot that
 *   predates it could have paid for it, and its job is neither still running
 *   (the charge's key) nor, for an unlock row, still gated (the unlock's key).
 *   Nothing else reads a ledger row older than a month.
 * - `credit_lots` rows and the Stripe ids on `users` are more than records.
 *   A lot row is the only thing that makes a repeated grant for the same
 *   payment a no-op (its `stripe_payment_id` and `settlement_id` are unique
 *   keys the grant paths rely on), the x402 loyalty bonus counts every
 *   settled lot a wallet ever bought, and the lifecycle mail reads "holds a
 *   paid lot" as "has bought". `users.stripe_payment_id` is the same kind of
 *   key for the legacy tier grant. Deleting any of them changes what the
 *   product does, not just what it remembers, so those two statements are
 *   written and counted but run only when `PURCHASE_RECORD_PURGE_ENABLED` in
 *   the route is true, and it is false. What must change first is recorded
 *   beside the flag.
 */
import { sql, type SQL } from 'drizzle-orm';

/**
 * What these statements need from a database: Drizzle's `execute`. Structural
 * rather than the app's own union type, so a PGlite-backed Drizzle can run
 * them too.
 */
export interface RetentionDb {
  execute(query: SQL): Promise<unknown>;
}

/** `now()` as UTC wall time, to compare with a timestamp without time zone. */
export const UTC_NOW = sql`(now() AT TIME ZONE 'UTC')`;

/** Rows per statement for the retention deletes. */
export const RETENTION_DELETE_BATCH = 5000;

function rowCount(result: unknown): number {
  return ((result as { rows?: unknown[] }).rows ?? []).length;
}

/**
 * Run `batch` until it removes fewer rows than `limit` (the backlog is gone)
 * or `deadline` (a `Date.now()` value) has passed. At least one batch always
 * runs. A backlog larger than the deadline allows drains over the following
 * days, because the cleanup runs daily.
 */
export async function drainBatches(
  batch: () => Promise<number>,
  limit: number,
  deadline: number
): Promise<number> {
  let total = 0;
  for (;;) {
    const removed = await batch();
    total += removed;
    if (removed < limit || Date.now() >= deadline) return total;
  }
}

/** One batch of `api_usage` rows older than `months`. */
export async function deleteOldApiUsage(
  db: RetentionDb,
  months: number,
  limit: number
): Promise<number> {
  const cutoff = sql`${UTC_NOW} - make_interval(months => ${months})`;
  return rowCount(
    await db.execute(sql`
      WITH due AS (
        SELECT id FROM api_usage
        WHERE created_at < ${cutoff}
        LIMIT ${limit}
      )
      DELETE FROM api_usage u USING due
      WHERE u.id = due.id AND u.created_at < ${cutoff}
      RETURNING 1
    `)
  );
}

/**
 * The ledger rows the purge may take: past the period, no unexpired lot that
 * predates the row (so none it could have drawn on is still live), and no job
 * that can still be charged or unlocked against it. See the module header.
 */
function ledgerRowDue(alias: string, years: number): SQL {
  const r = sql.raw(alias);
  return sql`${r}.created_at < ${UTC_NOW} - make_interval(years => ${years})
    AND NOT EXISTS (
      SELECT 1 FROM credit_lots l
      WHERE l.user_id = ${r}.user_id
        AND l.created_at <= ${r}.created_at
        AND l.expires_at > ${UTC_NOW}
    )
    AND NOT EXISTS (
      SELECT 1 FROM lookup_jobs j
      WHERE j.id = ${r}.job_id
        AND (j.status NOT IN ('completed', 'failed')
          OR (${r}.paid_from = 'unlock' AND j.matches_delivered IS NOT NULL))
    )`;
}

/** One batch of `credit_ledger` rows past `years` that nothing live reads. */
export async function deleteOldLedgerRows(
  db: RetentionDb,
  years: number,
  limit: number
): Promise<number> {
  return rowCount(
    await db.execute(sql`
      WITH due AS (
        SELECT cl.id FROM credit_ledger cl
        WHERE ${ledgerRowDue('cl', years)}
        LIMIT ${limit}
      )
      DELETE FROM credit_ledger c USING due
      WHERE c.id = due.id AND ${ledgerRowDue('c', years)}
      RETURNING 1
    `)
  );
}

/** A lot past `years` that has also expired, so no balance can read it. */
function lotDue(alias: string, years: number): SQL {
  const r = sql.raw(alias);
  return sql`${r}.created_at < ${UTC_NOW} - make_interval(years => ${years})
    AND ${r}.expires_at <= ${UTC_NOW}`;
}

/** How many lots the purge would take. Read whether or not it may run. */
export async function countLotsDue(
  db: RetentionDb,
  years: number
): Promise<number> {
  const result = (await db.execute(
    sql`SELECT count(*)::int AS n FROM credit_lots l WHERE ${lotDue('l', years)}`
  )) as { rows: Array<{ n: number }> };
  return Number(result.rows[0]?.n ?? 0);
}

/**
 * One batch of expired lots past `years`. Called only when the route's
 * `PURCHASE_RECORD_PURGE_ENABLED` is true; see the module header for why it
 * is not.
 */
export async function deleteOldLots(
  db: RetentionDb,
  years: number,
  limit: number
): Promise<number> {
  return rowCount(
    await db.execute(sql`
      WITH due AS (
        SELECT l.id FROM credit_lots l
        WHERE ${lotDue('l', years)}
        LIMIT ${limit}
      )
      DELETE FROM credit_lots c USING due
      WHERE c.id = due.id AND ${lotDue('c', years)}
      RETURNING 1
    `)
  );
}

/** A user whose legacy tier was paid for more than `years` ago. */
function stripeIdsDue(alias: string, years: number): SQL {
  const r = sql.raw(alias);
  return sql`${r}.paid_at < ${UTC_NOW} - make_interval(years => ${years})
    AND (${r}.stripe_customer_id IS NOT NULL OR ${r}.stripe_payment_id IS NOT NULL)`;
}

/** How many accounts the Stripe-id clear would touch. */
export async function countStripeIdsDue(
  db: RetentionDb,
  years: number
): Promise<number> {
  const result = (await db.execute(
    sql`SELECT count(*)::int AS n FROM users u WHERE ${stripeIdsDue('u', years)}`
  )) as { rows: Array<{ n: number }> };
  return Number(result.rows[0]?.n ?? 0);
}

/**
 * One batch of accounts whose Stripe ids are cleared. The account, its tier
 * and `paid_at` stay. Gated like `deleteOldLots`.
 */
export async function clearOldStripeIds(
  db: RetentionDb,
  years: number,
  limit: number
): Promise<number> {
  return rowCount(
    await db.execute(sql`
      WITH due AS (
        SELECT u.id FROM users u
        WHERE ${stripeIdsDue('u', years)}
        LIMIT ${limit}
      )
      UPDATE users t
      SET stripe_customer_id = NULL, stripe_payment_id = NULL
      FROM due
      WHERE t.id = due.id AND ${stripeIdsDue('t', years)}
      RETURNING 1
    `)
  );
}
