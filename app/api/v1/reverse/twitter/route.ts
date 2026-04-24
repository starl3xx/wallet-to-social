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

const CREDITS_COST = 1;
const MAX_RESULTS = 10;

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET(request: NextRequest) {
  const startTime = Date.now();

  // Authenticate request (1 credit)
  const authResult = await authenticateApiRequest(request, CREDITS_COST);
  if ('error' in authResult) return authResult.error;
  const { context } = authResult;

  const { searchParams } = new URL(request.url);
  const handle = searchParams.get('handle');

  // Validate required parameter
  if (!handle) {
    return apiError(
      'Missing required query parameter: handle',
      'MISSING_PARAMETER',
      400,
      { ...context.rateLimitHeaders, ...corsHeaders }
    );
  }

  // Validate handle format
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
      sources: socialGraph.sources,
    })
    .from(socialGraph)
    .where(eq(socialGraph.twitterHandle, normalizedHandle))
    .limit(MAX_RESULTS);

  // Track usage
  trackApiUsage({
    apiKeyId: context.key.id,
    endpoint: '/v1/reverse/twitter',
    method: 'GET',
    walletCount: results.length,
    responseStatus: 200,
    latencyMs: Date.now() - startTime,
    creditsUsed: CREDITS_COST,
  }).catch(console.error);

  // Build response array, omitting null fields
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
        fid: result.fcFid,
        followers: result.fcFollowers,
        url: result.farcasterUrl || `https://warpcast.com/${result.farcaster}`,
      };
    }
    if (result.sources) item.sources = result.sources;

    return item;
  });

  return apiSuccess(
    {
      data,
      meta: {
        query: { handle },
        found: results.length,
      },
    },
    { ...context.rateLimitHeaders, ...corsHeaders }
  );
}
