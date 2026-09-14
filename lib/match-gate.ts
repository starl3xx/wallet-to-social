import type { WalletSocialResult } from '@/lib/types';

/**
 * The match gate, applied on the way out.
 *
 * A job on the free allowance can find more matches than the window has left,
 * because submission is bounded in wallets (ten times the remaining balance)
 * and a match rate is unknowable in advance. `chargeForJob` bills only what
 * the allowance covered and the worker records that number on
 * `lookup_jobs.matches_delivered`; this transform makes the payload agree
 * with the bill: the first `delivered` matched rows pass in full, and every
 * matched row after them keeps its wallet but loses the billable identities.
 *
 * A match here is exactly what billing counts: a row carrying an X handle or
 * a Farcaster account. ENS, Lens and GitHub are never billed, so they stay
 * visible on locked rows — same line the pricing page draws. `source` stays
 * too: which index found the match is the teaser, the identity is the
 * product.
 *
 * Order is the stored order, so the same rows are open on every read. The
 * gate runs after the suppression scrub, which can only remove identities,
 * never add them — so a suppressed row simply stops counting as a match and
 * a later row unlocks in its place. Fewer visible matches than billed is the
 * existing suppression trade-off, not a new one.
 */

const LOCKED_FIELDS = [
  'twitter_handle',
  'twitter_url',
  'twitter_verified',
  'twitter_reachability',
  'twitter_also',
  'farcaster',
  'farcaster_url',
  'farcaster_verified',
  'fc_followers',
  'fc_fid',
  'fc_bio',
  'priority_score',
  'is_agent',
  'agent_name',
  'agent_framework',
  'agent_type',
  'agent_token_symbol',
  'agent_verified',
] as const;

export function isBillableMatch(row: WalletSocialResult): boolean {
  return Boolean(row.twitter_handle || row.farcaster);
}

export interface GatedResults {
  results: WalletSocialResult[];
  /** Matched rows served in full. */
  delivered: number;
  /** Matched rows whose identities are locked behind an unlock debit. */
  locked: number;
}

export function gateResults(
  results: WalletSocialResult[],
  delivered: number,
  /**
   * Matched rows that precede this slice, for a paged read: the v1 route
   * serves one page at a time, and whether a page's match is open depends on
   * how many matches came before it in the whole job. Counted from the
   * stored rows (pre-scrub), which can only under-open, never over-open: a
   * suppressed earlier row still holds a slot, so a page can serve slightly
   * fewer open matches than billed, and that is the suppression trade-off
   * the dashboard route already accepts in the other direction.
   */
  alreadySeen = 0
): GatedResults {
  let seen = alreadySeen;
  let locked = 0;

  const gated = results.map((row) => {
    if (!isBillableMatch(row)) return row;
    seen += 1;
    if (seen <= delivered) return row;

    locked += 1;
    const stripped: WalletSocialResult = { ...row, locked: true };
    for (const field of LOCKED_FIELDS) {
      delete stripped[field];
    }
    return stripped;
  });

  return {
    results: gated,
    delivered: Math.max(0, Math.min(seen, delivered) - alreadySeen),
    locked,
  };
}
