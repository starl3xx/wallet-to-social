/**
 * Whether a stored X handle still reaches anyone.
 *
 * ## This is a feature, not an apology
 *
 * Farcaster records a verified X account as a **string**, captured once, with no
 * account id and no recheck. That is the source of 1,062,068 of our handles
 * (measured 2026-09-01), and nothing in the protocol notices when somebody
 * renames or gets suspended.
 *
 * A daily cron resolves these: `/api/cron/x-reachability`, scheduled on
 * 2026-08-18. It has checked 460,889 distinct handles, which is every handle in
 * `x_accounts`.
 *
 * That is slightly MORE than the 460,798 distinct handles the index holds, and
 * it is not an error: the table keeps every handle it has ever seen a state
 * for, including ones the conflict resolver has since replaced, so it is a
 * superset rather than a subset. Treating one as the other's denominator gives
 * coverage above 100%, which is what the first version of this paragraph did.
 *
 * Coverage of the index reached **100.0%** on 2026-09-01: 460,645 of the held
 * handles have a status, and 165 await a retry after a transport failure.
 *
 * Two counts sit here and only one of them is the published claim.
 * `scripts/check-published-figures.ts` finds the resolved-handles figure by
 * looking for a number within 25 characters of "resolved" or "checked", so the
 * `x_accounts` count is written that way above and the held-handle count is
 * deliberately not. Keep it that way when editing this header.
 *
 * An earlier rewrite phrased the held-handle count as carrying a resolved
 * state, and the check quietly began verifying that number instead. The two are
 * 0.05% apart, well inside the 2% stale band, so it passed while the published
 * figure went unchecked in this file (found by Bugbot). The phrasing is not
 * repeated here even as an example, because the matcher reads prose and cannot
 * tell a cautionary quotation from a claim.
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
 * of the 460,889 that returned a state:
 *
 *     live          322,889   70.1%
 *     suspended      92,832   20.1%
 *     unclaimed      45,168    9.8%
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
import { publicSources, MAPPED_SOURCE_IDS } from '@/lib/api-sources';
import type { TwitterAlso } from '@/lib/types';

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
  live: 'The owner attested this account, and the same account still holds the handle.',
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
export const isReachable = (
  r: Reachability | null | undefined
): boolean | null => (r == null ? null : r === 'live');

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
      typeof r.wallet === 'string' &&
      typeof r.handle === 'string' &&
      r.handle.length > 0
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
 * A second live X account per wallet, from the unresolved handle conflicts.
 *
 * ## What a conflict is, and which ones this reads
 *
 * `handle_conflicts` records every wallet where a source attested an X handle
 * that differs from the one the graph holds. They fall into three buckets by
 * what `x_accounts` says about each side. Where ours is dead and theirs is
 * live, the graph is simply wrong and a daily job swaps the handle and marks
 * the conflict resolved. Where one side has never been checked, nothing can be
 * said yet. This function reads the third bucket only: **both live**.
 *
 * ## Why both-live is surfaced and never swapped
 *
 * Two live accounts attested for one wallet is not an error to correct. The
 * owner verified one account on Farcaster and proved another to an identity
 * platform, and both still reach them. Preferring either would be a guess
 * dressed as a fix, so the stored handle stays primary and the other rides
 * alongside it. The list export exists to reach people, and this is a second
 * way of reaching this one.
 *
 * ## What is checked before a row qualifies
 *
 * - The conflict is unresolved and on the twitter platform.
 * - Both handles resolve to `live` in `x_accounts`. An unchecked side is
 *   absent from the join and so drops out, on the same absent-is-not-false
 *   rule every other field here follows.
 * - Where the source supplied the numeric account id, it must equal the id
 *   the handle resolves to now. A mismatch means the name has moved to a
 *   stranger since the attestation, which is precisely the `reassigned` case
 *   above, and a stranger's live account is not a second way to reach the
 *   owner.
 * - The conflict's `ours` must be the handle the caller is about to show.
 *   `ours` is refreshed by every sweep, but the graph can move between
 *   sweeps, and "both reach someone" is a claim about the two handles on the
 *   screen, not about a pair the sweep saw last week.
 * - The source must map to a public evidence class. An unmapped source is
 *   dropped rather than named, which is the allowlist rule from
 *   `lib/api-sources.ts` applied one more time.
 *
 * A wallet can carry one conflict per attesting source. One is returned per
 * wallet: the one with an account id first, because that one passed the
 * stronger test, then the most recently seen.
 *
 * Keyed by lowercased wallet, like `reachabilityForWallets`.
 */
