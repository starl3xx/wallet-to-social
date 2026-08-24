/**
 * Neynar credit budget.
 *
 * Background jobs and live user lookups draw on the same monthly Neynar credit
 * pool. On 2026-08-13 a full protocol sweep pushed the account from ~9M to
 * 11.56M against a 10M limit, and Neynar's overage policy is to pause *all*
 * API requests — which would have taken the live lookup path down with it. The
 * background job had no idea what the account balance was.
 *
 * The policy here follows from that: **measure every spend, but only ever
 * throttle background work.** A user waiting on a lookup they paid for must
 * never be refused because a cron consumed the month's credits; the cron must
 * be refused instead. Background work therefore stops at a ceiling below the
 * plan limit, and the remainder is reserved for user traffic.
 *
 * Accounting note: the bulk user endpoint costs 1 credit per FID requested,
 * which is what every caller here reports. This tracks our own spend rather
 * than reading Neynar's balance (they expose no usage endpoint), so it is an
 * estimate anchored to a seeded starting value — see scripts/seed-neynar-usage.ts.
 * It is deliberately a floor: it can undercount if credits are spent by a path
 * that forgets to report, never overcount into blocking work that was free.
 */
import { getDb } from '@/db';
import { sql } from 'drizzle-orm';

const STATE_KEY = 'neynar_credit_usage';

/** Plan limit. Free tier is 10M/month; override if the plan changes. */
export const MONTHLY_CREDIT_LIMIT = Number(
  process.env.NEYNAR_MONTHLY_CREDITS ?? 10_000_000
);

/**
 * Share of the monthly pool held back for live user lookups. Background jobs
 * may spend the rest. At the default 25%, a runaway cron can consume at most
 * 7.5M and still leaves 2.5M for the product.
 */
const USER_RESERVE_FRACTION = Number(
  process.env.NEYNAR_USER_RESERVE_FRACTION ?? 0.25
);

export const BACKGROUND_CEILING = Math.floor(
  MONTHLY_CREDIT_LIMIT * (1 - USER_RESERVE_FRACTION)
);

/**
 * Billing period key. Neynar bills monthly; we approximate that with the UTC
 * calendar month. If the real reset day differs, the counter resets a few days
 * early or late — which only ever makes the guard more conservative near a
 * boundary, never less.
 */
function currentPeriod(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Credits recorded so far this period. Returns 0 when the DB is unavailable. */
export async function getPeriodSpend(): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  const period = currentPeriod();
  const result = (await db.execute(sql`
    SELECT value->>'credits' AS credits
    FROM ingest_state
    WHERE name = ${STATE_KEY} AND value->>'period' = ${period}
  `)) as unknown as { rows: Array<{ credits: string | null }> };
  return Number(result.rows[0]?.credits ?? 0);
}

/**
 * Add to this period's spend. Atomic: the whole read-modify-write happens in
 * one statement, so concurrent jobs can't lose each other's increments. Rolls
 * over automatically when the period key changes.
 */
export async function recordSpend(credits: number): Promise<void> {
  if (!Number.isFinite(credits) || credits <= 0) return;
  const db = getDb();
  if (!db) return;
  const period = currentPeriod();
  const n = Math.round(credits);
  try {
    await db.execute(sql`
      INSERT INTO ingest_state (name, value, updated_at)
      VALUES (${STATE_KEY}, jsonb_build_object('period', ${period}, 'credits', ${n}::bigint), now())
      ON CONFLICT (name) DO UPDATE SET
        value = CASE
          WHEN ingest_state.value->>'period' = ${period}
            THEN jsonb_build_object('period', ${period},
                   'credits', ((ingest_state.value->>'credits')::bigint + ${n}::bigint))
          ELSE jsonb_build_object('period', ${period}, 'credits', ${n}::bigint)
        END,
        updated_at = now()
    `);
  } catch (error) {
    // Accounting must never break the work it is measuring
    console.error('recordSpend failed:', error);
  }
}

export interface BudgetCheck {
  allowed: boolean;
  spent: number;
  ceiling: number;
  remaining: number;
  reason?: string;
}

/**
 * May a BACKGROUND job spend `credits`? Live user lookups must not call this —
 * they are never throttled, they only report their spend via recordSpend.
 *
 * Fails OPEN when the DB is unreachable: the guard exists to prevent runaway
 * background spend, and blocking every cron because the counter is unreadable
 * would trade a credit problem for an availability problem.
 */
export async function checkBackgroundBudget(
  credits: number
): Promise<BudgetCheck> {
  let spent: number;
  try {
    spent = await getPeriodSpend();
  } catch (error) {
    // getPeriodSpend throws on a query failure, which would otherwise fail the
    // guard CLOSED — the opposite of what this is documented to do. A blip
    // mid-sweep would abort the rest of the range for no reason.
    console.error(
      'checkBackgroundBudget: could not read spend, allowing:',
      error
    );
    return {
      allowed: true,
      spent: 0,
      ceiling: BACKGROUND_CEILING,
      remaining: BACKGROUND_CEILING,
    };
  }
  const remaining = Math.max(0, BACKGROUND_CEILING - spent);
  if (spent + credits > BACKGROUND_CEILING) {
    return {
      allowed: false,
      spent,
      ceiling: BACKGROUND_CEILING,
      remaining,
      reason:
        `Neynar background budget exhausted: ${spent.toLocaleString()} of ` +
        `${BACKGROUND_CEILING.toLocaleString()} spent this period, ` +
        `${credits.toLocaleString()} more requested. The remaining credits up to ` +
        `${MONTHLY_CREDIT_LIMIT.toLocaleString()} are reserved for live lookups.`,
    };
  }
  return { allowed: true, spent, ceiling: BACKGROUND_CEILING, remaining };
}
