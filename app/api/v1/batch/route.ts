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
import { batchFetchWeb3Bio } from '@/lib/web3bio';
import { batchFetchNeynar } from '@/lib/neynar';
import { getCachedWallets, cacheWalletResults } from '@/lib/cache';
import { upsertSocialGraph, socialGraphToResult } from '@/lib/social-graph';
import type { WalletSocialResult } from '@/lib/types';

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
  fresh?: boolean; // If true, perform fresh API lookups instead of just returning cached data
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
  const { fresh = false } = body;

  // Get database connection
  const db = getDb();
  if (!db) {
    return apiError(
      'Service temporarily unavailable',
      'SERVICE_UNAVAILABLE',
      503,
      { ...context.rateLimitHeaders, ...corsHeaders }
    );
  }

  let finalResults: Map<string, WalletSocialResult>;

  if (fresh) {
    // Fresh lookup mode: perform API calls like the main /api/lookup endpoint
    finalResults = new Map();
    
    // Initialize results with wallet addresses
    for (const wallet of uniqueWallets) {
      finalResults.set(wallet, {
        wallet,
        source: [],
      });
    }

    // Check cache first
    let uncachedWallets = uniqueWallets;
    let cacheHits = 0;

    try {
      const cached = await getCachedWallets(uniqueWallets);
      cacheHits = cached.size;

      // Merge cached results
      for (const [wallet, data] of cached) {
        const existing = finalResults.get(wallet)!;
        finalResults.set(wallet, {
          ...existing,
          ...data,
          source: [...data.source, 'cache'],
        });
      }

      // Filter to uncached wallets only
      uncachedWallets = uniqueWallets.filter(
        (w) => !cached.has(w.toLowerCase())
      );
    } catch (error) {
      console.error('Cache error:', error);
      // Continue without cache
    }

    // Only fetch uncached wallets
    if (uncachedWallets.length > 0) {
      // Web3.bio lookups
      try {
        const web3BioResults = await batchFetchWeb3Bio(uncachedWallets);

        // Merge Web3.bio results
        for (const [wallet, data] of web3BioResults) {
          const existing = finalResults.get(wallet)!;
          finalResults.set(wallet, {
            ...existing,
            ens_name: existing.ens_name || data.ens_name,
            twitter_handle: existing.twitter_handle || data.twitter_handle,
            twitter_url: existing.twitter_url || data.twitter_url,
            farcaster: data.farcaster || existing.farcaster,
            farcaster_url: data.farcaster_url || existing.farcaster_url,
            lens: data.lens || existing.lens,
            github: existing.github || data.github,
            source: existing.source.includes('web3bio')
              ? existing.source
              : [...existing.source, 'web3bio'],
          });
        }
      } catch (error) {
        console.error('Web3.bio fetch error:', error);
      }

      // Fetch from Neynar if API key is configured
      const neynarApiKey = process.env.NEYNAR_API_KEY;
      if (neynarApiKey) {
        try {
          const neynarResults = await batchFetchNeynar(uncachedWallets, neynarApiKey);

          // Merge Neynar results
          for (const [wallet, data] of neynarResults) {
            const existing = finalResults.get(wallet)!;
            finalResults.set(wallet, {
              ...existing,
              twitter_handle: existing.twitter_handle || data.twitter_handle,
              twitter_url: existing.twitter_url || data.twitter_url,
              farcaster: data.farcaster || existing.farcaster,
              farcaster_url: data.farcaster_url || existing.farcaster_url,
              fc_followers: data.fc_followers,
              fc_fid: data.fc_fid,
              source: existing.source.includes('neynar')
                ? existing.source
                : [...existing.source, 'neynar'],
            });
          }
        } catch (error) {
          console.error('Neynar fetch error:', error);
        }
      }

      // Cache newly fetched results
      try {
        const newResults = uncachedWallets
          .map((w) => finalResults.get(w.toLowerCase())!)
          .filter((r) => r.source.length > 0 && !r.source.includes('cache'));

        if (newResults.length > 0) {
          await cacheWalletResults(newResults);
        }
      } catch (error) {
        console.error('Cache write error:', error);
      }

      // Persist positive results to social graph
      try {
        const positiveResults = Array.from(finalResults.values()).filter(
          (r) =>
            r.twitter_handle ||
            r.farcaster ||
            r.lens ||
            r.github ||
            r.ens_name
        );

        if (positiveResults.length > 0) {
          await upsertSocialGraph(positiveResults);
        }
      } catch (error) {
        console.error('Social graph persist error:', error);
      }
    }
  } else {
    // Cached mode: only return data from social_graph (existing behavior)
    const results = await db
      .select()
      .from(socialGraph)
      .where(inArray(socialGraph.wallet, uniqueWallets));

    finalResults = new Map();
    for (const result of results) {
      const converted = socialGraphToResult(result);
      finalResults.set(result.wallet, {
        wallet: result.wallet,
        source: ['graph'],
        ...converted,
      });
    }
  }

  // Build response array in same order as input
  const data: Array<Record<string, unknown> | null> = [];
  let foundCount = 0;

  for (const wallet of uniqueWallets) {
    const result = finalResults.get(wallet);
    if (!result || (!result.twitter_handle && !result.farcaster && !result.lens && !result.github && !result.ens_name)) {
      data.push(null);
      continue;
    }

    foundCount++;

    const item: Record<string, unknown> = {
      wallet: result.wallet,
    };

    if (result.ens_name) item.ens_name = result.ens_name;
    if (result.twitter_handle) {
      item.twitter = {
        handle: result.twitter_handle,
        url: result.twitter_url || `https://twitter.com/${result.twitter_handle}`,
      };
    }
    if (result.farcaster) {
      item.farcaster = {
        username: result.farcaster,
        url: result.farcaster_url || `https://warpcast.com/${result.farcaster}`,
        followers: result.fc_followers,
        fid: result.fc_fid,
      };
    }
    if (result.lens) item.lens = result.lens;
    if (result.github) item.github = result.github;
    if (result.source) item.sources = result.source;

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
        fresh_lookups: fresh,
        ...(fresh && { cache_hits: finalResults ? Array.from(finalResults.values()).filter(r => r.source?.includes('cache')).length : 0 }),
      },
    },
    { ...context.rateLimitHeaders, ...corsHeaders }
  );
}
