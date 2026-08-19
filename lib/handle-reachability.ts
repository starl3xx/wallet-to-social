/**
 * Whether a stored X handle still reaches anyone.
 *
 * ## This is a feature, not an apology
 *
 * Farcaster records a verified X account as a **string**, captured once, with no
 * account id and no recheck. That is the source of 1,039,550 of our handles, and
 * nothing in the protocol notices when somebody renames or gets suspended.
 *
 * A daily cron resolves these: `/api/cron/x-reachability`, scheduled on
 * 2026-08-18. It has checked 422,990 distinct handles, with none now left
 * unchecked in the table. Against the 446,070 distinct handles the index holds,
 * that is 94.8% coverage, and **rising**.
 *
 * This paragraph used to end "and falling, because new handles arrive
 * continuously and no scheduled job resolves them", which was true when it was
 * written and stopped being true the next day. The docs had promised customers
 * a daily cycle for months before one existed; the cron closed that gap, and
 * this is the sentence that had to change with it.
 *
 * The first pass, on 2026-08-17, did 417,872 in a single run. Not "all" of
 * them: the sweep leaves transport failures unrecorded so they retry, so its
 * result was never going to equal its target. The percentages below are shares
 * of the 422,990 that returned a state:
 *
 *     live          294,505   69.6%
 *     suspended      87,510   20.7%
 *     unclaimed      40,975    9.7%
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
export type Reachability = 'live' | 'suspended' | 'unclaimed' | 'reassigned';

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
  reassigned: 'Now a different account',
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
  /**
   * The strongest warning of the four, because it is the only one that is
   * confirmed rather than suspected. `unclaimed` says somebody else *may* have
   * taken the name. This says somebody else *has*: the handle resolves to a
   * live account whose id is not the one attested alongside this wallet.
   *
   * It is also the only state where the handle looks perfectly healthy. It
   * reaches a real, active person, and that person is not the wallet owner.
   */
  reassigned:
    'The owner attested this handle, and it now belongs to a different live account. Messages would reach a stranger, not the wallet owner.',
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
 * Reachability keyed by WALLET, including the reassigned override.
 *
 * ## Why this exists alongside `reachabilityFor`
 *
 * `reachabilityFor` answers a question about a handle, and three of the four
 * states are exactly that. `reassigned` is not: it compares the id a source
 * attested **alongside a particular wallet** against the id the handle resolves
 * to now, so the same handle can be reassigned for one wallet and correct for
 * another, if two sources attested different accounts for the same name.
 *
 * The first version of this put that comparison inside `stampReachability`
 * only, which is called by the lookup and jobs paths. Every `/v1` route builds
 * its twitter field from `reachabilityFor` instead, so API consumers kept
 * receiving `reachability: "live"` and `reachable: true` for exactly the rows
 * the change existed to flag, while the docs published in the same change
 * listed `reassigned` as a value of that field. A documented state that one
 * caller can never return is worse than no state.
 *
 * So every caller with a wallet in hand uses this, and `reachabilityFor` is
 * left for the one surface that genuinely has no wallet: the public handle
 * checker at /check.
 */
export async function reachabilityForWallets(
  rows: Array<{ wallet: string; handle?: string | null }>
): Promise<Map<string, HandleReachability>> {
  const out = new Map<string, HandleReachability>();
  const db = getDb();
  if (!db) return out;

  const usable = rows.filter(
    (r): r is { wallet: string; handle: string } =>
      typeof r.wallet === 'string' && typeof r.handle === 'string' && r.handle.length > 0
  );
  if (usable.length === 0) return out;

  const byHandle = await reachabilityFor(usable.map((r) => r.handle));

  for (const r of usable) {
    const hit = byHandle.get(r.handle.toLowerCase().replace(/^@/, ''));
    if (hit) out.set(r.wallet.toLowerCase(), hit);
  }

  // The override. Same comparison as the sweep's rot detector, per wallet.
  const wallets = usable.map((r) => r.wallet.toLowerCase());
  for (let i = 0; i < wallets.length; i += 2000) {
    const chunk = wallets.slice(i, i + 2000);
    const moved = (await db.execute(sql`
      SELECT lower(g.wallet) AS wallet, x.checked_at
      FROM social_graph g
      JOIN x_accounts x ON x.handle = lower(g.twitter_handle)
      WHERE lower(g.wallet) = ANY(${sql.param(chunk)}::text[])
        AND g.twitter_user_id IS NOT NULL
        AND x.user_id IS NOT NULL
        AND g.twitter_user_id <> x.user_id
    `)) as unknown as { rows: Array<{ wallet: string; checked_at: string }> };

    for (const m of moved.rows) {
      out.set(m.wallet, {
        status: 'reassigned',
        checkedAt: new Date(m.checked_at).toISOString(),
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
  results: Array<{ wallet?: string; twitter_handle?: string; twitter_reachability?: Reachability }>
): Promise<void> {
  try {
    /**
     * One read, from the wallet-aware helper, whose result is already complete.
     *
     * The first version called `reachabilityFor` for the base statuses and then
     * `reachabilityForWallets` for the override, and the second call runs the
     * first internally. Every lookup and every job paid for the same
     * `x_accounts` read twice, and the shared helper was reduced to supplying
     * one of the four states it returns.
     */
    const withWallet = results.filter(
      (r): r is typeof r & { wallet: string; twitter_handle: string } =>
        Boolean(r.wallet) && Boolean(r.twitter_handle)
    );

    if (withWallet.length > 0) {
      const byWallet = await reachabilityForWallets(
        withWallet.map((r) => ({ wallet: r.wallet, handle: r.twitter_handle }))
      );
      for (const r of withWallet) {
        const hit = byWallet.get(r.wallet.toLowerCase());
        if (hit) r.twitter_reachability = hit.status;
      }
    }

    /**
     * A row with a handle and no wallet cannot be checked for reassignment,
     * because the attested id hangs off the wallet. It still gets the three
     * handle-level states rather than nothing. No current caller produces such
     * a row, since `WalletSocialResult.wallet` is required, but the parameter
     * type allows it and silently dropping those rows would be the kind of gap
     * that only shows up once somebody adds a caller.
     */
    const handleOnly = results.filter((r) => !r.wallet && r.twitter_handle);
    if (handleOnly.length > 0) {
      const byHandle = await reachabilityFor(handleOnly.map((r) => r.twitter_handle));
      for (const r of handleOnly) {
        const hit = byHandle.get(r.twitter_handle!.toLowerCase().replace(/^@/, ''));
        if (hit) r.twitter_reachability = hit.status;
      }
    }
  } catch (error) {
    console.error('Reachability stamp failed, continuing without it:', error);
  }
}
