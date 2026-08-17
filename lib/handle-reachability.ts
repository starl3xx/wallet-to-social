/**
 * Whether a stored X handle still reaches anyone.
 *
 * ## This is a feature, not an apology
 *
 * Farcaster records a verified X account as a **string**, captured once, with no
 * account id and no recheck. That is the source of 1,039,550 of our handles, and
 * nothing in the protocol notices when somebody renames or gets suspended. We
 * resolved all 440,700 distinct handles we hold on 2026-08-17:
 *
 *     live          290,945   69.6%
 *     suspended      86,537   20.7%
 *     unclaimed      40,390    9.7%
 *
 * **Roughly a third of every attested X handle in the Farcaster protocol reaches
 * nobody.** Anyone reselling Farcaster verifications is shipping that blind,
 * because the protocol gives them no way to know. Checking it does not weaken
 * the attestation, it completes it: "the owner attested this, and it still
 * works" is a stronger claim than either half, and it is one only a source that
 * actually looked can make.
 *
 * ## Three states, kept apart on purpose
 *
 * `suspended` and `unclaimed` are both unreachable today and they mean different
 * things. A suspended account still belongs to the same person and may return. A
 * handle nobody holds has been freed, and somebody else may already have taken
 * it, which means the record can point at a stranger rather than at nobody.
 * Collapsing them would hide the only case where a stale row is actively
 * misleading rather than merely useless.
 *
 * ## Absent is not false
 *
 * `null` means we have not checked this handle, and it renders and serialises
 * differently from "checked, does not reach anyone". The same rule the
 * `twitter_verified` flag already follows, for the same reason: absence of
 * evidence is not evidence of absence.
 */
import { getDb } from '@/db';
import { sql } from 'drizzle-orm';

/** What the public API and the UI speak. */
export type Reachability = 'live' | 'suspended' | 'unclaimed';

export interface HandleReachability {
  status: Reachability;
  checkedAt: string;
}

/**
 * Internal storage uses the resolver's vocabulary; the public one is chosen for
 * a reader who has never seen the resolver.
 *
 * `not_found` becomes `unclaimed` deliberately. "Not found" reads as "we could
 * not find it", which is a statement about us. The truth is a statement about
 * the handle: nobody currently holds it.
 */
const PUBLIC_STATUS: Record<string, Reachability | undefined> = {
  live: 'live',
  unavailable: 'suspended',
  not_found: 'unclaimed',
};

/** Human-readable, for a tooltip or an export column. */
export const REACHABILITY_LABEL: Record<Reachability, string> = {
  live: 'Reachable',
  suspended: 'Account suspended',
  unclaimed: 'Handle no longer in use',
};

/**
 * Longer copy, for anywhere with room to say why it matters.
 *
 * Written to be read by a customer deciding whether to act on a row, so it says
 * what to do rather than what happened internally.
 */
export const REACHABILITY_DETAIL: Record<Reachability, string> = {
  live: 'The owner attested this account, and it still reaches them.',
  suspended:
    'The owner attested this account and X has since suspended it. Messages will not arrive.',
  unclaimed:
    'The owner attested this handle and no account holds it now, usually a rename. Somebody else may have taken the name, so treat it as a lead rather than a contact.',
};

/** True only where we checked and it reaches someone. Null where unchecked. */
export const isReachable = (r: Reachability | null | undefined): boolean | null =>
  r == null ? null : r === 'live';

/**
 * Look up many handles at once.
 *
 * Keyed by lowercased handle, because that is how `x_accounts` stores them and
 * how every writer normalises before saving. A caller holding a handle from
 * anywhere else must lowercase before reading this map.
 */
export async function reachabilityFor(
  handles: Array<string | null | undefined>
): Promise<Map<string, HandleReachability>> {
  const out = new Map<string, HandleReachability>();
  const db = getDb();
  if (!db) return out;

  const wanted = [
    ...new Set(
      handles
        .filter((h): h is string => typeof h === 'string' && h.length > 0)
        .map((h) => h.toLowerCase().replace(/^@/, ''))
    ),
  ];
  if (wanted.length === 0) return out;

  // Chunked so a large lookup does not build one enormous parameter array.
  for (let i = 0; i < wanted.length; i += 2000) {
    const chunk = wanted.slice(i, i + 2000);
    const result = (await db.execute(sql`
      SELECT handle, status, checked_at FROM x_accounts
      WHERE handle = ANY(${sql.param(chunk)}::text[])
    `)) as unknown as {
      rows: Array<{ handle: string; status: string; checked_at: string }>;
    };
    for (const row of result.rows) {
      const status = PUBLIC_STATUS[row.status];
      if (!status) continue; // unknown internal state: report nothing rather than guess
      out.set(row.handle, {
        status,
        checkedAt: new Date(row.checked_at).toISOString(),
      });
    }
  }
  return out;
}

/**
 * The `twitter` object every public route returns.
 *
 * One builder so the four routes cannot drift into describing the same fact
 * three different ways, which is how `sources` came to need an allowlist.
 */
export function publicTwitterField(input: {
  handle: string;
  url?: string | null;
  verified?: boolean | null;
  reachability?: HandleReachability | null;
}): Record<string, unknown> {
  const field: Record<string, unknown> = {
    handle: input.handle,
    url: input.url || `https://x.com/${input.handle}`,
    verified: input.verified ?? false,
  };
  // Omitted entirely when unchecked. A `reachable: null` invites a consumer to
  // read it as false, and this field's whole value is that it never overstates.
  if (input.reachability) {
    field.reachable = input.reachability.status === 'live';
    field.reachability = input.reachability.status;
    field.reachability_checked_at = input.reachability.checkedAt;
  }
  return field;
}

/**
 * Stamp a result set in place.
 *
 * A helper rather than two call sites doing it by hand, because the first
 * version stamped only `/api/lookup` and the product UI submits through
 * `/api/jobs`. The feature was live, correct, and reached no real user: the
 * table saw nothing, the CSV column was always blank, and the handle export
 * filtered nothing. A path that nothing fails without is a path somebody
 * forgets, so there is now one function and both paths call it.
 *
 * Failure is swallowed on purpose. An unstamped result is a result missing one
 * column; a thrown error is a failed lookup, and this is not worth turning one
 * into the other.
 */
export async function stampReachability(
  results: Array<{ twitter_handle?: string; twitter_reachability?: Reachability }>
): Promise<void> {
  try {
    const map = await reachabilityFor(results.map((r) => r.twitter_handle));
    if (map.size === 0) return;
    for (const r of results) {
      if (!r.twitter_handle) continue;
      const hit = map.get(r.twitter_handle.toLowerCase().replace(/^@/, ''));
      if (hit) r.twitter_reachability = hit.status;
    }
  } catch (error) {
    console.error('Reachability stamp failed, continuing without it:', error);
  }
}
