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

/**
 * Matches an anonymous job serves open, per job.
 *
 * There is no account to meter across jobs, so per-job is the honest unit.
 * The number must stay below `FREE_MATCHES_PER_WINDOW` (an invariant
 * asserts it), or not signing in becomes the better deal and the account
 * gate upstream of this one selects for anonymity: 3 IP-limited jobs an
 * hour at 500 wallets each was worth up to 1,500 ungated matches, against
 * the 100 per 30 days an account gets.
 */
export const ANON_MATCHES_PER_JOB = 50;

/**
 * The whole anonymous allowance for one IP in a UTC day.
 *
 * ## Why this exists
 *
 * Without it, signing in made the product roughly a thousand times worse.
 * Anonymous callers get 3 jobs an hour (`IP_RATE_LIMITS['/api/jobs']`) and
 * `ANON_MATCHES_PER_JOB` open matches in each, which is 150 matches an hour and
 * about 3,600 a day, for ever, with no cumulative meter anywhere. A signed-in
 * free account gets `FREE_MATCHES_PER_WINDOW`, 100, per 30 days.
 *
 * So the account gate selected for staying anonymous and the free allowance
 * could never become a reason to buy. Measured 2026-09-16: 43 signups in 90
 * days and zero purchases. That is a packaging defect, not a traffic problem,
 * and no amount of traffic fixes it.
 *
 * ## Still generous, deliberately
 *
 * A stranger who drops in a list and sees real matches is the demo the product
 * is sold on, so this is a day's worth of that rather than a token. Note the
 * residual honestly: 50 a day is still more per month than the signed-in free
 * allowance, so this closes the absurdity, not the whole inversion. Lower it
 * here if a first sale still does not come.
 */
export const ANON_MATCHES_PER_DAY = 50;

const LOCKED_FIELDS = [
  'twitter_handle',
  'twitter_url',
  'twitter_verified',
  'twitter_reachability',
  'twitter_also',
  // Beside the handle it counts, for the same reason `fc_followers` is here.
  // A locked row withholds the identity, and a follower count left on it
  // describes the identity precisely enough to be worth withholding too.
  'x_followers',
  'farcaster',
  'farcaster_url',
  'farcaster_verified',
  'fc_followers',
  'fc_fid',
  'fc_bio',
  'priority_score',
  /**
   * The agent fields are NOT here, and their absence is the fix rather than
   * an oversight.
   *
   * `lib/result-counts.ts` says of its agent tally: "Never gated: agent
   * detection is free." That was a claim the code contradicted. All six agent
   * fields were in this list, `gateResults` runs server-side before the rows
   * reach the browser, and `countResults` runs in `StatsCards` afterwards, so
   * on any gated lookup the "AI agents" tile, the "Agents only" filter and the
   * CSV all read a locked agent row as a non-agent and undercounted.
   *
   * Free is also the right answer. What this gate withholds is the identity a
   * customer has not paid for: a handle, an account, the reach attached to
   * them. "This address is an agent" is a fact ABOUT the address rather than
   * an identity belonging to a person, it is what the exclusion use case is
   * sold on, and withholding it makes a paid row and a free row disagree about
   * what the same wallet is.
   */
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
