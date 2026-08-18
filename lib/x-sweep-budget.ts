/**
 * How many credits the handle-liveness sweep may spend on one run.
 *
 * ## The formula, and the property that makes it safe
 *
 *     cap = (balance - reserve) / daysUntilNextReset
 *
 * Spending that much leaves `balance - (balance - reserve)/D`, which is
 * `reserve + (balance - reserve)(1 - 1/D)`. For any D >= 1 and any balance at
 * or above the reserve, that is **still at or above the reserve**. So the cap
 * cannot drive the balance below the reserve no matter how many times it runs,
 * and a manual run on top of the scheduled one simply takes a smaller slice
 * rather than double-spending an allowance.
 *
 * That property is why the cap is derived from the live balance every run
 * instead of being a fixed number in an env var. A fixed daily number has to be
 * chosen for the worst case and is then wrong on every ordinary day.
 *
 * ## Why the reset date matters more than the allowance
 *
 * On 2026-08-18 the balance was 2,961,004 with 30 days to run. Unspent credits
 * do not roll over, so the question is never "can we afford this" but "what
 * share of what is left may today have". Knowing when the pool refills turns a
 * fixed budget into a self-correcting one.
 *
 * ## Why this is not sized to the arrival rate
 *
 * Because the arrival rate is not a rate. Measured over the seven days to
 * 2026-08-18, new distinct handles per day were 7, 22241, 18, 126, 2, 100 and
 * 421040. Ordinary days add tens; the mean of 63,362 describes no day that
 * happened. A cap sized to the mean would be wildly too large on almost every
 * day and still too small for a bulk ingest, so the cap is sized to the money
 * instead and a spike is absorbed by taking longer.
 */

/** Held back so the token deploy scan can always resolve its account ids. */
export const RESERVE_CREDITS = Number(process.env.X_SWEEP_RESERVE_CREDITS ?? 200_000);

/** Day of the month the allowance refills. Verified with the account owner. */
export const RESET_DAY = Number(process.env.X_RESOLVER_RESET_DAY ?? 17);

/** Credits per by-handle lookup, from the published prices. */
const CREDITS_PER_LOOKUP = 18;

/**
 * The least a run must be allowed before it is worth starting.
 *
 * `sweepHandles` reserves the WORST case before each handle, because `resolve`
 * retries up to three times, so it will not begin a handle unless three
 * lookups' worth of the cap remains. Approving a run on one lookup's worth
 * therefore produced a run that fetched work, spent credits on its control
 * checks, resolved nothing, and returned 502: the cap was above the planner's
 * threshold and below the sweeper's. Both now use the same number.
 *
 * This bites exactly in the near-reserve regime the formula exists to handle
 * gracefully, which is where a silent no-op is least welcome.
 */
export const MIN_VIABLE_CREDITS = CREDITS_PER_LOOKUP * 3;

/**
 * Whole days from `now` to the next reset.
 *
 * Never returns less than 1: a zero would divide the whole remaining balance
 * into a single run, and on reset day itself the honest answer is that a fresh
 * cycle has just begun rather than that today may spend everything.
 */
export function daysUntilReset(now: Date, resetDay = RESET_DAY): number {
  const day = Math.min(Math.max(Math.trunc(resetDay), 1), 28);
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + (now.getUTCDate() >= day ? 1 : 0), day)
  );
  const ms = next.getTime() - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.max(1, Math.round(ms / 86_400_000));
}

export interface SweepBudget {
  /** Credits this run may spend. Zero means it must not run. */
  creditCap: number;
  /** Handles to request, assuming no retries. */
  handleCap: number;
  balance: number;
  reserve: number;
  daysLeft: number;
  /** Set when the run is refused, and why. */
  refusal: string | null;
}

export function planSweep(balance: number | null, now: Date): SweepBudget {
  const daysLeft = daysUntilReset(now);
  const base = {
    balance: balance ?? 0,
    reserve: RESERVE_CREDITS,
    daysLeft,
    creditCap: 0,
    handleCap: 0,
  };

  /**
   * A balance we could not read is NOT treated as plenty.
   *
   * The other budget guards in this codebase fail open, deliberately, because
   * refusing all work over one failed query trades a cost problem for an
   * availability problem. This one fails closed, because the trade is
   * different: nothing customer-facing depends on this sweep running today,
   * and the cost of guessing wrong is real money spent unattended.
   */
  if (balance === null) {
    return { ...base, refusal: 'could not read the credit balance' };
  }
  if (balance <= RESERVE_CREDITS) {
    return {
      ...base,
      refusal: `balance ${balance.toLocaleString()} is at or below the reserve of ${RESERVE_CREDITS.toLocaleString()}`,
    };
  }

  const creditCap = Math.floor((balance - RESERVE_CREDITS) / daysLeft);
  const handleCap = Math.floor(creditCap / CREDITS_PER_LOOKUP);

  if (creditCap < MIN_VIABLE_CREDITS) {
    return {
      ...base,
      creditCap,
      refusal:
        `today's share is ${creditCap} credits, below the ${MIN_VIABLE_CREDITS} ` +
        `a single handle can cost if it has to retry`,
    };
  }
  return { ...base, creditCap, handleCap, refusal: null };
}
