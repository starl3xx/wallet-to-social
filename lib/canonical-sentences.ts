import { API_PLANS, CREDIT_API_PLAN } from '@/lib/api-plans';

/**
 * The load-bearing sentences of the semantic contract, in one place.
 *
 * ## Why this exists
 *
 * The repo already applies one authority per fact to numbers: prices live in
 * `lib/packs.ts`, published counts in `lib/public-figures.ts`, limits in
 * `lib/api-plans.ts`. The meaning of the facts had no such home. What a match
 * is, what attested means, what an absent field claims and what a
 * reachability state promises were restated by hand in at least seven places
 * (llms.txt, two concept pages, the OpenAPI descriptions, the MCP
 * instructions and tool text, the plugin SKILL.md and its README), and the
 * restatements diverged in load-bearing spots: the MCP instructions
 * enumerated two owner-attested routes while the docs enumerated three, and
 * `attested` was mapped from a flag the docs themselves call too narrow. A
 * sentence restated by hand drifts exactly the way a number does; it just
 * fails without a diff.
 *
 * ## The rule
 *
 * One authority per sentence, same as one authority per figure. A projection
 * that needs a sentence about meaning takes the canonical sentence from here
 * (`app/llms.txt/route.ts` and `app/api/mcp/route.ts` interpolate these
 * constants); a surface that cannot import (MDX, the plugin repo) quotes
 * verbatim and gets checked against these strings, the way
 * `scripts/check-published-figures.ts` refuses figure drift. A surface may
 * add context around a sentence, never a second version of it.
 *
 * ## Changing a sentence
 *
 * Edit here and every importing surface moves at once. Each sentence is a
 * claim about live behavior, so a behavior change lands first and the
 * sentence changes in the same PR, never ahead of it. These strings reach
 * llms.txt, the MCP text and the docs, so house style applies: no em dashes,
 * "onchain" one word, and never a provider name.
 */

/**
 * What a match is, and therefore what is billable. The billing unit on every
 * surface: the app, the REST API, the MCP server and the x402 rail all meter
 * this and nothing else.
 */
export const MATCH_SENTENCE =
  'A match is a wallet resolved to an X handle or a Farcaster account. Wallets that resolve to nothing, and wallets carrying only an ENS name, a Lens profile or a GitHub account, are never billed.';

/**
 * What attested means, with all four owner-published routes. This enumeration
 * previously existed in two-route and three-route versions; the four names
 * track the attested evidence classes in `lib/api-sources.ts`
 * (`ATTESTED_SOURCES`), which is where the machine-readable half lives.
 */
export const ATTESTED_SENTENCE =
  'An identity is attested when the wallet owner published the link themselves: a Farcaster verification, an onchain ENS record, an attested-social sign-in, or a manually verified record. Anything else is correlated, and labelled so.';

/**
 * Absent is not false. Any new field follows it: omit what was not measured,
 * never emit a false the data cannot stand behind.
 */
export const ABSENT_SENTENCE =
  'A field that is absent was not measured. Absent is not false: a missing reachability means the handle was not checked, never that nobody is behind it.';

/**
 * The four reachability states, and the caveat that keeps attested and
 * reachable apart. The state names match `x_accounts` as the API publishes
 * them.
 */
export const REACHABILITY_SENTENCE =
  'A checked X handle carries one of four states: live, suspended, unclaimed, or reassigned. A handle can be attested by its owner and suspended today, so a handle is not a promise that anyone is behind it.';

/**
 * Current truth, not aspiration: the balance gate in `lib/api-auth.ts` runs
 * before a call's cost is known, so even the zero-cost endpoints refuse an
 * empty account. When the free endpoints stop refusing at zero (tier B of
 * docs/AGENT-SYSTEM.md), the behavior changes first and this sentence changes
 * with it, in the same PR.
 */
export const ZERO_BALANCE_SENTENCE =
  'A key whose balance is zero receives NO_CREDITS even on the free endpoints; that answer is itself the signal to top up.';

/**
 * The batch pacing rule, stated where an agent decides. Both numbers are the
 * credit plan's, interpolated so the sentence cannot drift from what the
 * limiter enforces: `/v1/batch` weighs one request-unit per address against
 * the per-minute window (`checkRateLimit` is called with `wallets.length`).
 */
export const PACING_SENTENCE = `A batch call spends one request-unit per address of the ${API_PLANS[CREDIT_API_PLAN].requestsPerMinute}-per-minute window, so a full ${API_PLANS[CREDIT_API_PLAN].maxBatchSize}-address call is nearly a whole minute: pace multi-batch runs a minute apart and read the reset time from the quota.`;
