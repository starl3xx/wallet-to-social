/**
 * Is this cast recent enough to reply to?
 *
 * Split out of `concierge-signals.ts` for one reason: that file calls `main()`
 * at module scope, so importing it to test anything runs the whole job against
 * the live database. `scripts/check-invariants.ts` may use neither a database
 * nor a network, so the predicate has to live somewhere it can be imported for
 * free. Nothing here does any I/O.
 *
 * The claim being made is that a stale cast cannot reach the shortlist. That is
 * a claim, so `check-invariants.ts` tries to push one through.
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
