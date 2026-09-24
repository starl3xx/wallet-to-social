import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { socialGraph } from '@/db/schema';
import { isValidWalletAddress, normalizeWalletAddress } from '@/lib/api-auth';
import {
  publicSources,
  isSelfDeclared,
  ATTESTED_SOURCES,
} from '@/lib/api-sources';
import {
  reachabilityForWallets,
  publicTwitterField,
} from '@/lib/handle-reachability';
import { loadSuppressionList, isKindSuppressed } from '@/lib/suppression';
import {
  getClientIp,
  checkIpRateLimit,
  formatRateLimitHeaders,
  getAnonMatchBudget,
  consumeAnonMatchBudget,
  FREE_LOOKUP_FLOOR_PER_DAY,
} from '@/lib/ip-rate-limiter';

export const runtime = 'nodejs';

/**
 * One wallet, no key: the endpoint behind /find-twitter-account-from-wallet-address.
 *
 * ## Why a keyless forward read exists at all
 *
 * Every other forward read is metered. This one is not, because the page it
 * serves has to answer before it can earn a link: a tool page that demands a
 * signup to show anything is a landing page, and landing pages do not get
 * linked to. The whole design question is therefore how to show a real answer
 * without handing over the index.
 *
 * ## POST, not GET, and that is not a REST preference
 *
 * A wallet address in a query string lands in access logs, in the `Referer`
 * header of every outbound link on the result view, and in any CDN cache key.
 * The body is none of those places. `/api/reachability` is a GET because its
 * input is a handle somebody already published; an address somebody typed in is
 * not the same thing.
 *
 * ## One address, typed as a string
 *
 * Never an array, never a comma-joined list. An array parameter is how a
 * single-address endpoint becomes a batch endpoint in its second week, and the
 * batch endpoint is the thing that is sold.
 *
 * ## Two meters, and the reason for both
 *
 * The hourly limiter bounds probing, including misses, because a miss still
 * costs a query and still tells a prober the address is absent. The daily match
 * budget is the same one the anonymous job rail spends, so the total anonymous
 * exposure does not double by adding a second door into it.
 *
 * Sharing that bucket has one bad edge: the jobs path reserves its whole gate
 * up front, so a visitor who ran the list demo first would arrive here with
 * nothing left and meet a 429 on a page whose entire job is to answer. Hence
 * `FREE_LOOKUP_FLOOR_PER_DAY`, a small reserve the jobs path cannot drain. The
 * marketing page always answers a few times; it never becomes a free API.
 */

/** Only a billable identity spends budget. ENS or GitHub alone is free. */
function isBillable(twitter: unknown, farcaster: unknown): boolean {
  return Boolean(twitter || farcaster);
}

