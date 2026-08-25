/**
 * What may not reach the shortlist.
 *
 * Split out of `concierge-signals.ts` for one reason: that file calls `main()`
 * at module scope, so importing it to test anything runs the whole job against
 * the live database. `scripts/check-invariants.ts` may use neither a database
 * nor a network, so the predicate has to live somewhere it can be imported for
 * free. Nothing here does any I/O.
 *
 * Two claims live here, and both are claims rather than facts until something
 * tries to break them: a stale cast cannot reach the shortlist, and a prospect
 * already written up in an earlier brief cannot reach it twice.
 */

/** Tolerated clock skew on a timestamp that claims to be in the future. */
export const FUTURE_SKEW_MS = 60 * 60 * 1000;

/**
 * The cast's time if it is fresh, or null if it is not.
 *
 * Returns the parsed `Date` rather than a boolean so the caller does not parse
 * the same value twice and risk the two parses disagreeing.
 *
 * Rejects, in order:
 *
 * - anything that is not a finite number of milliseconds. `timestamp` comes
 *   from an undocumented endpoint, and treating an absent or renamed field as
 *   fresh is exactly how casts from 2024 would return the day it changes.
 * - anything older than the window.
 * - anything claiming to be from the future by more than the skew allowance. A
 *   bogus far-future timestamp is not merely wrong, it sorts to the top of a
 *   recency ranking and stays there.
 */
export function freshCastTime(
  raw: unknown,
  now: Date,
  maxAgeDays: number
): Date | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  const age = now.getTime() - raw;
  if (age > maxAgeDays * 24 * 60 * 60 * 1000) return null;
  if (age < -FUTURE_SKEW_MS) return null;
  return new Date(raw);
}

/**
 * How a prospect is named in the exclusion list.
 *
 * A contract address and an X or Farcaster handle arrive from different lanes
 * in different cases: the index lane lowercases addresses, the X lane preserves
 * whatever casing the author chose for their own handle, and a person editing
 * the list by hand will type neither consistently. Comparing raw strings makes
 * the exclusion silently miss, which is the worst outcome available here, since
 * the failure looks exactly like a prospect that was never excluded.
 *
 * The leading `@` goes too, so `@Warplets` and `warplets` are one prospect.
 */
export function prospectKey(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const key = raw.trim().toLowerCase().replace(/^@+/, '');
  return key.length > 0 ? key : null;
}

/** Parse a `--exclude=a,b,c` value into keys. Empty entries are dropped. */
export function parseExclusions(raw: string): Set<string> {
  const out = new Set<string>();
  for (const part of raw.split(',')) {
    const key = prospectKey(part);
    if (key) out.add(key);
  }
  return out;
}

/**
 * True when this prospect has already had its turn.
 *
 * Any one of the three identities is enough. A team arrives as a bare contract
 * from the index lane on Monday and as a handle from the X lane on Tuesday, so
 * a check that required both to match would let the same team through twice,
 * which is the exact repetition the list exists to stop.
 *
 * The display name counts as an identity for one reason: a person editing the
 * list by hand types what they see printed, and what the index lane prints is
 * the collection name. Excluding `Kemonokaki` and getting Kemonokaki anyway is
 * a silent miss, and a silent miss here is indistinguishable from a prospect
 * that was never on the list.
 */
export function isExcluded(
  candidate: {
    address?: string | null;
    handle?: string | null;
    name?: string | null;
  },
  excluded: Set<string>
): boolean {
  if (excluded.size === 0) return false;
  for (const identity of [
    candidate.address,
    candidate.handle,
    candidate.name,
  ]) {
    const key = prospectKey(identity);
    if (key !== null && excluded.has(key)) return true;
  }
  return false;
}
