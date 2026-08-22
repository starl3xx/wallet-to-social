/**
 * What we sell, in one place.
 *
 * ## Why packs and not a subscription
 *
 * Measured on 2026-08-20, across the product's whole history: 95 of 100
 * identified people were active in exactly one calendar month and never
 * returned, and 104 of 110 person-months consumed under 1,000 wallets. A
 * monthly plan against that distribution posts roughly 95% logo churn at month
 * two, which is nine to twenty-five times worse than the worst benchmark bucket
 * for companies with no annual option. Billing monthly does not create a
 * monthly need; it just adds a cancellation to the end of a one-month
 * relationship.
 *
 * Packs also keep Stripe on `mode: 'payment'`. No customer portal, no dunning,
 * no proration, no subscription lifecycle, and no revocation path to build,
 * which is the single largest piece of unscoped work a subscription would have
 * required against a codebase where `provisionPaidCheckout` is deliberately
 * one-directional.
 *
 * ## Why the unit is a match
 *
 * A match is a wallet we resolved to an X handle or a Farcaster account: the
 * same predicate as `lookup_jobs.any_social_found`. Misses cost the buyer
 * nothing.
 *
 * This is the pricing position and it exists because of a real number. The
 * median hit rate on a real list is 2.7%, and 29 of 64 real-list jobs returned
 * under 2%. Charging by submitted wallet bills people for our coverage gaps.
 * Charging by match makes the weakest number in the product irrelevant to what
 * anyone pays, and it is the only version of "we do not guess" that reaches the
 * invoice.
 *
 * ## Why these boundaries
 *
 * Every one is anchored to observed usage rather than to a round number.
 * `scripts/analyse-pack-fit.ts` recomputes the anchors against live data.
 */

/** Matches per submitted wallet, measured 2026-08-13 on n=600 across 18
 *  collections, 95% CI 20.3-27.1%. Used only to convert a pack into a rough
 *  wallet count for display; never used to bill. */
export const MEASURED_MATCH_RATE = 0.237;

export type PackId = 'trial' | 'campaign' | 'scale' | 'index';

export interface Pack {
  id: PackId;
  name: string;
  /** Cents, so this can be compared with Stripe without a float. */
  priceCents: number;
  /** Matches granted. */
  matches: number;
  /** Why this rung exists, shown in the pricing UI. */
  fits: string;
  /** The env var holding the Stripe Price id. */
  priceEnvVar: string;
}

export const PACKS: Record<PackId, Pack> = {
  trial: {
    id: 'trial',
    name: 'Trial',
    priceCents: 2900,
    matches: 250,
    // ~1,055 wallets at the measured rate. The modal person-month consumed
    // under 1,000 wallets, so this is the exact-fit first purchase.
    fits: 'One list, once',
    priceEnvVar: 'STRIPE_PRICE_PACK_TRIAL',
  },
  campaign: {
    id: 'campaign',
    name: 'Campaign',
    priceCents: 9900,
    matches: 1500,
    // Keeps the $99 headline buyers have already seen on five comparison pages.
    fits: 'A launch or an airdrop',
    priceEnvVar: 'STRIPE_PRICE_PACK_CAMPAIGN',
  },
  scale: {
    id: 'scale',
    name: 'Scale',
    priceCents: 29900,
    matches: 6000,
    // ~25,300 wallets, which is 1.9x the largest job ever run (13,294). A real
    // campaign should be one purchase, not a decision about how to split it.
    fits: 'Several lists, or one large one',
    priceEnvVar: 'STRIPE_PRICE_PACK_SCALE',
  },
  index: {
    id: 'index',
    name: 'Index',
    priceCents: 89900,
    matches: 25000,
    // 2x the largest single person-month observed.
    fits: 'Agencies and repeat work',
    priceEnvVar: 'STRIPE_PRICE_PACK_INDEX',
  },
};

export const PACK_IDS = Object.keys(PACKS) as PackId[];

export function isPackId(value: string): value is PackId {
  return value in PACKS;
}

/**
 * Credits live twelve months from purchase.
 *
 * Long enough that the observed usage shape, a burst and then nothing for
 * months, never loses anyone their credits: the largest gap between two runs by
 * the same person in the whole dataset is well inside a year. Matches the
 * longest expiry found among comparable vendors (Nansen and Hunter both use
 * twelve months) rather than the thirty-day sweep that Apollo, Clearbit and
 * Dropcontact use, which on this distribution would expire almost every credit
 * anyone bought.
 */
export const CREDIT_LIFETIME_DAYS = 365;

/**
 * The lifetime as copy displays it. Derived, so no surface can say a number
 * of months that stopped matching the constant that actually expires lots.
 */
export const CREDIT_LIFETIME_MONTHS = Math.round(CREDIT_LIFETIME_DAYS / 30.44);

/**
 * The free allowance: matches per rolling 30 days, cumulative and account-wide.
 *
 * **Cumulative is the point.** Free was 500 wallets per lookup with unlimited
 * lookups and no cumulative quota, so the largest job in the product's history
 * (13,294 wallets) split into 27 free uploads, and the median job of 300 fitted
 * whole. Nothing the product has ever done needed paying for, which is the
 * likeliest reason 102 accounts produced one sale. A per-lookup cap punishes
 * the honest user and rewards splitting a file; a rolling cumulative one makes
 * splitting pointless.
 *
 * 100 matches is roughly 420 submitted wallets at the measured rate, so it
 * stays close to the 500-per-lookup people already know, while ending the
 * unlimited part.
 */
export const FREE_MATCHES_PER_WINDOW = 100;
export const FREE_WINDOW_DAYS = 30;

/**
 * A submission may be at most this many times the caller's remaining matches.
 *
 * "You only pay for matches" is exploitable without it: submit a million junk
 * addresses, match nothing, pay nothing, and burn our upstream credits. At the
 * measured 23.7% rate a real list needs about 4.2x, so 10x carries a 2.4x
 * safety factor and cannot bite anyone whose list resembles a real one.
 *
 * It is a guard against enumeration, not a quota, which is why it is generous.
 */
export const SUBMISSION_MULTIPLIER = 10;

/**
 * The enumeration ceiling on legacy Unlimited accounts.
 *
 * One account bought "$249 one-time for unlimited wallets forever", a phrase
 * that was published in `app/layout.tsx` schema.org structured data and on
 * five comparison pages until packs replaced it in August 2026. It is
 * honoured: no metering, no expiry, no migration, and the API stays.
 *
 * This is the one condition, and it is deliberately set where it can only ever
 * catch enumeration of the index rather than use of the product. The index
 * holds 1.15M wallets with an X handle; the largest job anybody has ever run is
 * 13,294 wallets. A day that submits more than this is not a customer running
 * campaigns, and nothing a real user does gets near it.
 *
 * Recorded honestly: a cap is a condition attached to a promise that was sold
 * without one. It is set at 75x the largest real job for that reason.
 */
export const LEGACY_UNLIMITED_DAILY_WALLETS = 1_000_000;
