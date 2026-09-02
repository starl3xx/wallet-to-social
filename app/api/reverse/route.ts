import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { eq, inArray, or, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { socialGraph } from '@/db/schema';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth';
import { getUserAccess } from '@/lib/access';
import { hasPaidAccess } from '@/lib/credits';
import { publicSources } from '@/lib/api-sources';
import { saveLookup } from '@/lib/history';
import { lockedReverseBody } from '@/lib/reverse-access';
import {
  walletsBySecondaryHandle,
  countBySecondaryHandle,
  stampAlsoOnX,
} from '@/lib/handle-reachability';
import {
  checkIpRateLimit,
  formatRateLimitHeaders,
  getClientIp,
} from '@/lib/ip-rate-limiter';
import { isSuppressed } from '@/lib/suppression';
import type { WalletSocialResult } from '@/lib/types';

export const runtime = 'nodejs';

/**
 * Reverse lookup for the web app.
 *
 * The public API already exposes this at /v1/reverse/*, but that authenticates
 * with an API key. The app authenticates with a session cookie, so this is a
 * separate door onto the same query rather than a second implementation of the
 * feature.
 *
 * Same 100-row cap as the public endpoint, deliberately. If the two disagreed,
 * a customer comparing the UI against their own integration would find
 * different answers to the same question.
 *
 * ## What a caller without credits gets
 *
 * The count, and not the addresses. This used to answer them with 401 or 403
 * and nothing else, so the first thing a stranger did on the busiest page on
 * the site was type a handle and receive a price. In the two days after the QR
 * auction sent traffic here, 57 sessions hit that gate having been shown
 * nothing at all, and 37 of them created an account trying to get past it. An
 * account does not get past it: the gate is `hasPaidAccess`.
 *
 * The rule itself is not new. `/api/reachability` has always published the
 * count for free, keyless, to anyone, and withheld the addresses; `/check`
 * explains that split to the reader in those words. This endpoint was the one
 * surface that never applied it. See `lib/reverse-access.ts`.
 *
 * The locked branch must return before the row query runs. Returning a body
 * with no addresses in it is not enough on its own: a version that read every
 * wallet and then declined to print them would satisfy the response shape and
 * still have done the work, one `console.log` away from disclosure.
 */
const MAX_RESULTS = 100;

type Platform = 'twitter' | 'farcaster';

// Same shapes the public API validates against, so a handle accepted here is
// accepted there.
const VALID_TWITTER = /^@?[a-zA-Z0-9_]{1,15}$/;
// Case-insensitive: Farcaster usernames are case-insensitive, and the input is
// lowercased before querying anyway. Testing the raw value against a
// lowercase-only pattern rejected "Dwr" as malformed, which is a format error
// for something that is not a format problem.
const VALID_FARCASTER = /^[a-zA-Z0-9_.-]{1,32}$/;

export async function POST(request: NextRequest) {
  /**
   * A missing or expired cookie is an anonymous caller, not an error.
   *
   * This returned 401 for both, which put a sign-in wall in front of a count
   * that `/api/reachability` hands to strangers with no cookie at all. The two
   * doors disagreeing about the same disclosure is the bug, not the absence of
   * a session.
   */
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await validateSession(token) : { user: null };
  const user = session.user ?? null;

  // Reverse lookup is included in every pack. A pack buyer keeps tier 'free',
  // so this cannot be a tier check: see hasPaidAccess.
  const entitled = user
    ? await hasPaidAccess(user.id, (await getUserAccess(user.email)).tier)
    : false;

  let body: { platform?: string; handle?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const platform = body.platform as Platform;
  if (platform !== 'twitter' && platform !== 'farcaster') {
    return NextResponse.json(
      { error: 'platform must be twitter or farcaster' },
      { status: 400 }
    );
  }

  const raw = (body.handle ?? '').trim();
  if (!raw) {
    return NextResponse.json(
      { error: 'Enter a handle to look up' },
      { status: 400 }
    );
  }

  const pattern = platform === 'twitter' ? VALID_TWITTER : VALID_FARCASTER;
  if (!pattern.test(raw)) {
    return NextResponse.json(
      {
        error:
          platform === 'twitter'
            ? 'X handles are 1 to 15 letters, numbers or underscores'
            : 'Farcaster usernames are up to 32 letters, numbers, dots, hyphens or underscores',
      },
      { status: 400 }
    );
  }

  const handle = raw.replace(/^@/, '').toLowerCase();

  const db = getDb();
  if (!db) {
    return NextResponse.json(
      { error: 'Service temporarily unavailable' },
      { status: 503 }
    );
  }

  /**
   * The free branch is bounded per address; the paid branch is bounded by the
   * credits it spends.
   *
   * Same limit and same reasoning as `/api/reachability`, because it is the
   * same disclosure at the same cost: one indexed read of a table we already
   * hold. The bound exists to stop the count being used to enumerate the
   * index, not to ration anything scarce.
   */
  if (!entitled) {
    const rate = await checkIpRateLimit(getClientIp(request), '/api/reverse');
    if (!rate.allowed) {
      return NextResponse.json(
        {
          error:
            'That is a lot of handles. Try again within the hour, or use credits.',
          retryAfter: rate.retryAfter,
        },
        { status: 429, headers: formatRateLimitHeaders(rate) }
      );
    }
  }

  /**
   * The suppression check, before even the count is read.
   *
   * The count alone would leak: a nonzero total for a suppressed handle,
   * served free above the paywall, is exactly the existence confirmation
   * the removal exists to end. Same guard as the /v1 reverse routes: a
   * suppressed handle gets the answer an unindexed handle gets (a zero
   * count, or an empty entitled result), after the same rate limit, so the
   * two are indistinguishable from outside. Fail closed on a failed read.
   */
  let handleSuppressed: boolean;
  try {
    handleSuppressed = (await isSuppressed(platform, [handle])).size > 0;
  } catch (error) {
    console.error('Suppression check failed on /api/reverse:', error);
    return NextResponse.json(
      { error: 'Service temporarily unavailable' },
      { status: 503 }
    );
  }
  if (handleSuppressed) {
    if (!entitled) {
      return NextResponse.json(lockedReverseBody(platform, handle, 0));
    }
    return NextResponse.json({
      results: [],
      lookup_id: null,
      meta: {
        platform,
        handle,
        total_count: 0,
        returned_count: 0,
        truncated: false,
      },
    });
  }

  /**
   * The count first, and by counting rather than by listing.
   *
   * On X the handle can be a row's primary or its second attested account, and
   * an unentitled caller is told the total for both. `countBySecondaryHandle`
   * is used rather than the wallet list precisely because this runs above the
   * gate: see the header above, and the function's own note. Farcaster has no
   * second-account concept, so it stays a plain equality.
   *
   * The two sets are disjoint (a secondary match has a different primary
   * handle), so the totals add without double-counting.
   */
  const primaryColumn =
    platform === 'twitter' ? socialGraph.twitterHandle : socialGraph.farcaster;

  const [countRow] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(socialGraph)
    .where(eq(primaryColumn, handle));
  const secondaryCount =
    platform === 'twitter' ? await countBySecondaryHandle(handle) : 0;
  const totalCount = (countRow?.count ?? 0) + secondaryCount;

  /**
   * Everything a caller without credits gets, and the last statement they
   * reach. The row query below reads wallet addresses; it must not run for
   * them at all.
   *
   * 200 rather than 403. This is a complete, useful answer to the question
   * they asked, and the client needs to render it rather than treat it as a
   * failure. `upgradeRequired` is still set so the existing paywall branch
   * keeps working.
   */
  if (!entitled) {
    return NextResponse.json(lockedReverseBody(platform, handle, totalCount));
  }

  /**
   * Below the gate, deliberately. This is the first statement that reads a
   * wallet address, and it is the first statement an unentitled caller never
   * reaches.
   */
  const secondary =
    platform === 'twitter' ? await walletsBySecondaryHandle(handle) : [];
  const matchesHandle =
    secondary.length > 0
      ? or(eq(primaryColumn, handle), inArray(socialGraph.wallet, secondary))
      : eq(primaryColumn, handle);

  const rows = await db
    .select({
      wallet: socialGraph.wallet,
      ensName: socialGraph.ensName,
      twitterHandle: socialGraph.twitterHandle,
      twitterUrl: socialGraph.twitterUrl,
      farcaster: socialGraph.farcaster,
      farcasterUrl: socialGraph.farcasterUrl,
      fcFollowers: socialGraph.fcFollowers,
      fcFid: socialGraph.fcFid,
      lens: socialGraph.lens,
      github: socialGraph.github,
      sources: socialGraph.sources,
      twitterVerified: socialGraph.twitterVerified,
      farcasterVerified: socialGraph.farcasterVerified,
      isAgent: socialGraph.isAgent,
      agentName: socialGraph.agentName,
      agentFramework: socialGraph.agentFramework,
      agentType: socialGraph.agentType,
      agentTokenSymbol: socialGraph.agentTokenSymbol,
      agentVerified: socialGraph.agentVerified,
    })
    .from(socialGraph)
    // Highest reach first. Without an order the 100-row cap would return an
    // arbitrary slice, which matters most on exactly the handles that exceed it.
    //
    // NULLS LAST is required, not decorative: Postgres sorts NULLs first under
    // DESC, so plain desc() would fill the cap with wallets that have no
    // Farcaster reach at all and push the high-follower ones out. That inverts
    // the ordering precisely on the handles big enough to truncate, and it is
    // worst on X lookups, where many linked wallets have no Farcaster data.
    .orderBy(sql`${socialGraph.fcFollowers} DESC NULLS LAST`)
    .where(matchesHandle)
    .limit(MAX_RESULTS);

  const results: WalletSocialResult[] = rows.map((r) => ({
    wallet: r.wallet,
    ens_name: r.ensName ?? undefined,
    twitter_handle: r.twitterHandle ?? undefined,
    twitter_url: r.twitterUrl ?? undefined,
    farcaster: r.farcaster ?? undefined,
    farcaster_url: r.farcasterUrl ?? undefined,
    fc_followers: r.fcFollowers ?? undefined,
    fc_fid: r.fcFid ?? undefined,
    lens: r.lens ?? undefined,
    github: r.github ?? undefined,
    twitter_verified: r.twitterVerified ?? undefined,
    farcaster_verified: r.farcasterVerified ?? undefined,
    // Evidence classes, never the internal pipeline identifiers. This reaches
    // the browser and the CSV export, so it is the same disclosure surface the
    // public API has.
    source: publicSources(r.sources) ?? [],
    is_agent: r.isAgent ?? undefined,
    agent_name: r.agentName ?? undefined,
    agent_framework: r.agentFramework ?? undefined,
    agent_type: r.agentType ?? undefined,
    agent_token_symbol: r.agentTokenSymbol ?? undefined,
    agent_verified: r.agentVerified ?? undefined,
  }));

  /**
   * Stamp the second attested account, before anything reads these rows.
   *
   * A wallet matched on its second handle answers with a *different* name in
   * `twitter_handle`, so without this the results table shows a row that looks
   * unrelated to what was typed, and the saved lookup below persists it that
   * way (Bugbot, 2026-08-27). `stampAlsoOnX` mutates in place and keys on each
   * row's own handle, which is what `alsoOnXForWallets` requires.
   *
   * Above `saveLookup` for the same reason `stampReachability` is in
   * `job-processor`: saving first would persist rows without the mark, so
   * reopening a saved lookup would drop it.
   */
  await stampAlsoOnX(results);

  /**
   * The stamp reads LIVE handle_conflicts, so mid-erasure (or after a
   * backup restore) it can attach a suppressed second handle to these
   * rows. Filtered here the same way the serve-time scrub strips
   * `twitter_also` from saved payloads, and fail closed by the same rule
   * as the check above: a throw refuses the request via the catch in the
   * route handler chain rather than serving unchecked.
   */
  const alsoHandles = results.flatMap((r) =>
    r.twitter_also ? [r.twitter_also.handle] : []
  );
  if (alsoHandles.length > 0) {
    let suppressedAlso: Set<string>;
    try {
      suppressedAlso = await isSuppressed('twitter', alsoHandles);
    } catch (error) {
      console.error('Suppression check failed on /api/reverse also:', error);
      return NextResponse.json(
        { error: 'Service temporarily unavailable' },
        { status: 503 }
      );
    }
    if (suppressedAlso.size > 0) {
      for (const r of results) {
        if (
          r.twitter_also &&
          suppressedAlso.has(r.twitter_also.handle.toLowerCase())
        ) {
          delete r.twitter_also;
        }
      }
    }
  }

  // Save to My lookups, same as a forward lookup. A reverse result is a wallet
  // list like any other: worth reloading, renaming and exporting later, and
  // there is no reason it should be the one kind that vanishes on refresh.
  //
  // Keyed on the user id because that is what /api/history filters by. The
  // localStorage id used elsewhere would save a row the owner could never see.
  //
  // The `user &&` reads as redundant, because `entitled` is false whenever
  // there is no user and this line is past the locked return. It is kept
  // because that reasoning lives in two places at once: the day someone lets
  // an unauthenticated caller be entitled, this writes history rows keyed to
  // nobody rather than throwing.
  let lookupId: string | null = null;
  if (results.length > 0 && user) {
    const label = `Wallets for ${platform === 'twitter' ? '@' : ''}${handle}`;
    try {
      lookupId = await saveLookup(results, label, user.id, 'reverse_lookup');
    } catch (err) {
      // A history write must never cost the caller their results.
      console.error('Failed to save reverse lookup to history:', err);
    }
  }

  return NextResponse.json({
    results,
    lookup_id: lookupId,
    meta: {
      platform,
      handle,
      total_count: totalCount,
      returned_count: results.length,
      truncated: totalCount > MAX_RESULTS,
    },
  });
}
