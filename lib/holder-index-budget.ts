/**
 * Daily budget for the ERC-20 holder index.
 *
 * The index bills by compute unit against a **daily** ceiling, and running out
 * takes ERC-20 holder import down on every chain it serves at once: Ethereum,
 * Base, Arbitrum, Polygon, Optimism and BNB Chain. NFT import is unaffected,
 * because it runs on a different provider, and Robinhood Chain is unaffected,
 * because it resolves through its own explorer.
 *
 * On 2026-08-15 an account reached 75% of the day's allowance in about two
 * hours. Almost all of it was one paying customer running eleven contract
 * imports, seven of them at the 10,000-wallet cap. The seed cron accounted for
 * roughly 8% of the requests in the same window.
 *
 * That is the shape of the problem, and it decides the policy, which is the
 * same one `lib/neynar-budget.ts` arrived at for a different provider:
 *
 *   **Measure every spend. Only ever throttle background work.**
 *
 * A customer waiting on an import they paid for must never be refused because
 * a cron spent the day's allowance on a token nobody asked about. The cron is
 * refused instead, and it is refused early enough that a full day of customer
 * imports still fits underneath.
 *
 * ## Why this counts requests
 *
 * The ceiling is denominated in compute units, and the provider publishes no
 * per-endpoint price we can rely on staying put. What we can count exactly is
 * requests, since every page of holders is one. The conversion below is an
 * estimate derived from a real day rather than from a price list, and both
 * halves are env-overridable so a better number can replace it without a
 * deploy. Being wrong here costs accuracy in the cron's cutoff, never a
 * refused customer: no user path consults this to decide whether to run.
 */
import { getDb } from '@/db';
import { sql } from 'drizzle-orm';

const STATE_KEY = 'holder_index_usage';

/** Daily compute-unit ceiling on the plan. Free tier is 40,000. */
export const DAILY_CU_LIMIT = Number(process.env.HOLDER_INDEX_DAILY_CU ?? 40_000);

/**
 * Compute units per holder-page request.
 *
 * **50, and this one is read from the provider rather than inferred.** The
 * response to `GET /erc20/{address}/owners` carries `x-request-weight: 50`, so
 * there is no need to estimate it and no reason to trust an estimate over it.
 * Re-check with one request and `curl -D` if the endpoint or plan ever changes.
 *
 * It was 35, back-derived from a day's totals: "roughly 880 requests consumed
 * about 30,000 units". That arithmetic assumed the day's spend came only from
 * requests we knew about, and it was 30% low. A number worked backwards from a
 * total can only be as good as the assumption that nothing else was in the
 * total, which is exactly the assumption a budget guard should not be making.
 *
 * At 50, a 10,000-holder import costs 101 requests and 5,050 units, so the free
 * allowance is worth about **7.9 such imports a day**, not the 11 the old figure
 * implied.
 */
export const CU_PER_REQUEST = Number(process.env.HOLDER_INDEX_CU_PER_REQUEST ?? 50);

/**
 * Share of the day held back for customer imports.
 *
 * Deliberately much larger than the Neynar guard's 25%. There, background work
 * is the bulk of the spend and users are the exception; here it is the reverse,
 * and the day that prompted this was 92% customer traffic. The cron gets what
 * is left over, not the other way round.
 */
const USER_RESERVE_FRACTION = Number(
  process.env.HOLDER_INDEX_USER_RESERVE ?? 0.8
);

/** Requests a day's allowance is worth, and the slice the cron may have. */
export const DAILY_REQUEST_LIMIT = Math.floor(DAILY_CU_LIMIT / CU_PER_REQUEST);
export const BACKGROUND_CEILING = Math.floor(
  DAILY_REQUEST_LIMIT * (1 - USER_RESERVE_FRACTION)
);

