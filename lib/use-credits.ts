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
 *
 * ## Why the lots and the free window are here
 *
 * `/api/credits` has always returned `lots`, `freeUsedThisWindow`,
 * `freeWindowResetsAt` and `freeAllowance`, and this hook mapped all four away.
 * The header can therefore show one aggregate number and nothing can answer the
 * two questions a buyer actually asks: which pack am I holding, and when does it
 * lapse. The admin console renders a customer's lots for staff; the customer had
 * no surface for them anywhere. Keeping the fields costs one round trip that was
 * already being made.
 *
 * They are nullable rather than defaulted, because an unmetered account is sent
 * no numbers at all and a zero there would be a meter it never agreed to.
 */

/** One purchased lot, as `/api/credits` reports it. */
export interface CreditLot {
  remaining: number;
  /**
   * Free text, not a `PackId`. `grantCredits` writes `grant` and the x402 rail
   * writes `agent`, neither of which is a key of `PACKS`, so a reader must go
   * through `isPackId` before indexing or it renders `undefined` for a support
   * grant.
   */
  pack: string;
  /** ISO date, or null for a lot that does not lapse. */
  expiresAt: string | null;
}

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
  /**
   * The purchased lots behind `available`, soonest expiry first, which is the
   * order they are spent in. Null while loading, when signed out, and for an
   * unmetered account. Empty means signed in with no live lot, which is a
   * different thing and reads as such.
   */
  lots: CreditLot[] | null;
  /** Matches spent inside the current free window. Null when it does not apply. */
  freeUsedThisWindow: number | null;
  /**
   * When the next free matches return. This is the oldest still-counted debit
   * plus the window, so the allowance dribbles back rather than resetting in
   * one go, and it is null when nothing has been spent. Copy must say when
   * matches return, never that anything resets on a fixed date.
   */
  freeWindowResetsAt: string | null;
  /** The window's size, from the server rather than typed into a page. */
  freeAllowance: number | null;
  /**
   * The read did not land. Separate from `loading` because the two need
   * telling apart: a surface that renders a failed read as settled data shows
   * `available: 0` as though the account were empty, which is a claim about
   * the balance rather than about the request. Anything that would read as a
   * fact about the account belongs behind this.
   */
  failed: boolean;
  loading: boolean;
}

const INITIAL: CreditsView = {
  available: null,
  unmetered: false,
  entitled: false,
  maxWallets: null,
  onFreeAllowance: false,
  lots: null,
  freeUsedThisWindow: null,
  freeWindowResetsAt: null,
  freeAllowance: null,
  failed: false,
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
      // A non-2xx used to fall through to `.json()`, so a 500 that answered
      // with an HTML error page resolved to a parse failure and a 401 to an
      // object with no fields, both of which settled as `available: 0`.
      .then((r) => {
        if (!r.ok) throw new Error(`credits read failed: ${r.status}`);
        return r.json();
      })
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
          // An unmetered account is sent none of these, so it keeps null
          // rather than being handed a zero it never agreed to.
          lots: !d.unmetered && Array.isArray(d.lots) ? d.lots : null,
          freeUsedThisWindow:
            !d.unmetered && typeof d.freeUsedThisWindow === 'number'
              ? d.freeUsedThisWindow
              : null,
          freeWindowResetsAt:
            !d.unmetered && typeof d.freeWindowResetsAt === 'string'
              ? d.freeWindowResetsAt
              : null,
          freeAllowance:
            typeof d.freeAllowance === 'number' ? d.freeAllowance : null,
          failed: false,
          loading: false,
        });
      })
      .catch(() => {
        // `entitled` stays false, which is the safe direction for a gate. What
        // must not happen is a surface reading the zero beside it as a fact,
        // so the failure is reported rather than implied.
        if (!cancelled) setView({ ...INITIAL, failed: true, loading: false });
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
