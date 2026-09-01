import { SUPPORTED_CHAINS } from '@/lib/chains';

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
export const WALLETS_WITH_X = '1.17 million';

/**
 * Wallets carrying a Farcaster identity.
 *
 * One digit from `INDEXED_WALLETS` and a different fact. 4.7M is the Farcaster
 * half; 4.8M is every wallet with any identity at all. Both are true, and on
 * 2026-08-20 only one of them was declared here, which is the arrangement that
 * produced "4.8M or 4.9M or 5M" the first time. Two numbers this close either
 * both live in one place or they eventually become one wrong number.
 */
export const FARCASTER_WALLETS = '4.7 million';

/**
 * Distinct X handles resolved against X itself, written out to the digit.
 *
 * This lived as a literal in five published surfaces plus two module headers,
 * and by 2026-08-20 it was three different numbers: 417,872 in the docs, the
 * README, the reachability panel and the AI prompt; 422,990 in
 * `lib/handle-reachability.ts`; and 437,823 in the database. Every one of them
 * passed the figures check, because the claim is a ceiling and understating is
 * safe. Safe is not the same as true, so the check now also fails when a
 * ceiling claim falls too far behind, and the literal lives here.
 */
export const X_HANDLES_RESOLVED = '460,889';

/**
 * Distinct X handles the index holds. The denominator for the figure above.
 *
 * Also previously duplicated and also already divergent: 446,070 in one module
 * header, 446,043 in the docs, 446,329 in the database.
 */
export const X_HANDLES_HELD = '460,810';

/**
 * The reachability split: what happened to the X handles we resolved.
 *
 * ## Why these are here and not in the copy
 *
 * The counts above were centralised on 2026-08-20 after one figure became
 * three different numbers across five surfaces. The percentages beside them
 * were left as literals, and by 2026-09-01 the same shape had grown back: the
 * three shares were hand-typed in `lib/x-accounts.ts`, `lib/handle-reachability.ts`,
 * `lib/welcome-sequence.ts`, `app/llms.txt/route.ts`, `components/ReachabilityClaim.tsx`,
 * the README, two docs-site pages and two published posts. Every sweep moves
 * all three, so every sweep needed eleven hand edits that had to agree.
 *
 * `scripts/check-published-figures.ts` does verify each of them against
 * `x_accounts` to a 0.05 tolerance, so drift was caught. Caught is not the same
 * as prevented: the guard turns a silent lie into eleven chores, and the chore
 * is what makes people round rather than re-measure.
 *
 * Markdown surfaces still carry literals, because a `.md` cannot import a
 * constant. Those are exactly the ones the guard exists for.
 */
export const X_LIVE_PCT = '70.1';
export const X_SUSPENDED_PCT = '20.1';
export const X_UNCLAIMED_PCT = '9.8';

/**
 * The share that reaches nobody, derived rather than typed.
 *
 * It is suspended plus unclaimed and nothing else, so writing it by hand is
 * writing a number that must agree with two others and has no independent
 * source. `lib/x-accounts.ts` carried 30.3% as its own literal, which is
 * correct today and would survive unchanged the first time either input moved.
 *
 * Rounded to one decimal after adding, not before: 20.6 + 9.7 is
 * 30.299999999999997 in binary floating point, and `String()` of that is not a
 * figure anybody should publish.
 */
export const X_UNREACHABLE_PCT = (
  Math.round((Number(X_SUSPENDED_PCT) + Number(X_UNCLAIMED_PCT)) * 10) / 10
).toFixed(1);

/**
 * Supported EVM chains, genuinely derived. The comment here used to say
 * "derived, not counted by hand" over a hand-typed 'seven', which is how
 * adding a chain would have updated every derived list while this word
 * stayed wrong beside them.
 */
const COUNT_WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
];
export const CHAIN_COUNT_WORD =
  COUNT_WORDS[SUPPORTED_CHAINS.length] ?? String(SUPPORTED_CHAINS.length);

/**
 * Known agent wallets in the detector's list. A floor: the count only grows.
 * Verified against the live known_agents table 2026-08-22 (13,622) and
 * guarded by the figures registry.
 */
export const KNOWN_AGENTS = '13,622';
/** The same fact at display size, for stat tiles. */
export const KNOWN_AGENTS_SHORT = '13K+';
