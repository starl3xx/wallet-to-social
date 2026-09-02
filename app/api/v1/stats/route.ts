import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest, apiSuccess, apiError } from '@/lib/api-auth';
import { trackApiUsage } from '@/lib/api-usage';
import { readCoverageStats } from '@/lib/coverage-stats';

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

// Stats endpoint is free (0 credits). authenticateApiRequest skips the
// balance refusal for a declared cost of zero, so this answers at zero
// balance; see lib/api-auth.ts.
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

  /**
   * Materialized counts, refreshed daily by /api/cron/refresh-coverage, never
   * a live aggregate over the whole index: this endpoint is free, and a free
   * endpoint that costs a table scan is one the docs had to warn agents not
   * to poll. `meta.as_of` says when the counts were taken;
   * `meta.generated_at` stays what it always was, when this response was
   * built. See lib/coverage-stats.ts.
   */
  const materialized = await readCoverageStats();
  if (!materialized) {
    return apiError(
      'Service temporarily unavailable',
      'SERVICE_UNAVAILABLE',
      503,
      { ...context.rateLimitHeaders, ...corsHeaders }
    );
  }

  // Track usage
  trackApiUsage({
    apiKeyId: context.key.id,
    endpoint: '/v1/stats',
    method: 'GET',
    walletCount: 0,
    responseStatus: 200,
    latencyMs: Date.now() - startTime,
    creditsUsed: CREDITS_COST,
    // Index-wide counts. Resolves no wallet, bills nothing.
    matches: null,
  }).catch(console.error);

  return apiSuccess(
    {
      data: materialized.stats,
      meta: {
        generated_at: new Date().toISOString(),
        as_of: materialized.asOf.toISOString(),
      },
    },
    { ...context.rateLimitHeaders, ...corsHeaders }
  );
}
