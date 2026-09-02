/**
 * API rate-limit presets: the single source of truth.
 *
 * These values are seeded into the `api_plans` table and shown in the API keys
 * modal. They are presets, not products: nothing sells them directly, and every
 * credit holder's key is stored on `CREDIT_API_PLAN`. What a pack DOES buy is a
 * rung on the ladder below (`PACK_API_PLAN`): the limits a request is served
 * under are decided per request in `lib/api-auth.ts` from the account's
 * unexpired packs, never from anything a caller sends. The `priceMonthly`
 * column is historical. These were previously written out separately in three
 * places, so a limit change could silently leave the copy advertising a number
 * the API no longer enforced.
 *
 * This module deliberately has no imports. The API keys modal is a client
 * component, and `lib/api-keys.ts` pulls in the database layer. The pack ids in
 * `PACK_API_PLAN` are written as strings for the same reason: importing
 * `PackId` from `lib/packs.ts` would be a type-only truth, and the runtime keys
 * still have to match `credit_lots.pack`, which is `text`.
 */

export interface ApiPlanLimits {
  id: string;
  name: string;
  /** Cents per month, for the standalone plans that are seeded but not sold. */
  priceMonthly: number;
  requestsPerMinute: number;
  /** -1 means unlimited. */
  requestsPerDay: number;
  requestsPerMonth: number;
  maxBatchSize: number;
}

export const API_PLANS: Record<string, ApiPlanLimits> = {
  developer: {
    id: 'developer',
    name: 'Developer',
    priceMonthly: 4900,
    requestsPerMinute: 60,
    requestsPerDay: 5000,
    requestsPerMonth: 50000,
    maxBatchSize: 50,
  },
  startup: {
    id: 'startup',
    name: 'Startup',
    priceMonthly: 19900,
    requestsPerMinute: 300,
    requestsPerDay: 50000,
    requestsPerMonth: 500000,
    maxBatchSize: 200,
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    priceMonthly: 79900,
    requestsPerMinute: 1000,
    requestsPerDay: -1,
    requestsPerMonth: -1,
    maxBatchSize: 1000,
  },
};

/**
 * Which api_plans row each paid tier is entitled to.
 *
 * Derived from the tier and never read from a request — the key-creation
 * endpoint used to take `plan` from the body, which would have let a Pro
 * account ask for `enterprise` limits.
 */
export const TIER_API_PLAN: Record<string, string> = {
  pro: 'developer',
  unlimited: 'startup',
};

/**
 * Ladder order, so one tier can be compared against another.
 *
 * Lived in `app/api/admin/revenue/route.ts`, which needed it to tell a tier
 * held from a tier purchased. It belongs here with the rest of the tier
 * definitions: the second caller was a provisioning script that overwrote a
 * tier somebody had raised by hand, precisely because it had no way to ask
 * which of two tiers was higher.
 */
export const TIER_RANK: Record<string, number> = {
  free: 0,
  pro: 1,
  unlimited: 2,
};

/**
 * The plan a credit-holding account gets by default, whatever its tier.
 *
 * `developer`, matching what legacy Pro received: 60 requests a minute, 5,000 a
 * day. The rate limit is about protecting the service from a burst, and a pack
 * buyer bursts no harder than a Pro buyer did. What they may actually consume
 * is bounded by their credit balance, which is a separate and much tighter
 * limit, so there is nothing to gain by rationing them twice.
 *
 * This is also the plan stored on every credit-holder's key row. The larger
 * packs raise the limits a request is actually served under through
 * `ladderedPlanId` below, at request time, so the entitlement follows the
 * pack's twelve-month life instead of being frozen into the key at creation.
 */
export const CREDIT_API_PLAN = 'developer';

/**
 * Which rate-limit preset each pack entitles its buyer to, for the pack's
 * unexpired lifetime (docs/AGENT-SYSTEM.md, gap 17).
 *
 * Before this, every pack mapped to `developer`, so nothing a caller could buy
 * raised the 60/minute, 50-batch ceiling, and a $899 Index buyer was paced
 * identically to a $1 Agent buyer. The ladder:
 *
 *  - Trial and Campaign stay on `developer`: their credit totals (250 and
 *    1,500) fit comfortably inside its windows.
 *  - Scale maps to `startup` (300/min, 200-address batches): 6,000 credits at
 *    60/min is over an hour and a half of solid calling for one full spend.
 *  - Index maps to `enterprise` (1,000/min, 1,000-address batches).
 *
 * The Agent pack and hand grants map to `developer` by omission: `planForPacks`
 * treats any pack absent here as the default, so a new pack id fails safe
 * rather than fast.
 *
 * Credits keep bounding totals either way. The plan is a burst limit; what an
 * account may resolve in total is its match balance, checked account-wide in
 * `lib/api-auth.ts`, so the export-licence hole the account-level cap closed
 * stays closed at every rung.
 */
