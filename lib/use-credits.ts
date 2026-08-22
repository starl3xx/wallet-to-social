'use client';

import { useEffect, useState } from 'react';

/**
 * The client's view of what this account may do.
 *
 * ## Why this exists
 *
 * Entitlement used to be readable from `user.tier`, and every gate in the app
 * was written that way: `userTier === 'pro' || userTier === 'unlimited'`. Packs
 * broke that silently. A pack purchase deliberately does not change
 * `users.tier`, because a tier is a permanent entitlement and a pack is a
 * balance, so a customer who paid $899 still had `tier === 'free'` and every
 * one of those gates refused them contract import, reverse lookup, deep ENS,
 * follower counts, priority score, the X list export and an API key.
 *
 * Every one of those is listed under "Every pack includes" in the modal that
 * took their money.
 *
 * ## The two booleans, and why they are not one
 *
 * `entitled` is the feature gate: a live credit lot, or a legacy tier that was
 * sold with those features. It deliberately does NOT include the free
 * allowance, because those features were never part of the free tier and
 * quietly adding them would be a pricing change dressed as a bug fix.
 *
 * `available` is the volume meter, which the free allowance does feed.
 */
export interface CreditsView {
  /** Matches left. Null while loading, and for an unmetered account. */
  available: number | null;
  /** True for a legacy tier or the whitelist, where no meter runs. */
  unmetered: boolean;
  /** Whether paid features are unlocked. See the note above about free. */
  entitled: boolean;
  /**
   * The most wallets one submission may hold right now: remaining matches
   * times SUBMISSION_MULTIPLIER, as `/api/credits` reports it. Null while
   * loading, for an unmetered account (no meter, so no ceiling from it), and
   * when signed out. The page mirrors the server's per-lookup rule from this
   * so a person hears about a too-large file before the upload, not after.
   */
  maxWallets: number | null;
  /**
   * True when the balance being reported is the free window rather than a
   * purchase. The free allowance keeps the demo's per-lookup cap; a pack does
   * not, and the two need telling apart to say which applies.
   */
  onFreeAllowance: boolean;
  loading: boolean;
}

const INITIAL: CreditsView = {
  available: null,
  unmetered: false,
  entitled: false,
  maxWallets: null,
  onFreeAllowance: false,
  loading: true,
};

/**
 * Reads `/api/credits`, which is session-only, so an anonymous visitor gets the
 * signed-out shape and `entitled: false` without a wasted round trip beyond the
 * one call.
 */
export function useCredits(signedIn: boolean): CreditsView {
  const [view, setView] = useState<CreditsView>(INITIAL);

  useEffect(() => {
    // No synchronous setState for the signed-out case: React flags it as a
    // cascading render. The value is derived below instead, which is also
    // truthful: there is nothing to load, so it is not loading.
    if (!signedIn) return;

    let cancelled = false;
    fetch('/api/credits')
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setView({
          available: d.unmetered ? null : (d.available ?? 0),
          unmetered: !!d.unmetered,
          // A live lot, or an unmetered legacy account. `onFreeAllowance` is
          // true when the balance being reported is the free window rather than
          // a purchase, which is exactly the case that must not unlock.
          entitled:
            !!d.unmetered || (!d.onFreeAllowance && (d.available ?? 0) > 0),
          maxWallets:
            !d.unmetered && typeof d.maxWallets === 'number'
              ? d.maxWallets
              : null,
          onFreeAllowance: !d.unmetered && !!d.onFreeAllowance,
          loading: false,
        });
      })
      .catch(() => {
        if (!cancelled) setView({ ...INITIAL, loading: false });
      });

    return () => {
      cancelled = true;
      // Forget this account on the way out. Without this, the next account to
      // sign in on the same tab inherits the previous one's `entitled` and
      // `available` until its own fetch lands, and paid features flicker open
      // or shut for the wrong person. Resetting to INITIAL also restores
      // `loading: true`, so gates that wait for the fetch wait properly.
      setView(INITIAL);
    };
  }, [signedIn]);

  // Signed-out is a derived state, not a stored one. Storing it meant writing
  // it from an effect, which is the cascading render React objects to.
  return signedIn ? view : { ...INITIAL, loading: false };
}
