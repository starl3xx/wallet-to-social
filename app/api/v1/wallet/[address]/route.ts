import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { socialGraph } from '@/db/schema';
import {
  authenticateApiRequest,
  apiSuccess,
  apiError,
  isValidWalletAddress,
  normalizeWalletAddress,
} from '@/lib/api-auth';
import { trackApiUsage } from '@/lib/api-usage';
import { publicSources } from '@/lib/api-sources';
import {
  reachabilityForWallets,
  alsoOnXForWallets,
  publicTwitterField,
} from '@/lib/handle-reachability';
import {
  loadSuppressionList,
  isKindSuppressed,
  type SuppressionSets,
} from '@/lib/suppression';
import { isRecordStale } from '@/lib/staleness';

export const runtime = 'nodejs';

// CORS headers for public API
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  // Non-safelisted response headers are invisible to browser JS unless
  // exposed, and the docs tell callers to read these.
  'Access-Control-Expose-Headers':
    'X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, X-Matches-Available, Retry-After, X-Data-Staleness, X-Last-Updated',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const startTime = Date.now();
  const { address } = await params;

  // Authenticate request
  const authResult = await authenticateApiRequest(request, 1);
  if ('error' in authResult) {
    return authResult.error;
  }

  const { context } = authResult;

  // Validate wallet address
  if (!isValidWalletAddress(address)) {
    return apiError(
      'Invalid wallet address format. Expected 0x followed by 40 hex characters.',
      'INVALID_ADDRESS',
      400,
      { ...context.rateLimitHeaders, ...corsHeaders }
    );
  }

  const normalizedAddress = normalizeWalletAddress(address);

  // Query social graph
  const db = getDb();
  if (!db) {
    return apiError(
      'Service temporarily unavailable',
      'SERVICE_UNAVAILABLE',
      503,
      { ...context.rateLimitHeaders, ...corsHeaders }
    );
  }

  /**
   * The suppression list, before the index is read. The storage triggers
   * only guard WRITES: after a backup restore, or in the window where an
   * erasure failed after its suppression row committed, the graph row still
   * exists and this route would keep serving the mapping. So the forward
   * read filters through the same list the reverse routes ask: a suppressed
   * wallet answers exactly as a never-indexed one (the query is skipped, so
   * there is no checked_at to leak), and a suppressed handle on someone
   * else's wallet is dropped from the row before anything reads it. Fail
   * closed: an unreadable list refuses the request rather than serving
   * unfiltered.
   */
  let suppression: SuppressionSets;
  try {
    suppression = await loadSuppressionList();
  } catch (error) {
    console.error('Suppression check failed on /v1/wallet:', error);
    return apiError(
      'Service temporarily unavailable',
      'SERVICE_UNAVAILABLE',
      503,
      { ...context.rateLimitHeaders, ...corsHeaders }
    );
  }
  if (isKindSuppressed(suppression, 'wallet', normalizedAddress)) {
    trackApiUsage({
      apiKeyId: context.key.id,
      endpoint: '/v1/wallet/{address}',
      method: 'GET',
      walletCount: 1,
      responseStatus: 404,
      latencyMs: Date.now() - startTime,
      creditsUsed: 1,
      matches: 0,
    }).catch(console.error);
    return apiSuccess(
      {
        data: null,
        meta: { wallet: normalizedAddress, found: false, checked_at: null },
      },
      { ...context.rateLimitHeaders, ...corsHeaders },
      200
    );
  }

  const [result] = await db
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
      lastUpdatedAt: socialGraph.lastUpdatedAt,
      // Quality metadata
      twitterVerified: socialGraph.twitterVerified,
      farcasterVerified: socialGraph.farcasterVerified,
      dataQualityScore: socialGraph.dataQualityScore,
      lastVerificationAt: socialGraph.lastVerificationAt,
      staleAt: socialGraph.staleAt,
      // Agent metadata
      isAgent: socialGraph.isAgent,
      agentName: socialGraph.agentName,
      agentFramework: socialGraph.agentFramework,
      agentType: socialGraph.agentType,
      agentTokenSymbol: socialGraph.agentTokenSymbol,
      agentVerified: socialGraph.agentVerified,
      lastCheckedAt: socialGraph.lastCheckedAt,
    })
    .from(socialGraph)
    .where(eq(socialGraph.wallet, normalizedAddress))
    .limit(1);

  // A suppressed handle on this (unsuppressed) wallet is dropped before
  // the presence test below, so a row whose only identity was the removed
  // handle serves the checked-and-empty shape, indistinguishable from a
  // persisted negative.
  if (result) {
    if (isKindSuppressed(suppression, 'twitter', result.twitterHandle)) {
      result.twitterHandle = null;
      result.twitterUrl = null;
      result.twitterVerified = null;
    }
    if (isKindSuppressed(suppression, 'farcaster', result.farcaster)) {
      result.farcaster = null;
      result.farcasterUrl = null;
      result.fcFollowers = null;
      result.fcFid = null;
      result.farcasterVerified = null;
    }
    if (isKindSuppressed(suppression, 'ens', result.ensName)) {
      result.ensName = null;
    }
    if (isKindSuppressed(suppression, 'lens', result.lens)) {
      result.lens = null;
    }
    if (isKindSuppressed(suppression, 'github', result.github)) {
      result.github = null;
    }
  }

  // Persisted negatives (checked, no socials found) are rows too — they must
  // report found: false, not an empty found: true object
  const hasSocials = !!(
    result &&
    (result.twitterHandle ||
      result.farcaster ||
      result.ensName ||
      result.lens ||
      result.github)
  );

  /**
   * `hasSocials` is wider than a match: it counts ENS, Lens and GitHub too, and
   * the app bills for neither. A wallet that resolves only to an ENS name is a
   * 200 the caller wanted and a miss they are not charged for.
   */
  const isMatch = !!(result && (result.twitterHandle || result.farcaster));

  // Track usage
  trackApiUsage({
    apiKeyId: context.key.id,
    // The route template, never the concrete path: a per-address key makes
    // requests_by_endpoint unbounded and persists what the caller looked up.
    endpoint: '/v1/wallet/{address}',
    method: 'GET',
    walletCount: 1,
    responseStatus: hasSocials ? 200 : 404,
    latencyMs: Date.now() - startTime,
    creditsUsed: 1,
    matches: isMatch ? 1 : 0,
  }).catch(console.error);

  if (!result || !hasSocials) {
    return apiSuccess(
      {
        data: null,
        meta: {
          wallet: normalizedAddress,
          found: false,
          // Distinguishes "never seen" (null) from "checked, nothing there"
          checked_at: result?.lastCheckedAt?.toISOString() ?? null,
        },
      },
      { ...context.rateLimitHeaders, ...corsHeaders },
      200 // Return 200 with null data for not found (common API pattern)
    );
  }

  // Build response, omitting null/undefined values
  const data: Record<string, unknown> = {
    wallet: result.wallet,
  };

  if (result.ensName) data.ens_name = result.ensName;
  if (result.twitterHandle) {
    // Wallet-aware: a handle can be live and still belong to somebody other
    // than the account attested alongside THIS wallet. See reachabilityForWallets.
    // The second read is a second live handle attested for the same wallet,
    // which rides along as `also` rather than replacing this one. Both are
    // reads of the same two tables and neither needs the other, so they run
    // together.
    const row = { wallet: result.wallet, handle: result.twitterHandle };
    const [reach, also] = await Promise.all([
      reachabilityForWallets([row]),
      alsoOnXForWallets([row]),
    ]);
    // The also stamp reads live handle_conflicts, which mid-erasure can
    // still carry a suppressed second handle; it is filtered against the
    // same list as everything else on this response.
    const alsoVal = also.get(result.wallet.toLowerCase()) ?? null;
    data.twitter = publicTwitterField({
      handle: result.twitterHandle,
      url: result.twitterUrl,
      verified: result.twitterVerified,
      reachability: reach.get(result.wallet.toLowerCase()) ?? null,
      also:
        alsoVal && !isKindSuppressed(suppression, 'twitter', alsoVal.handle)
          ? alsoVal
          : null,
    });
  }
  if (result.farcaster) {
    data.farcaster = {
      username: result.farcaster,
      url: result.farcasterUrl || `https://warpcast.com/${result.farcaster}`,
      followers: result.fcFollowers,
      fid: result.fcFid,
      verified: result.farcasterVerified ?? false,
    };
  }
  if (result.lens) data.lens = result.lens;
  if (result.github) data.github = result.github;
  // Evidence classes, never the internal pipeline identifiers — see lib/api-sources.ts
  const sources = publicSources(result.sources);
  if (sources) data.sources = sources;

  // Agent metadata
  if (result.isAgent) {
    data.agent = {
      is_agent: true,
      name: result.agentName ?? undefined,
      framework: result.agentFramework ?? undefined,
      type: result.agentType ?? undefined,
      token_symbol: result.agentTokenSymbol ?? undefined,
      verified: result.agentVerified ?? false,
    };
  }

  // Add quality metadata
  data.quality = {
    score: result.dataQualityScore ?? 0,
    last_verified: result.lastVerificationAt?.toISOString() ?? null,
  };

  // Check staleness. One derivation, shared with /v1/batch: see lib/staleness.ts
  const dataIsStale = isRecordStale(result.staleAt, result.lastUpdatedAt);

  // Build headers with staleness info if needed
  const stalenessHeaders = dataIsStale
    ? {
        'X-Data-Staleness': 'stale',
        'X-Last-Updated': result.lastUpdatedAt?.toISOString() ?? '',
      }
    : {};

  return apiSuccess(
    {
      data,
      meta: {
        wallet: normalizedAddress,
        found: true,
        last_updated: result.lastUpdatedAt?.toISOString(),
        stale: dataIsStale,
      },
    },
    { ...context.rateLimitHeaders, ...corsHeaders, ...stalenessHeaders }
  );
}
