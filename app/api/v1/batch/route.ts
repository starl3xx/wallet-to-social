import { NextRequest, NextResponse } from 'next/server';
import { inArray } from 'drizzle-orm';
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
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

interface BatchRequestBody {
  wallets: string[];
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  // Parse request body first to get wallet count for rate limiting
  let body: BatchRequestBody;
  try {
    body = await request.json();
  } catch {
    return apiError('Invalid JSON body', 'INVALID_REQUEST', 400, corsHeaders);
  }

  // Validate wallets array
  if (!body.wallets || !Array.isArray(body.wallets)) {
    return apiError(
      'Missing or invalid "wallets" array in request body',
      'INVALID_REQUEST',
      400,
      corsHeaders
    );
  }

  if (body.wallets.length === 0) {
    return apiError(
      'Wallets array cannot be empty',
      'INVALID_REQUEST',
      400,
      corsHeaders
    );
  }

  // Authenticate request with credits = wallet count
  const authResult = await authenticateApiRequest(request, body.wallets.length);
  if ('error' in authResult) {
    return authResult.error;
  }

  const { context } = authResult;

  // Check batch size limit
  const maxBatchSize = context.plan.maxBatchSize;
  if (body.wallets.length > maxBatchSize) {
    return apiError(
      `Batch size exceeds plan limit. Maximum: ${maxBatchSize} wallets. Upgrade your plan for higher limits.`,
      'BATCH_SIZE_EXCEEDED',
      400,
      { ...context.rateLimitHeaders, ...corsHeaders }
    );
  }

  // Validate and normalize wallet addresses
  const invalidWallets: string[] = [];
  const normalizedWallets: string[] = [];

  for (const wallet of body.wallets) {
    if (!isValidWalletAddress(wallet)) {
      invalidWallets.push(wallet);
    } else {
      normalizedWallets.push(normalizeWalletAddress(wallet));
    }
  }

  if (invalidWallets.length > 0) {
    return apiError(
      `Invalid wallet addresses: ${invalidWallets.slice(0, 5).join(', ')}${invalidWallets.length > 5 ? ` and ${invalidWallets.length - 5} more` : ''}`,
      'INVALID_ADDRESS',
      400,
      { ...context.rateLimitHeaders, ...corsHeaders }
    );
  }

  // Deduplicate
  const uniqueWallets = [...new Set(normalizedWallets)];

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
      lens: socialGraph.lens,
      github: socialGraph.github,
      sources: socialGraph.sources,
      lastUpdatedAt: socialGraph.lastUpdatedAt,
    })
    .from(socialGraph)
    .where(inArray(socialGraph.wallet, uniqueWallets));

  // Build result map
  const resultMap = new Map<string, typeof results[0]>();
  for (const result of results) {
    resultMap.set(result.wallet, result);
  }

  // Build response array in same order as input
  const data: Array<Record<string, unknown> | null> = [];
  let foundCount = 0;

  for (const wallet of uniqueWallets) {
    const result = resultMap.get(wallet);
    if (!result) {
      data.push(null);
      continue;
    }

    foundCount++;

    const item: Record<string, unknown> = {
      wallet: result.wallet,
    };

    if (result.ensName) item.ens_name = result.ensName;
    if (result.twitterHandle) {
      item.twitter = {
        handle: result.twitterHandle,
        url: result.twitterUrl || `https://twitter.com/${result.twitterHandle}`,
      };
    }
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

    data.push(item);
  }

  // Track usage
  trackApiUsage({
    apiKeyId: context.key.id,
    endpoint: '/v1/batch',
    method: 'POST',
    walletCount: uniqueWallets.length,
    responseStatus: 200,
    latencyMs: Date.now() - startTime,
    creditsUsed: uniqueWallets.length,
  }).catch(console.error);

  return apiSuccess(
    {
      data,
      meta: {
        requested: uniqueWallets.length,
        found: foundCount,
        not_found: uniqueWallets.length - foundCount,
      },
    },
    { ...context.rateLimitHeaders, ...corsHeaders }
  );
}