export async function POST(request: NextRequest) {
  let body: { address?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Send a JSON body with an address.', code: 'INVALID_REQUEST' },
      { status: 400 }
    );
  }

  /**
   * Typed before it is trimmed. `.trim()` on an array throws, so a posted
   * `{"address": ["0x…"]}` was a 500 rather than the 400 the contract promises,
   * and a 500 on malformed input is how a probe learns which inputs are
   * unhandled. Rejecting a non-string here is also what keeps the single
   * address single: an array is the shape this endpoint must never grow into.
   */
  const raw = typeof body.address === 'string' ? body.address.trim() : '';

  // Validated BEFORE any meter is touched: a typo must not cost the visitor a
  // lookup, and a scripted prober must not be able to spend a stranger's
  // allowance by sending rubbish from the same address.
  if (!isValidWalletAddress(raw)) {
    return NextResponse.json(
      {
        error:
          'Invalid wallet address format. Expected 0x followed by 40 hex characters.',
        code: 'INVALID_ADDRESS',
      },
      { status: 400 }
    );
  }
  const address = normalizeWalletAddress(raw);

  const clientIp = getClientIp(request);
  const hourly = await checkIpRateLimit(clientIp, '/api/wallet-socials');
  if (!hourly.allowed) {
    return NextResponse.json(
      {
        error: 'Too many lookups from this network. Try again shortly.',
        code: 'RATE_LIMITED',
      },
      { status: 429, headers: formatRateLimitHeaders(hourly) }
    );
  }

  const budget = await getAnonMatchBudget(clientIp, undefined, {
    floor: FREE_LOOKUP_FLOOR_PER_DAY,
  });
  if (budget.remaining <= 0) {
    return NextResponse.json(
      {
        error: `You have used today’s free lookups. Create a free account to keep going, or come back after ${budget.resetAt
          .toISOString()
          .slice(11, 16)} UTC.`,
        code: 'DAILY_LIMIT',
        resetAt: budget.resetAt.toISOString(),
      },
      { status: 429, headers: formatRateLimitHeaders(hourly) }
    );
  }

  const db = getDb();
  if (!db) {
    return NextResponse.json(
      { error: 'Service temporarily unavailable', code: 'SERVICE_UNAVAILABLE' },
      { status: 503 }
    );
  }

  /**
   * Fail CLOSED on suppression, unlike every other read here.
   *
   * `lib/suppression.ts` throws on a failed read on purpose, and a serve path
   * must turn that into an error rather than a result: answering while the
   * removal list is unreadable is how a removed identity gets served once.
   */
  let suppression;
  try {
    suppression = await loadSuppressionList();
  } catch {
    return NextResponse.json(
      { error: 'Service temporarily unavailable', code: 'SERVICE_UNAVAILABLE' },
      { status: 503 }
    );
  }

  /** A suppressed wallet serves the never-indexed shape, not a refusal. */
  const emptyAnswer = NextResponse.json(
    { data: null, wallet: address, found: false, checked_at: null },
    { headers: formatRateLimitHeaders(hourly) }
  );
  if (isKindSuppressed(suppression, 'wallet', address)) return emptyAnswer;

  const [row] = await db
    .select({
      wallet: socialGraph.wallet,
      ensName: socialGraph.ensName,
      twitterHandle: socialGraph.twitterHandle,
      twitterUrl: socialGraph.twitterUrl,
      twitterVerified: socialGraph.twitterVerified,
      farcaster: socialGraph.farcaster,
      farcasterUrl: socialGraph.farcasterUrl,
      farcasterVerified: socialGraph.farcasterVerified,
      fcFid: socialGraph.fcFid,
      lens: socialGraph.lens,
      github: socialGraph.github,
      sources: socialGraph.sources,
      lastCheckedAt: socialGraph.lastCheckedAt,
    })
    .from(socialGraph)
    .where(eq(socialGraph.wallet, address))
    .limit(1);

  if (!row) return emptyAnswer;

  // A suppressed handle on an unsuppressed wallet is dropped before the
  // presence test, so a row whose only identity was removed serves the
  // checked-and-empty shape, indistinguishable from a persisted negative.
  if (isKindSuppressed(suppression, 'twitter', row.twitterHandle)) {
    row.twitterHandle = null;
    row.twitterUrl = null;
    row.twitterVerified = null;
  }
  if (isKindSuppressed(suppression, 'farcaster', row.farcaster)) {
    row.farcaster = null;
    row.farcasterUrl = null;
    row.farcasterVerified = null;
    row.fcFid = null;
  }
  if (isKindSuppressed(suppression, 'ens', row.ensName)) row.ensName = null;
  if (isKindSuppressed(suppression, 'lens', row.lens)) row.lens = null;
  if (isKindSuppressed(suppression, 'github', row.github)) row.github = null;

  const sources = publicSources(row.sources);
  const attested = Boolean(sources?.some((s) => ATTESTED_SOURCES.has(s)));

  const data: Record<string, unknown> = {
    wallet: row.wallet,
    attested,
  };
  if (row.ensName) data.ens_name = row.ensName;
  if (row.lens) data.lens = row.lens;
  if (row.github) data.github = row.github;
  if (sources) data.sources = sources;

  if (row.twitterHandle) {
    const reach = await reachabilityForWallets([
      { wallet: row.wallet, handle: row.twitterHandle },
    ]);
    data.twitter = publicTwitterField({
      handle: row.twitterHandle,
      url: row.twitterUrl,
      verified: row.twitterVerified,
      selfDeclared: isSelfDeclared(row.sources),
      reachability: reach.get(row.wallet) ?? null,
      // The second-handle disclosure belongs to the paid surface.
      also: null,
    });
  }

  if (row.farcaster) {
    /**
     * No follower count, deliberately. `lib/job-processor.ts` strips
     * `fc_followers` from any job without `paidData`, which is every anonymous
     * and free job, so returning it here would hand a stranger a field the
     * signed-in free tier does not get.
     */
    data.farcaster = {
      username: row.farcaster,
      url: row.farcasterUrl,
      fid: row.fcFid,
      verified: row.farcasterVerified,
    };
  }

  const found = Boolean(
    row.twitterHandle || row.farcaster || row.ensName || row.lens || row.github
  );

  // Charged on the same predicate the billing path uses, so the tool and the
  // meter never disagree about what a match is. An ENS-only row is free.
  if (isBillable(row.twitterHandle, row.farcaster)) {
    await consumeAnonMatchBudget(clientIp, 1);
  }

  return NextResponse.json(
    {
      data: found ? data : null,
      wallet: address,
      found,
      checked_at: row.lastCheckedAt ?? null,
    },
    { headers: formatRateLimitHeaders(hourly) }
  );
}
