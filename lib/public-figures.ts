/**
 * The figures we publish, in one place.
 *
 * ## Why this exists
 *
 * On 2026-08-17 the homepage header said "4.8M wallets indexed", the docs said
 * "4.9 million", and a well-meaning correction earlier the same day pushed 20
 * files to "5M". Three numbers for one fact, and all three were defensible
 * readings of a different query.
 *
 * The homepage was right. It reads `/api/public-stats`, which counts wallets
 * with **at least one linked identity**. The other two counted every row in
 * `social_graph`, which includes 235,858 persisted negatives: wallets we checked
 * and found nothing for. A negative is a real, useful record and it is not a
 * wallet we resolved to anybody, so it does not belong in a number a customer
 * reads as coverage.
 *
 * ## What is the source of truth
 *
 * `/api/public-stats` is, at runtime. Anything that can fetch should.
 *
 * Static copy cannot: docs are MDX, and page metadata is built before a request
 * exists. So static copy imports the constants below, one edit updates every
 * surface at once, and `scripts/check-published-figures.ts` verifies them
 * against the same predicate the endpoint uses. Three numbers cannot drift apart
 * again, because there is only one.
 *
 * ## Changing a figure
 *
 * Edit here, then run `npx tsx --env-file=.env.local scripts/check-published-figures.ts`.
 * The guard fails if a constant no longer matches the database, and the weekly
 * workflow fails when the world has moved past the copy.
 */

/**
 * Wallets with at least one linked identity, rounded for display.
 *
 * MUST match `/api/public-stats` `total_wallets`, which is the same predicate:
 * a twitter handle, farcaster name, ENS name, lens handle or github. Never
 * `count(*)` on the table.
 */
export const INDEXED_WALLETS = '4.8M';

/** The same figure written out, for prose that cannot use an abbreviation. */
export const INDEXED_WALLETS_LONG = '4.8 million';

/**
 * Wallets carrying an X handle, rounded.
 *
 * Counts handles we hold, not handles that still work. Roughly a third of them
 * no longer reach anybody, which is reported per record rather than folded into
 * this number: see `lib/handle-reachability.ts`.
 */
export const WALLETS_WITH_X = '1.15 million';

/** Supported EVM chains. Derived from `SUPPORTED_CHAINS`, not counted by hand. */
export const CHAIN_COUNT_WORD = 'seven';
