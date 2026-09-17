import type { WalletSocialResult } from '@/lib/types';

/**
 * What a set of result rows found, counted once, for every surface that says
 * a number about it.
 *
 * ## The defect this exists to end
 *
 * `locked` means "this wallet matched and the free allowance had nothing left
 * to bill it against, so the billable identities were stripped on the way
 * out" (`lib/match-gate.ts`). It means **found and withheld**. Every count in
 * the product read it as **not found**, because every count was a filter on
 * `r.twitter_handle || r.farcaster`, and those fields are exactly what the
 * gate removes.
 *
 * So a gated lookup showed two different answers on one screen. The gate
 * banner, which derives from `locked`, said "This lookup found 220 matches".
 * The figures beneath it, four hundred pixels lower, said 100. Both were
 * rendered from the same array.
 *
 * It was worse than a cosmetic disagreement in three places:
 *
 * - **The share text** used the stripped figure, so somebody who ran a list
 *   and hit the gate posted a match rate lower than the product actually
 *   achieved, to the one surface that brings other people here. The gate was
 *   quietly cutting the product's own social proof.
 * - **The CSV** had no column for it, so a locked row left the building
 *   indistinguishable from a wallet that genuinely has nothing published.
 *   That is not only a lost sale; it is the file telling the customer
 *   something untrue about their own list.
 * - **The hit rate** is the number this product is sold on, and the gate made
 *   it look worse the longer a list was.
 *
 * ## The rule
 *
 * A row that is `locked` counts towards every "found" figure and towards no
 * "you can see this" figure. Anything showing the first number has to be able
 * to show the second beside it, which is why this returns both rather than a
 * single total with a flag.
 *
 * One authority per fact, the same treatment `lib/packs.ts` gives prices and
 * `lib/canonical-sentences.ts` gives meanings. Four surfaces derived these
 * counts by hand from the same array and three of them were wrong in the same
 * way; a fifth would have been written the same way for the same reason.
 */
export interface ResultCounts {
  /** Rows in the set. */
  total: number;
  /** Rows carrying a visible X handle. */
  twitter: number;
  /** Rows carrying a visible Farcaster account. */
  farcaster: number;
  /** Rows flagged as an AI agent. Never gated: agent detection is free. */
  agents: number;
  /**
   * Rows the lookup resolved to an X handle or a Farcaster account, including
   * the ones the gate withheld. The honest answer to "how many did it find".
   */
  matched: number;
  /** Of `matched`, the rows whose identities were withheld. */
  locked: number;
  /**
   * Rows with a published identity you can read right now, including the
   * never-billed ones (ENS, Lens, GitHub). Exactly what the results header
   * has always counted, and deliberately unchanged.
   *
   * "Reachable" is an established word in this product with a precise meaning
   * (see the reachability states, and the note that says to quote
   * `reachableAny` rather than "has a handle"). A locked row is not reachable:
   * the handle is withheld, so nobody can reach anybody with it. Widening this
   * to include locked rows would fix one overclaim by writing another.
   */
  reachable: number;
  /**
   * Every row this lookup found something for: a visible identity, a withheld
   * one, or both. Each row counted once.
   *
   * This is the figure the results header should lead with, and it carries one
   * condition: a surface showing it must name `locked` beside it. A number
   * that counts withheld rows without saying any are withheld is the same
   * dishonesty as the one this file exists to fix, pointing the other way.
   * `scripts/check-invariants.ts` asserts that pairing.
   *
   * **It is not `reachable + locked`, and the first version of this file said
   * it was.** The comment justifying that sum asserted a locked row has no
   * visible identity "by construction", which is false and is contradicted in
   * plain English at the top of `lib/match-gate.ts`: the gate strips the
   * BILLABLE identities, and ENS, Lens and GitHub are never billed, so they
   * stay. A locked row carrying an ENS name is therefore in `reachable` and in
   * `locked` at once, and the sum counted it twice, in the header and in the
   * share text. That is the same overclaim this module was written to remove,
   * reintroduced while removing it, and it got through because the comment
   * stated the premise instead of checking it against the file next door.
   */
  found: number;
  /**
   * `matched` over `total`, as a percentage string with one decimal.
   *
   * Computed from `matched`, not from `reachable`: this is the rate the
   * product publishes and compares itself on, and it must not move because
   * somebody ran out of free allowance halfway down their own list.
   */
  matchRate: string;
}

export function countResults(results: WalletSocialResult[]): ResultCounts {
  let twitter = 0;
  let farcaster = 0;
  let agents = 0;
  let locked = 0;
  let matched = 0;
  let reachable = 0;
  let found = 0;

  for (const r of results) {
    const hasTwitter = Boolean(r.twitter_handle);
    const hasFarcaster = Boolean(r.farcaster);
    if (hasTwitter) twitter++;
    if (hasFarcaster) farcaster++;
    if (r.is_agent) agents++;

    /**
     * `locked` is checked first and on its own, not OR-ed into the visible
     * test. A locked row has had its billable identities stripped, so
     * `hasTwitter` and `hasFarcaster` are both false on it by construction:
     * writing `hasTwitter || hasFarcaster || r.locked` would read as
     * defensive and would in fact be the only branch that ever fires for it.
     */
    if (r.locked) {
      locked++;
      matched++;
    } else if (hasTwitter || hasFarcaster) {
      matched++;
    }

    // Unchanged from what the header has always counted. The never-billed
    // identities belong here and never in `matched`, because they are never
    // billed and so can never be locked.
    const isReachable = Boolean(
      hasTwitter || hasFarcaster || r.lens || r.github
    );
    if (isReachable) reachable++;
    // One predicate over the row, counted once. See `found` above for why this
    // is not `reachable + locked`: the two sets overlap on any locked row that
    // also carries an ENS name, a Lens profile or a GitHub account, and the
    // gate leaves all three in place.
    if (isReachable || r.locked) found++;
  }

  const total = results.length;

  return {
    total,
    twitter,
    farcaster,
    agents,
    matched,
    locked,
    reachable,
    found,
    matchRate: total > 0 ? ((matched / total) * 100).toFixed(1) : '0.0',
  };
}
