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

export const runtime = 'nodejs';

// CORS headers for public API
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
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

  // Track usage
  trackApiUsage({
    apiKeyId: context.key.id,
    endpoint: `/v1/wallet/${normalizedAddress}`,
    method: 'GET',
    walletCount: 1,
    responseStatus: hasSocials ? 200 : 404,
    latencyMs: Date.now() - startTime,
    creditsUsed: 1,
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
    data.twitter = {
      handle: result.twitterHandle,
      url: result.twitterUrl || `https://twitter.com/${result.twitterHandle}`,
      verified: result.twitterVerified ?? false,
    };
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
  if (result.sources) data.sources = result.sources;

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

  // Check staleness
  const now = new Date();
  const isStale = result.staleAt && now > result.staleAt;
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const isOld = result.lastUpdatedAt && result.lastUpdatedAt < thirtyDaysAgo;
  const dataIsStale = isStale || isOld;

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
