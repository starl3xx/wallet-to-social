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
import { publicSources } from '@/lib/api-sources';

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

// Bound the actual bytes read from the stream — NOT Content-Length, which a
// caller can omit, understate, or evade with chunked transfer-encoding. Reads
// until the cap, then aborts. The max batch is ~1000 addresses (~46 KB); 1 MB
// is generous. Rate limiting needs the wallet count from the body, so we can't
// authenticate before reading, but this caps what an unauthenticated caller
// can force us to buffer and parse.
const MAX_BODY_BYTES = 1_000_000;

async function readBodyCapped(request: NextRequest, maxBytes: number): Promise<string | null> {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null; // over the cap
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  const raw = await readBodyCapped(request, MAX_BODY_BYTES);
  if (raw === null) {
    return apiError('Request body too large', 'INVALID_REQUEST', 413, corsHeaders);
  }

  // Parse the (now size-bounded) body to get the wallet count for rate limiting
  let body: BatchRequestBody;
  try {
    body = JSON.parse(raw);
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
      // Agent metadata
      isAgent: socialGraph.isAgent,
      agentName: socialGraph.agentName,
      agentFramework: socialGraph.agentFramework,
      agentType: socialGraph.agentType,
      agentTokenSymbol: socialGraph.agentTokenSymbol,
      agentVerified: socialGraph.agentVerified,
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
    // Persisted negatives (rows with no socials) are "not found" to API
    // consumers — same null as a wallet we have never seen
    const hasSocials = !!(
      result &&
      (result.twitterHandle ||
        result.farcaster ||
        result.ensName ||
        result.lens ||
        result.github)
    );
    if (!result || !hasSocials) {
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
    // Evidence classes, never the internal pipeline identifiers — see lib/api-sources.ts
    const sources = publicSources(result.sources);
    if (sources) item.sources = sources;

    // Agent metadata
    if (result.isAgent) {
      item.agent = {
        is_agent: true,
        name: result.agentName ?? undefined,
        framework: result.agentFramework ?? undefined,
        type: result.agentType ?? undefined,
        token_symbol: result.agentTokenSymbol ?? undefined,
        verified: result.agentVerified ?? false,
      };
    }

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
