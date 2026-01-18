import { NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest, apiSuccess, apiError } from '@/lib/api-auth';
import { getKeyUsageStats } from '@/lib/api-usage';
import { getRateLimitStatus } from '@/lib/rate-limiter';
import { trackApiUsage } from '@/lib/api-usage';

export const runtime = 'nodejs';

// CORS headers for public API
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

// Usage endpoint is free (0 credits)
const CREDITS_COST = 0;

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET(request: NextRequest) {
  const startTime = Date.now();

  // Authenticate request
  const authResult = await authenticateApiRequest(request, CREDITS_COST);
  if ('error' in authResult) {
    return authResult.error;
  }

  const { context } = authResult;

  // Get period from query params (default: month)
  const url = new URL(request.url);
  const period = (url.searchParams.get('period') as 'day' | 'week' | 'month') || 'month';

  if (!['day', 'week', 'month'].includes(period)) {
    return apiError(
      'Invalid period. Use: day, week, or month',
      'INVALID_PARAMETER',
      400,
      { ...context.rateLimitHeaders, ...corsHeaders }
    );
  }

  // Get usage stats
  const usageStats = await getKeyUsageStats(context.key.id, period);

  // Get rate limit status
  const rateLimitStatus = await getRateLimitStatus(context.key, context.plan);

  // Track usage
  trackApiUsage({
    apiKeyId: context.key.id,
    endpoint: '/v1/usage',
    method: 'GET',
    walletCount: 0,
    responseStatus: 200,
    latencyMs: Date.now() - startTime,
    creditsUsed: CREDITS_COST,
  }).catch(console.error);

  return apiSuccess(
    {
      data: {
        key: {
          id: context.key.id,
          name: context.key.name,
          prefix: context.key.keyPrefix,
          plan: context.plan.name,
          created_at: context.key.createdAt.toISOString(),
          last_used_at: context.key.lastUsedAt?.toISOString(),
        },
        plan_limits: {
          requests_per_minute: context.plan.requestsPerMinute,
          requests_per_day: context.plan.requestsPerDay === -1 ? 'unlimited' : context.plan.requestsPerDay,
          requests_per_month: context.plan.requestsPerMonth === -1 ? 'unlimited' : context.plan.requestsPerMonth,
          max_batch_size: context.plan.maxBatchSize,
        },
        rate_limits: {
          minute: rateLimitStatus.minute
            ? {
                limit: rateLimitStatus.minute.limit,
                remaining: rateLimitStatus.minute.remaining,
                reset_at: rateLimitStatus.minute.resetAt.toISOString(),
              }
            : null,
          day: rateLimitStatus.day
            ? {
                limit: rateLimitStatus.day.limit,
                remaining: rateLimitStatus.day.remaining,
                reset_at: rateLimitStatus.day.resetAt.toISOString(),
              }
            : null,
          month: rateLimitStatus.month
            ? {
                limit: rateLimitStatus.month.limit,
                remaining: rateLimitStatus.month.remaining,
                reset_at: rateLimitStatus.month.resetAt.toISOString(),
              }
            : null,
        },
        usage: {
          period,
          total_requests: usageStats.totalRequests,
          total_credits: usageStats.totalCredits,
          total_wallets: usageStats.totalWallets,
          avg_latency_ms: usageStats.avgLatencyMs,
          error_rate: Math.round(usageStats.errorRate * 10000) / 100, // Convert to percentage
          requests_by_endpoint: usageStats.requestsByEndpoint,
          requests_by_day: usageStats.requestsByDay,
        },
      },
      meta: {
        generated_at: new Date().toISOString(),
      },
    },
    { ...context.rateLimitHeaders, ...corsHeaders }
  );
}