/**
 * The wallets whose SECOND attested X account is this handle.
 *
 * Reverse lookup can then find a wallet by the handle shown *beneath* the
 * primary one. Before this, both reverse routes matched
 * `social_graph.twitter_handle` alone: we held an owner-attested link,
 * displayed it on the row, exported it in the CSV, served it from the public
 * API as `twitter.also`, and then answered "no wallets" when somebody searched
 * for it.
 *
 * ## Why this returns a list instead of a predicate
 *
 * The obvious shape is a correlated `OR EXISTS (...)` bolted onto the route's
 * existing `WHERE`, which reads well and is unusable. Measured on production:
 * the `OR` defeats the index on `social_graph.twitter_handle`, so Postgres
 * sequentially scans all 5,117,875 graph rows and runs the subplan once per
 * row. **19.7 seconds** for a query that returns two wallets.
 *
 * `handle_conflicts` holds 3,680 rows in total, so resolving the wallets first
 * is a scan of a rounding error, and the route then filters `social_graph` by
 * primary key. It is also why the shape is safe as the table grows: the cost is
 * set by the conflict table, not by the graph.
 *
 * Returning `[]` matters as much as returning wallets. Almost every handle has
 * no second-account claim at all, and on that path the caller leaves its
 * predicate exactly as it was, so the overwhelmingly common query is
 * byte-identical to the one that ran before this existed.
 *
 * ## Every condition `alsoOnXForWallets` applies, including the three it
 * applies in JavaScript
 *
 * The two must agree exactly. A wallet returned here whose row does not display
 * this handle is worse than the gap it fixes: the caller is told a wallet
 * belongs to a handle, opens the row, and finds no such handle anywhere on it.
 * So the SQL gate is the same one, and the three filters that used to live only
 * in the loop below are restated here:
 *
 *   - the conflict's `ours` must be the handle the graph currently serves, not
 *     the one the sweep saw last week;
 *   - `theirs` must differ from the primary, since identical modulo case is
 *     not a second account whatever the table says;
 *   - the source must map to a public evidence class, or the row is dropped
 *     rather than named. Filtering on `MAPPED_SOURCE_IDS` rather than on the
 *     rendered class keeps one allowlist.
 *
 * ## And it picks the same winner, not merely a qualifying row
 *
 * `alsoOnXForWallets` keeps **one** conflict per wallet: `DISTINCT ON (wallet)`
 * ordered by the account id first, since that one passed the stronger test,
 * then by the most recently seen. A wallet with two qualifying second accounts
 * therefore displays exactly one of them.
 *
 * So the handle filter is applied **after** that selection, not inside it. The
 * first version filtered first and matched any qualifying row, which returns a
 * wallet for the loser of a tie: searched B, row shows A, and the caller is
 * left holding the exact contradiction this gate exists to prevent (Bugbot,
 * 2026-08-27). No wallet has two today, which is precisely why the ordering had
 * to be copied rather than reasoned about from the current data.
 */
function secondaryHandleFrom(normalized: string) {
  return sql`
    FROM (
      SELECT DISTINCT ON (c.wallet)
             c.wallet, lower(c.theirs) AS theirs
      FROM handle_conflicts c
      JOIN x_accounts o ON o.handle = lower(c.ours)
      JOIN x_accounts t ON t.handle = lower(c.theirs)
      JOIN social_graph g ON g.wallet = c.wallet
      WHERE c.platform = 'twitter'
        AND c.resolved_at IS NULL
        AND o.status = 'live'
        AND t.status = 'live'
        AND (c.their_user_id IS NULL OR c.their_user_id = t.user_id)
        AND lower(c.ours) = lower(g.twitter_handle)
        AND lower(c.theirs) <> lower(g.twitter_handle)
        AND c.their_source = ANY(${sql.param(MAPPED_SOURCE_IDS)}::text[])
      ORDER BY c.wallet, (c.their_user_id IS NOT NULL) DESC, c.last_seen_at DESC
    ) w
    WHERE w.theirs = ${normalized}
  `;
}

function normalizeHandle(handle: string): string {
  return handle.toLowerCase().replace(/^@/, '');
}

export async function walletsBySecondaryHandle(
  handle: string
): Promise<string[]> {
  const db = getDb();
  if (!db) return [];
  const normalized = normalizeHandle(handle);
  if (normalized.length === 0) return [];

  const result = (await db.execute(
    sql`SELECT w.wallet ${secondaryHandleFrom(normalized)}`
  )) as unknown as { rows: Array<{ wallet: string }> };

  return result.rows.map((r) => r.wallet);
}

/**
 * How many wallets the handle would add, without reading a single address.
 *
 * `/api/reverse` publishes the count to callers with no credits and withholds
 * the addresses, and its own header is explicit that the address query "must
 * not run for them at all", because a version that read every wallet and then
 * declined to print them would satisfy the response shape and still have done
 * the work. The first draft of the second-account match broke exactly that: it
 * resolved the wallet list above the entitlement gate so the free count could
 * include them.
 *
 * So the free path counts and the paid path lists, over one `FROM` clause
 * neither of them writes twice.
 *
 * The two sets are disjoint, which is what makes adding the counts sound rather
 * than convenient. A wallet matched here has `twitter_handle = ours` and
 * `ours <> theirs = handle`, so its primary handle is not the handle being
 * searched, so it cannot also be in the primary count.
 */
