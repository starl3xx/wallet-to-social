/**
 * Keyset cursor for the /v1 reverse lookups.
 *
 * Encodes the sort position (fc_followers DESC NULLS LAST, wallet ASC) as
 * base64url JSON. The wallet is the tiebreak because it is the only unique,
 * immutable key on social_graph. fc_followers is mutable, so a cursor is a
 * position, not a snapshot: a row whose follower count moves between pages
 * can appear twice or be skipped, which pagination over a live index
 * accepts. The cursor is opaque to callers; the docs say to pass it back
 * unmodified.
 */

export interface ReverseCursor {
  /** fc_followers at the cursor row; null once the page is in the NULLS LAST bucket */
  f: number | null;
  /** wallet at the cursor row, lowercase 0x address */
  w: string;
}

export function encodeReverseCursor(cursor: ReverseCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

/**
 * Strict decode: anything that is not exactly a cursor this code produced
 * returns null, and the route answers 400 INVALID_CURSOR. Silently accepting
 * a malformed cursor would serve page one again, which double-bills the
 * caller for rows they already have.
 */
export function decodeReverseCursor(raw: string): ReverseCursor | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { f, w } = parsed as { f?: unknown; w?: unknown };
  if (f !== null && (typeof f !== 'number' || !Number.isInteger(f) || f < 0)) {
    return null;
  }
  if (typeof w !== 'string' || !/^0x[0-9a-f]{40}$/.test(w)) return null;
  return { f: f as number | null, w };
}