export const PACK_API_PLAN: Record<string, string> = {
  trial: 'developer',
  campaign: 'developer',
  scale: 'startup',
  index: 'enterprise',
};

/**
 * Ladder order for the plans themselves, mirroring `TIER_RANK` for tiers.
 * Needed because "the highest pack decides" is a comparison, and comparing by
 * price or by any field of the plan row would break the day two plans tie.
 */
export const API_PLAN_RANK: Record<string, number> = {
  developer: 0,
  startup: 1,
  enterprise: 2,
};

/**
 * The plan an account's packs entitle it to.
 *
 * The decision recorded here (gap 17): the account's highest-tier UNEXPIRED
 * pack decides, whether or not that pack still has credits remaining. That is
 * the reading that matches what $299 buys: twelve months of the startup
 * preset, the same twelve months the credits live, not "startup limits until
 * you spend the credits" (which would demote an account mid-run on the last
 * batch of a campaign). An expired pack entitles nothing.
 *
 * Derived from `credit_lots` rows the server read, never from a request: the
 * key-creation endpoint used to take `plan` from the body, and this function
 * exists so that mistake cannot come back wearing a pack id.
 */
export function planForPacks(packs: string[]): string {
  let best = CREDIT_API_PLAN;
  for (const pack of packs) {
    const plan = PACK_API_PLAN[pack];
    if (plan && (API_PLAN_RANK[plan] ?? 0) > (API_PLAN_RANK[best] ?? 0)) {
      best = plan;
    }
  }
  return best;
}

/**
 * The plan a request is served under: the stored plan or the pack-derived one,
 * whichever ranks higher.
 *
 * Never lower than the stored plan, so a plan raised by hand (support sets a
 * key's plan directly) survives the buyer's packs expiring. The ladder only
 * ever raises.
 */
export function ladderedPlanId(storedPlanId: string, packs: string[]): string {
  const fromPacks = planForPacks(packs);
  return (API_PLAN_RANK[fromPacks] ?? 0) > (API_PLAN_RANK[storedPlanId] ?? 0)
    ? fromPacks
    : storedPlanId;
}

/**
 * The largest batch any plan allows, derived rather than typed. The MCP input
 * schema uses it as the syntactic ceiling so the zod cap cannot refuse a list
 * the caller's real plan would accept; the v1 handler enforces the caller's
 * actual plan ceiling.
 */
export const MAX_PLAN_BATCH_SIZE = Math.max(
  ...Object.values(API_PLANS).map((p) => p.maxBatchSize)
);

/**
 * The smallest list `/v1/estimate` accepts (docs/AGENT-SYSTEM.md, gap 19).
 *
 * The estimate is free and counts-only, the same disclosure class as the free
 * reverse count. A minimum keeps it that class: with a list of one, "how many
 * of these are in the index" is a per-wallet membership oracle, and a loop
 * over it would walk the index one free bit at a time. Ten wallets is small
 * enough that any real list clears it and large enough that the counts stay
 * aggregates.
 */
export const ESTIMATE_MIN_WALLETS = 10;

/** The api_plans id this tier is entitled to, or null if it has no API access. */
export function apiPlanForTier(tier: string): string | null {
  return TIER_API_PLAN[tier] ?? null;
}

/**
 * The plan for an account, from either entitlement.
 *
 * A legacy tier wins where it is higher, so an Unlimited account that also buys
 * a pack keeps `startup` rather than being quietly demoted to `developer`.
 */
export function apiPlanForAccount(
  tier: string,
  hasCredits: boolean
): string | null {
  return apiPlanForTier(tier) ?? (hasCredits ? CREDIT_API_PLAN : null);
}

/** Daily request allowance for a tier, or null if it has no API access. */
export function apiRequestsPerDay(tier: string): number | null {
  const planId = apiPlanForTier(tier);
  if (!planId) return null;
  return API_PLANS[planId]?.requestsPerDay ?? null;
}

/** Human-readable allowance, e.g. "5,000 requests/day". Handles the -1 sentinel. */
export function apiAllowanceLabel(tier: string): string | null {
  const perDay = apiRequestsPerDay(tier);
  if (perDay === null) return null;
  if (perDay < 0) return 'unlimited requests';
  return `${perDay.toLocaleString()} requests/day`;
}
