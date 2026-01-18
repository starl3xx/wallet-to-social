import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { socialGraph } from '@/db/schema';
import {
  authenticateApiRequest,
  apiSuccess,
  apiError,
  isValidTwitterHandle,
  normalizeTwitterHandle,
} from '@/lib/api-auth';
import { trackApiUsage } from '@/lib/api-usage';

export const runtime = 'nodejs';

// CORS headers for public API
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

// Reverse lookups cost 2 credits
const CREDITS_COST = 2;

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ handle: string }> }
) {
  const startTime = Date.now();
  const { handle } = await params;

  // Authenticate request
  const authResult = await authenticateApiRequest(request, CREDITS_COST);
  if ('error' in authResult) {
    return authResult.error;
  }

  const { context } = authResult;

  // Validate Twitter handle
  if (!isValidTwitterHandle(handle)) {
    return apiError(
      'Invalid Twitter handle format. Expected 1-15 alphanumeric characters or underscores.',
      'INVALID_HANDLE',
      400,
      { ...context.rateLimitHeaders, ...corsHeaders }
    );
  }

  const normalizedHandle = normalizeTwitterHandle(handle);

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

  // Find all wallets with this Twitter handle
  const results = await db
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
    })
    .from(socialGraph)
    .where(eq(socialGraph.twitterHandle, normalizedHandle))
    .limit(100); // Reasonable limit for reverse lookups

  // Track usage
  trackApiUsage({
    apiKeyId: context.key.id,
    endpoint: `/v1/reverse/twitter/${normalizedHandle}`,
    method: 'GET',
    walletCount: results.length,
    responseStatus: 200,
    latencyMs: Date.now() - startTime,
    creditsUsed: CREDITS_COST,
  }).catch(console.error);

  if (results.length === 0) {
    return apiSuccess(
      {
        data: [],
        meta: {
          handle: normalizedHandle,
          found: 0,
        },
      },
      { ...context.rateLimitHeaders, ...corsHeaders }
    );
  }

  // Build response array
  const data = results.map((result) => {
    const item: Record<string, unknown> = {
      wallet: result.wallet,
    };

    if (result.ensName) item.ens_name = result.ensName;
    item.twitter = {
      handle: result.twitterHandle,
      url: result.twitterUrl || `https://twitter.com/${result.twitterHandle}`,
    };
    if (result.farcaster) {
      item.farcaster = {
        username: result.farcaster,
        url: result.farcasterUrl || `https://warpcast.com/${result.farcaster}`,
        followers: result.fcFollowers,
        fid: result.fcFid,
      };
    }
    if (result.lens) item.lens = result.lens;
    if (result.github) item.github = result.github;
    if (result.sources) item.sources = result.sources;

    return item;
  });

  return apiSuccess(
    {
      data,
      meta: {
        handle: normalizedHandle,
        found: results.length,
      },
    },
    { ...context.rateLimitHeaders, ...corsHeaders }
  );
}
