import { NextRequest, NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { socialGraph } from '@/db/schema';
import { authenticateApiRequest, apiSuccess, apiError } from '@/lib/api-auth';
import { trackApiUsage } from '@/lib/api-usage';

export const runtime = 'nodejs';

// CORS headers for public API
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

// Stats endpoint is free (0 credits)
const CREDITS_COST = 0;

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET(request: NextRequest) {
  const startTime = Date.now();

  // Authenticate request (still requires valid API key)
  const authResult = await authenticateApiRequest(request, CREDITS_COST);
  if ('error' in authResult) {
    return authResult.error;
  }

  const { context } = authResult;

  // Query social graph stats
  const db = getDb();
  if (!db) {
    return apiError(
      'Service temporarily unavailable',
      'SERVICE_UNAVAILABLE',
      503,
      { ...context.rateLimitHeaders, ...corsHeaders }
    );
  }

  const [stats] = await db
    .select({
      totalWallets: sql<number>`COUNT(*)::int`,
      withTwitter: sql<number>`COUNT(*) FILTER (WHERE ${socialGraph.twitterHandle} IS NOT NULL)::int`,
      withFarcaster: sql<number>`COUNT(*) FILTER (WHERE ${socialGraph.farcaster} IS NOT NULL)::int`,
      withEns: sql<number>`COUNT(*) FILTER (WHERE ${socialGraph.ensName} IS NOT NULL)::int`,
      withLens: sql<number>`COUNT(*) FILTER (WHERE ${socialGraph.lens} IS NOT NULL)::int`,
      withGithub: sql<number>`COUNT(*) FILTER (WHERE ${socialGraph.github} IS NOT NULL)::int`,
      avgFcFollowers: sql<number>`COALESCE(AVG(${socialGraph.fcFollowers}) FILTER (WHERE ${socialGraph.fcFollowers} IS NOT NULL), 0)::int`,
      maxFcFollowers: sql<number>`COALESCE(MAX(${socialGraph.fcFollowers}), 0)::int`,
    })
    .from(socialGraph);

  // Track usage
  trackApiUsage({
    apiKeyId: context.key.id,
    endpoint: '/v1/stats',
    method: 'GET',
    walletCount: 0,
    responseStatus: 200,
    latencyMs: Date.now() - startTime,
    creditsUsed: CREDITS_COST,
  }).catch(console.error);

  return apiSuccess(
    {
      data: {
        total_wallets: stats?.totalWallets ?? 0,
        coverage: {
          twitter: stats?.withTwitter ?? 0,
          farcaster: stats?.withFarcaster ?? 0,
          ens: stats?.withEns ?? 0,
          lens: stats?.withLens ?? 0,
          github: stats?.withGithub ?? 0,
        },
        farcaster_stats: {
          avg_followers: stats?.avgFcFollowers ?? 0,
          max_followers: stats?.maxFcFollowers ?? 0,
        },
      },
      meta: {
        generated_at: new Date().toISOString(),
      },
    },
    { ...context.rateLimitHeaders, ...corsHeaders }
  );
}
