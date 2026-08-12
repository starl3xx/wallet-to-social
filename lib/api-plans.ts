/**
 * API plan limits — the single source of truth.
 *
 * These values are seeded into the `api_plans` table, used to decide which plan
 * each paid tier receives, and rendered in the upgrade modal. They were
 * previously written out separately in all three places, so a limit change
 * could silently leave the pricing copy advertising a number the API no longer
 * enforced.
 *
 * This module deliberately has no imports. The upgrade modal is a client
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

/** The api_plans id this tier is entitled to, or null if it has no API access. */
export function apiPlanForTier(tier: string): string | null {
  return TIER_API_PLAN[tier] ?? null;
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