/**
 * The day key. UTC midnight, and **known to be the wrong boundary**.
 *
 * The provider hard-blocked us at 06:11 UTC on 2026-08-16 and was serving again
 * by 15:55 UTC the same day. A UTC-midnight window could not do that: it would
 * have stayed blocked until the following midnight. So their window is a
 * rolling one, or anchored somewhere we cannot see.
 *
 * This comment used to claim the mismatch "only ever makes the cron more
 * cautious near the edge". That is backwards. When our bucket rolls over and
 * theirs has not, our counter reads zero while theirs is nearly full, so the
 * cron believes it has a whole day's allowance at exactly the moment there is
 * none left. That is what happened: 7 imports late on the 15th and 2 early on
 * the 16th sat in one provider window and two of ours.
 *
 * Correcting it properly means a rolling 24-hour sum, which this single-row
 * counter cannot express. Left as a known limitation rather than papered over,
 * because a guard whose window disagrees with the provider's is worth naming.
 */
function currentDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Requests recorded so far today. Returns 0 when the DB is unavailable. */
export async function getDaySpend(): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  const day = currentDay();
  const result = (await db.execute(sql`
    SELECT value->>'requests' AS requests
    FROM ingest_state
    WHERE name = ${STATE_KEY} AND value->>'day' = ${day}
  `)) as unknown as { rows: Array<{ requests: string | null }> };
  return Number(result.rows[0]?.requests ?? 0);
}

/**
 * Add to today's spend. One statement, so concurrent imports cannot lose each
 * other's increments, and the day rolls over on its own when the key changes.
 *
 * **Every** caller reports, customer and cron alike. The cron's ceiling is
 * measured against the whole day's spend, not against its own, or a heavy
 * customer morning would leave the cron thinking it still had room.
 */
export async function recordHolderIndexSpend(requests: number): Promise<void> {
  if (!Number.isFinite(requests) || requests <= 0) return;
  const db = getDb();
  if (!db) return;
  const day = currentDay();
  const n = Math.round(requests);
  try {
    await db.execute(sql`
      INSERT INTO ingest_state (name, value, updated_at)
      VALUES (${STATE_KEY}, jsonb_build_object('day', ${day}, 'requests', ${n}::bigint), now())
      ON CONFLICT (name) DO UPDATE SET
        value = CASE
          WHEN ingest_state.value->>'day' = ${day}
            THEN jsonb_build_object('day', ${day},
                   'requests', ((ingest_state.value->>'requests')::bigint + ${n}::bigint))
          ELSE jsonb_build_object('day', ${day}, 'requests', ${n}::bigint)
        END,
        updated_at = now()
    `);
  } catch (error) {
    // Accounting must never break the work it is measuring.
    console.error('recordHolderIndexSpend failed:', error);
  }
}

export interface HolderBudgetCheck {
  allowed: boolean;
  spent: number;
  ceiling: number;
  remaining: number;
  reason?: string;
}

/**
 * May a BACKGROUND job spend `requests` against the holder index?
 *
 * Customer imports must not call this. They report their spend and are never
 * refused; that is the entire point of the reserve.
 *
 * Fails OPEN when the counter cannot be read. The guard exists to stop runaway
 * background spend, and refusing every seed because one query failed would
 * trade a cost problem for an availability problem.
 */
export async function checkHolderIndexBudget(
  requests: number
): Promise<HolderBudgetCheck> {
  let spent: number;
  try {
    spent = await getDaySpend();
  } catch (error) {
    console.error('checkHolderIndexBudget: could not read spend, allowing:', error);
    return {
      allowed: true,
      spent: 0,
      ceiling: BACKGROUND_CEILING,
      remaining: BACKGROUND_CEILING,
    };
  }

  const remaining = Math.max(0, BACKGROUND_CEILING - spent);
  if (spent + requests > BACKGROUND_CEILING) {
    return {
      allowed: false,
      spent,
      ceiling: BACKGROUND_CEILING,
      remaining,
      reason:
        `Holder index background budget spent: ${spent} of ${BACKGROUND_CEILING} ` +
        `requests today, and this would add ${requests}. The rest of the day's ` +
        `allowance is reserved for customer imports.`,
    };
  }

  return { allowed: true, spent, ceiling: BACKGROUND_CEILING, remaining };
}

/**
 * Requests a holder import of `walletCap` wallets will cost.
 *
 * The index pages 100 at a time, so this is the page count, plus one because a
 * cap that lands on a boundary still needs the request that discovers the end.
 * An over-estimate by one is the right direction for a guard.
 */
export function estimateRequests(walletCap: number): number {
  return Math.ceil(walletCap / 100) + 1;
}
