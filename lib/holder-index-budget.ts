/**
 * Daily budget for the ERC-20 holder index.
 *
 * The index bills by compute unit against a **daily** ceiling.
 *
 * Running out used to take ERC-20 holder import down on every chain it serves
 * at once: Ethereum, Base, Arbitrum, Polygon, Optimism and BNB Chain. Since
 * 2026-08-17 a customer import that meets a spent allowance retries against the
 * chain's public Blockscout explorer, so **BNB Chain is the only one left where
 * exhaustion still stops the feature** — it is the one metered chain with no
 * public instance. See BLOCKSCOUT_BASE_URLS in `lib/contract-holders.ts`.
 *
 * That makes this budget less load-bearing for availability and no less
 * load-bearing for cost: the fallback is slower, less complete on Base, and
 * somebody else's infrastructure. It is a safety net, not a second supplier.
 *
 * NFT import was never affected, because it runs on a different provider, and
 * Robinhood Chain was never affected, because its explorer is its primary
 * source rather than a fallback.
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
 * The ceiling is denominated in compute units. What we can count exactly is
 * requests, since every page of holders is one, and the provider states the
 * conversion in the response itself: `x-request-weight: 50`. Both halves stay
 * env-overridable so a plan change can be absorbed without a deploy.
 *
 * Being wrong here costs accuracy in the cron's cutoff, never a refused
 * customer: no user path consults this to decide whether to run.
 */
import { getDb } from '@/db';
import { sql } from 'drizzle-orm';

const STATE_KEY = 'holder_index_usage';

/** Daily compute-unit ceiling on the plan. Free tier is 40,000. */
export const DAILY_CU_LIMIT = Number(
  process.env.HOLDER_INDEX_DAILY_CU ?? 40_000
);

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
export const CU_PER_REQUEST = Number(
  process.env.HOLDER_INDEX_CU_PER_REQUEST ?? 50
);

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
 * The window is a trailing 24 hours, not a calendar day.
 *
 * It was a UTC-midnight bucket, and that was the wrong shape. The provider
 * hard-blocked us at 06:11 UTC on 2026-08-16 and was serving again by 15:55 UTC
 * **the same day**, which a UTC-midnight window cannot do: it would have stayed
 * blocked until the following midnight. Their window rolls, or is anchored
 * somewhere we cannot see.
 *
 * A bucket that rolls over at a different moment from theirs does not fail
 * safely. When ours resets and theirs has not, our counter reads zero while
 * theirs is nearly full, so the cron believes it has a whole day's allowance at
 * exactly the moment there is none left. That is how the block happened: seven
 * imports late on the 15th and two early on the 16th sat in one provider window
 * and two of ours.
 *
 * A trailing sum cannot be in phase with theirs either, because their anchor is
 * unknown. What it can do is never be *behind* it: any request inside the last
 * 24 hours is counted, whatever boundary the provider draws through it. That
 * turns the mismatch from a hole into, at worst, a little extra caution.
 */
const WINDOW_SECONDS = 24 * 60 * 60;

/**
 * Requests in the trailing 24 hours. Returns 0 when the DB is unavailable.
 *
 * The `CASE jsonb_typeof` guard reads a row written by the old shape,
 * `{day, requests}`, as an empty window rather than throwing. There is no such
 * row in production, because the write that would have created one never
 * landed, but a guard that crashes on unexpected state is worse than one that
 * starts from zero.
 */
export async function getRollingSpend(): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  const result = (await db.execute(sql`
    SELECT coalesce(sum((e->>'n')::bigint), 0) AS requests
    FROM ingest_state,
         jsonb_array_elements(
           CASE jsonb_typeof(value->'events')
             WHEN 'array' THEN value->'events'
             ELSE '[]'::jsonb
           END) AS e
    WHERE name = ${STATE_KEY}
      AND (e->>'at')::bigint > extract(epoch from now())::bigint - ${WINDOW_SECONDS}
  `)) as unknown as { rows: Array<{ requests: string | null }> };
  return Number(result.rows[0]?.requests ?? 0);
}

/**
 * Append a spend event, pruning anything older than the window.
 *
 * One statement, so concurrent imports cannot lose each other's writes. That
 * mattered under the old day-bucket shape and it matters more here: a
 * read-modify-write on an array in JS would drop a whole event under
 * concurrency, not merely an increment.
 *
 * **Every** caller reports, customer and cron alike. The cron's ceiling is
 * measured against the whole window's spend, not against its own, or a heavy
 * customer morning would leave the cron thinking it still had room.
 *
 * The `LIMIT` is a backstop, not the mechanism. Time pruning already bounds the
 * array to a day's writes, which is tens of entries in practice; the cap only
 * stops a runaway loop turning one row into something unbounded.
 */
export async function recordHolderIndexSpend(requests: number): Promise<void> {
  if (!Number.isFinite(requests) || requests <= 0) return;
  const db = getDb();
  if (!db) return;
  const n = Math.round(requests);
  try {
    await db.execute(sql`
      INSERT INTO ingest_state (name, value, updated_at)
      VALUES (
        ${STATE_KEY},
        jsonb_build_object('events', jsonb_build_array(
          jsonb_build_object('at', extract(epoch from now())::bigint, 'n', ${n}::bigint))),
        now()
      )
      ON CONFLICT (name) DO UPDATE SET
        value = jsonb_build_object('events',
          (
            SELECT coalesce(jsonb_agg(kept ORDER BY (kept->>'at')::bigint), '[]'::jsonb)
            FROM (
              SELECT e AS kept
              FROM jsonb_array_elements(
                     CASE jsonb_typeof(ingest_state.value->'events')
                       WHEN 'array' THEN ingest_state.value->'events'
                       ELSE '[]'::jsonb
                     END) AS e
              WHERE (e->>'at')::bigint > extract(epoch from now())::bigint - ${WINDOW_SECONDS}
              ORDER BY (e->>'at')::bigint DESC
              LIMIT 2000
            ) recent
          ) || jsonb_build_array(
            jsonb_build_object('at', extract(epoch from now())::bigint, 'n', ${n}::bigint))
        ),
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
    spent = await getRollingSpend();
  } catch (error) {
    console.error(
      'checkHolderIndexBudget: could not read spend, allowing:',
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
