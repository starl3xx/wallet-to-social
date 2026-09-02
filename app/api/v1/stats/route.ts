import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest, apiSuccess, apiError } from '@/lib/api-auth';
import { trackApiUsage } from '@/lib/api-usage';
import { readCoverageStats } from '@/lib/coverage-stats';
import {
  CHAIN_MATCH_RATES,
  CHAIN_MATCH_RATES_MEASURED_ON,
  CHAIN_MATCH_RATE_OVERALL_PCT,
} from '@/lib/public-figures';

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

/**
 * The measured per-chain match rates, served where an agent plans a spend
 * (docs/AGENT-SYSTEM.md, gap 19). Constants, not database counts: they come
 * from the dated 26-collection measurement recorded in the coverage docs and
 * registered in scripts/check-published-figures.ts, which is also what keeps
 * them from being quoted after they age out. Percentages are of holders with
 * an X or Farcaster account, the billable predicate; `either_pct` is the
 * planning number, and the overall figure is holders-weighted across the
 * whole sample, so it describes no single collection.
 */
const MATCH_RATES = {
  measured_on: CHAIN_MATCH_RATES_MEASURED_ON,
  basis:
    'Measured across 26 real collections and 72,318 holders, against the index alone. The chain decides this more than anything else about a collection; use the row for your chain, not the overall figure.',
  overall_either_pct: CHAIN_MATCH_RATE_OVERALL_PCT,
  by_chain: CHAIN_MATCH_RATES,
};

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
      data: { ...materialized.stats, match_rates: MATCH_RATES },
      meta: {
        generated_at: new Date().toISOString(),
        as_of: materialized.asOf.toISOString(),
      },
    },
    { ...context.rateLimitHeaders, ...corsHeaders }
  );
}
