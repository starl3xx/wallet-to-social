/**
 * What a caller without credits is allowed to learn from a reverse lookup.
 *
 * ## The rule, which is not new
 *
 * `/api/reachability` already publishes it in prose: the **count** of wallets
 * carrying a handle is free and keyless, the addresses are the paid feature.
 * "A free endpoint returning addresses would give away a feature every pack is
 * sold on, for any handle anyone can type." `/check` says the same thing to the
 * reader. That decision is settled; this module applies it to the one surface
 * that never got it.
 *
 * ## Why this exists as a module rather than an early return
 *
 * The route does database work, so `check-invariants.ts` cannot call it: that
 * file may use neither a database nor a network. The claim being made here is
 * "a caller with no credits cannot obtain a wallet address", which is exactly
 * the shape of claim this repository requires to be tested by something trying
 * to break it. Putting the locked body behind a pure function makes it
 * testable for free, and the invariants serialise it and go looking for an
 * address.
 *
 * The route still has to return early; a body that omits addresses is no
 * defence if the query that reads them ran anyway. There is a separate
 * assertion for that, because the two failures are independent.
 */

/** Wallet-shaped strings must never appear in a locked body. */
export const ADDRESS_SHAPE = /0x[a-fA-F0-9]{40}/;

export type ReversePlatform = 'twitter' | 'farcaster';

export interface LockedReverseBody {
  /**
   * Always empty, and always present.
   *
   * Present because the client branches on `results.length` and an absent key
   * would read as a malformed response rather than a locked one. Empty because
   * this is the whole point of the module.
   */
  results: never[];
  /** The caller may see this handle's count but not its wallets. */
  locked: true;
  /** Kept so the existing client branch for the paywall still matches. */
  upgradeRequired: true;
  meta: {
    platform: ReversePlatform;
    handle: string;
    /**
     * How many wallets in the index carry this handle.
     *
     * This is the free half, and it is the half that makes the answer worth
     * anything: "this handle is on 240 wallets" is a real answer, and it is
     * not the product.
     */
    total_count: number;
    returned_count: 0;
    truncated: false;
  };
}

/**
 * The body a caller without credits gets.
 *
 * Note the absence of a `results` argument. An earlier draft took the rows and
 * returned `rows.slice(0, 0)`, which is correct and worthless: it requires the
 * caller to have already run the query that reads the addresses, so the route
 * would hold every wallet in memory and merely decline to print it. The
 * function cannot be handed the thing it exists to withhold.
 */
export function lockedReverseBody(
  platform: ReversePlatform,
  handle: string,
  totalCount: number
): LockedReverseBody {
  return {
    results: [],
    locked: true,
    upgradeRequired: true,
    meta: {
      platform,
      handle,
      // Floors at zero. A negative count would render as "-1 wallets" and the
      // only way to get one is a bug, so it is clamped rather than trusted.
      total_count: Math.max(0, Math.trunc(totalCount) || 0),
      returned_count: 0,
      truncated: false,
    },
  };
}

/**
 * Why a handle came back with nothing, which is a different answer per network.
 *
 * The two are not interchangeable and the product is sold on the distinction.
 * Farcaster coverage is complete, so a miss there is a fact about the account:
 * it genuinely has no addresses attached. X handles are only known when the
 * owner published the link, so a miss there is a fact about our coverage and
 * says nothing about the account.
 *
 * The first version of `lockedReverseMessage` gave both networks the coverage
 * explanation, which told every locked Farcaster caller the opposite of what
 * the empty state a paying caller sees tells them. Conflating the two is the
 * exact failure the empty-state copy in `ReverseLookup.tsx` was written to
 * prevent, and it reached review because the locked path was new copy written
 * beside the old rather than from it.
 */
export const MISS_EXPLANATION: Record<ReversePlatform, string> = {
  farcaster:
    'Farcaster coverage is complete, so this account genuinely has no addresses attached.',
  twitter:
    'X handles are only known when the owner published the link, so this is an absence of evidence rather than evidence of absence.',
};

/**
 * Copy for the locked state, kept beside the rule it describes.
 *
 * Change 03 on the plan was "decide what the free allowance covers and say so".
 * The saying-so belongs next to the deciding, or the two drift and the button
 * promises something the server does not do.
 */
export function lockedReverseMessage(
  totalCount: number,
  platform: ReversePlatform
): string {
  const network = platform === 'twitter' ? 'X' : 'Farcaster';
  if (totalCount === 0) {
    return `No wallet in the index carries this ${network} handle. ${MISS_EXPLANATION[platform]}`;
  }
  const noun = totalCount === 1 ? 'wallet' : 'wallets';
  return `${totalCount.toLocaleString()} ${noun} in the index carry this ${network} handle. Credits show you which ones.`;
}
