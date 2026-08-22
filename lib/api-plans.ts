/**
 * API rate-limit presets: the single source of truth.
 *
 * These values are seeded into the `api_plans` table and shown in the API keys
 * modal. They are presets, not products: nothing sells them, and every credit
 * holder gets `CREDIT_API_PLAN`. The `priceMonthly` column is historical. They
 * were previously written out separately in three places, so a limit change
 * could silently leave the copy advertising a number the API no longer
 * enforced.
 *
 * This module deliberately has no imports. The API keys modal is a client
 * component, and `lib/api-keys.ts` pulls in the database layer.
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
 * The plan a credit-holding account gets, whatever its tier.
 *
 * `developer`, matching what legacy Pro received: 60 requests a minute, 5,000 a
 * day. The rate limit is about protecting the service from a burst, and a pack
 * buyer bursts no harder than a Pro buyer did. What they may actually consume
 * is bounded by their credit balance, which is a separate and much tighter
 * limit, so there is nothing to gain by rationing them twice.
 */
export const CREDIT_API_PLAN = 'developer';

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
