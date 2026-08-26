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
 * Every one is anchored to observed usage rather than to a round number. The
 * measurements behind them are quoted at each entry; there is no script that
 * recomputes them, and a comment here claimed there was one until 2026-08-26.
 *
 * ## Why the ladder only ever gets cheaper per match
 *
 * Starter $0.133, Trial $0.116, Campaign $0.066, Scale $0.050, Index $0.036.
 * Strictly descending, and it has to be: a smaller pack priced below a larger
 * one per match is an arbitrage against us, since the buyer who wants the
 * larger amount buys the smaller pack several times over. Buying Trial's 250
 * matches in Starter rungs costs $33.33 against $29, so stepping up is always
 * the cheaper way to get more. `scripts/check-invariants.ts` asserts both
 * properties, because this is a rule that a future price can break silently.
 */

/** Matches per submitted wallet, measured 2026-08-13 on n=600 across 18
 *  collections, 95% CI 20.3-27.1%. Used only to convert a pack into a rough
 *  wallet count for display; never used to bill. */
export const MEASURED_MATCH_RATE = 0.237;

export type PackId = 'starter' | 'trial' | 'campaign' | 'scale' | 'index';

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
  /**
   * The first rung, and the one the ladder was missing.
   *
   * Free ends at 100 matches and the next thing to buy cost $29. Across the
   * product's whole history nobody crossed that step: paid credit lots, all
   * time, zero. The gap is not that $29 is expensive. It is that $29 was sized
   * for a month of work, and it was being offered to someone who had not yet
   * finished their first list.
   *
   * **75 matches is the modal single job.** The median real list is 300
   * wallets, which is 71 matches at MEASURED_MATCH_RATE, so this covers one
   * whole list rather than part of one. That is the same derivation Trial uses
   * one rung up, where the anchor is the modal person-month instead.
   *
   * **$10 is set by the ladder, not by the appetite.** 75 matches at Trial's
   * per-match price is $8.70, so a $9 pack would sit within a cent of Trial and
   * teach a buyer nothing about stepping up. $10 prices the smaller commitment
   * at a 15% premium per match and keeps the arbitrage shut: 250 matches bought
   * in these rungs is $33.33 against Trial's $29.
   *
   * **What it unlocks matters more than what it holds.** `hasPaidAccess` is
   * binary: the reverse-lookup addresses, the priority column, follower counts,
   * contract import and the exports all turn on holding any live lot, never on
   * its size. So this is the price of the key, and the matches are what the key
   * opens. That is why it exists at a price somebody decides on rather than
   * budgets for.
   *
   * **The name was a tier here once.** A `starter` tier was retired on
   * 2026-08-12, never purchased, and `normalizeTier` recognises only `pro` and
   * `unlimited`, so the old string reads as `free`. The two cannot be confused:
   * the checkout resolves a price through `isPackId`, and the webhook reads
   * `metadata.pack` for new payments and `metadata.tier` only off historical
   * ones. `scripts/check-invariants.ts` asserts both directions, because this
   * paragraph is exactly the kind of confident claim that file exists for.
   */
  starter: {
    id: 'starter',
    name: 'Starter',
    priceCents: 1000,
    matches: 75,
    fits: 'One list, once',
    priceEnvVar: 'STRIPE_PRICE_PACK_STARTER',
  },
  trial: {
    id: 'trial',
    name: 'Trial',
    priceCents: 2900,
    matches: 250,
    // ~1,055 wallets at the measured rate. The modal person-month consumed
    // under 1,000 wallets, so this is the exact-fit first month. It was
    // described as "one list, once" while it was the cheapest rung; that
    // sentence belongs to Starter, which is the size of one list.
    fits: 'A month of lists',
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

/**
 * What the onchain rail sells, kept out of `PACKS` on purpose.
 *
 * `PACKS` is not just a price list. `PACK_IDS` drives the pricing grid, the
 * upgrade modal, the schema.org offers in `app/layout.tsx`, `llms.txt`, the
 * public price endpoint and six comparison-page renders, and another key
 * would appear in all of them without anybody choosing to put it there. The
 * Agent pack is priced for a machine that pays in USDC with no account, and
 * showing it beside Starter on a pricing page is exactly the cannibalisation it
 * has to avoid: it is a tenth the price of the cheapest card purchase, which
 * was a loose figure against a $29 floor and is now the exact ratio.
 *
 * Separation is the gate. `app/api/checkout/route.ts` resolves a Stripe price
 * from `PACKS[id]`, so an id that is not in `PACKS` cannot be bought with a
 * card, and no filter has to be remembered anywhere. A surface that should
 * advertise this pack imports it explicitly, which is one deliberate line
 * rather than eight places agreeing not to show it.
 *
 * The cannibalisation argument survived the arrival of Starter, and it is worth
 * saying why rather than leaving the old sentence to be read against a new
 * price. What separates the two rails is the account, not the amount: this pack
 * buys no login, no history, no export and no support, and it is settled onchain
 * by something that does not have an email address. A person choosing between
 * $1 and $10 is not choosing between two prices, because only one of them
 * leaves them with somewhere to come back to.
 */
export type X402PackId = 'agent';

export const X402_PACKS: Record<
  X402PackId,
  Omit<Pack, 'id' | 'priceEnvVar'> & { id: X402PackId }
> = {
  agent: {
    id: 'agent',
    name: 'Agent',
    /**
     * $1, and the point is the per-address number rather than the headline.
     *
     * 12 matches is about 50 resolvable addresses at the measured 23.7%
     * rate, which is one full `/v1/batch` call: the smallest purchase that
     * still lets a machine do a whole unit of work. At $0.0197 an address it
     * undercuts the nearest comparable per-request wallet-profile service by
     * roughly 2.5x, which is the entire reason this rail exists.
     *
     * It prices above Campaign per match, correctly, because it is
     * zero-commitment, and below Starter per match, correctly, because it is
     * far smaller. Starter is the comparison to hold it against now: it is the
     * cheapest thing a person can buy, and this is the cheapest thing a machine
     * can buy.
     */
    priceCents: 100,
    matches: 12,
    fits: 'One batch call, no account',
  },
};

/** Whether an id names something the onchain rail sells. */
export function isX402PackId(value: string): value is X402PackId {
  return Object.prototype.hasOwnProperty.call(X402_PACKS, value);
}