export async function countBySecondaryHandle(handle: string): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  const normalized = normalizeHandle(handle);
  if (normalized.length === 0) return 0;

  const result = (await db.execute(
    sql`SELECT count(*)::int AS n ${secondaryHandleFrom(normalized)}`
  )) as unknown as { rows: Array<{ n: number }> };

  return result.rows[0]?.n ?? 0;
}

export async function alsoOnXForWallets(
  rows: Array<{ wallet: string; handle?: string | null }>
): Promise<Map<string, TwitterAlso>> {
  const out = new Map<string, TwitterAlso>();
  const db = getDb();
  if (!db) return out;

  const primaryByWallet = new Map<string, string>();
  for (const r of rows) {
    if (
      typeof r.wallet !== 'string' ||
      typeof r.handle !== 'string' ||
      r.handle.length === 0
    )
      continue;
    primaryByWallet.set(
      r.wallet.toLowerCase(),
      r.handle.toLowerCase().replace(/^@/, '')
    );
  }
  const wallets = [...primaryByWallet.keys()];
  if (wallets.length === 0) return out;

  // Chunked like every other wallet-keyed read here. `handle_conflicts.wallet`
  // is written from `social_graph.wallet`, which is stored lowercased, so the
  // equality below can use the primary key directly.
  for (let i = 0; i < wallets.length; i += 2000) {
    const chunk = wallets.slice(i, i + 2000);
    const result = (await db.execute(sql`
      SELECT DISTINCT ON (c.wallet)
             c.wallet, c.ours, c.theirs, c.their_source
      FROM handle_conflicts c
      JOIN x_accounts o ON o.handle = lower(c.ours)
      JOIN x_accounts t ON t.handle = lower(c.theirs)
      WHERE c.wallet = ANY(${sql.param(chunk)}::text[])
        AND c.platform = 'twitter'
        AND c.resolved_at IS NULL
        AND o.status = 'live'
        AND t.status = 'live'
        AND (c.their_user_id IS NULL OR c.their_user_id = t.user_id)
      ORDER BY c.wallet, (c.their_user_id IS NOT NULL) DESC, c.last_seen_at DESC
    `)) as unknown as {
      rows: Array<{
        wallet: string;
        ours: string;
        theirs: string;
        their_source: string;
      }>;
    };

    for (const row of result.rows) {
      const wallet = row.wallet.toLowerCase();
      const primary = primaryByWallet.get(wallet);
      if (!primary || row.ours.toLowerCase() !== primary) continue;
      // Identical modulo case is not a second account, whatever the table says.
      if (row.theirs.toLowerCase() === primary) continue;
      const source = publicSources([row.their_source])?.[0];
      if (!source) continue;
      out.set(wallet, {
        handle: row.theirs,
        url: `https://x.com/${row.theirs}`,
        source,
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
  also?: TwitterAlso | null;
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
  // Omitted for the same reason. Present only where a second attested handle
  // is live alongside this one; see `alsoOnXForWallets` for the test.
  if (input.also) {
    field.also = {
      handle: input.also.handle,
      url: input.also.url,
      source: input.also.source,
    };
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
  results: Array<{
    wallet?: string;
    twitter_handle?: string;
    twitter_reachability?: Reachability;
  }>
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
      const byHandle = await reachabilityFor(
        handleOnly.map((r) => r.twitter_handle)
      );
      for (const r of handleOnly) {
        const hit = byHandle.get(
          r.twitter_handle!.toLowerCase().replace(/^@/, '')
        );
        if (hit) r.twitter_reachability = hit.status;
      }
    }
  } catch (error) {
    console.error('Reachability stamp failed, continuing without it:', error);
  }
}

/**
 * Stamp `twitter_also` onto a result set in place. Same shape and same
 * failure policy as `stampReachability`, and called from the same place, so
 * a row saved to history carries it and a reopened lookup shows it.
 *
 * One query per batch, not one per row: the helper chunks by wallet. Only rows
 * with a handle are sent, since a conflict is a disagreement about a handle
 * and a row without one has nothing to disagree with.
 */
export async function stampAlsoOnX(
  results: Array<{
    wallet?: string;
    twitter_handle?: string;
    twitter_also?: TwitterAlso;
  }>
): Promise<void> {
  try {
    const withHandle = results.filter(
      (r): r is typeof r & { wallet: string; twitter_handle: string } =>
        Boolean(r.wallet) && Boolean(r.twitter_handle)
    );
    if (withHandle.length === 0) return;

    const byWallet = await alsoOnXForWallets(
      withHandle.map((r) => ({ wallet: r.wallet, handle: r.twitter_handle }))
    );
    for (const r of withHandle) {
      const hit = byWallet.get(r.wallet.toLowerCase());
      if (hit) r.twitter_also = hit;
    }
  } catch (error) {
    console.error('Also-on-X stamp failed, continuing without it:', error);
  }
}
