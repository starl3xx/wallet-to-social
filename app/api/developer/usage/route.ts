import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { users, apiKeys, apiPlans } from '@/db/schema';
import { getKeyUsageStats } from '@/lib/api-usage';
import { getRateLimitStatus } from '@/lib/rate-limiter';

export const runtime = 'nodejs';

/**
 * GET /api/developer/usage
 * Get usage statistics for all of a user's API keys
 */
export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email');
  const period = (request.nextUrl.searchParams.get('period') as 'day' | 'week' | 'month') || 'month';
  const keyId = request.nextUrl.searchParams.get('keyId');

  if (!email) {
    return NextResponse.json(
      { error: 'Email parameter required' },
      { status: 400 }
    );
  }

  if (!['day', 'week', 'month'].includes(period)) {
    return NextResponse.json(
      { error: 'Invalid period. Use: day, week, or month' },
      { status: 400 }
    );
  }

  const db = getDb();
  if (!db) {
    return NextResponse.json(
      { error: 'Database not configured' },
      { status: 503 }
    );
  }

  // Get user by email
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);

  if (!user) {
    return NextResponse.json(
      { error: 'User not found' },
      { status: 404 }
    );
  }

  // Get user's API keys
  const keys = await db
    .select({
      key: apiKeys,
      plan: apiPlans,
    })
    .from(apiKeys)
    .innerJoin(apiPlans, eq(apiKeys.plan, apiPlans.id))
    .where(eq(apiKeys.userId, user.id));

  // Filter to specific key if requested
  const targetKeys = keyId ? keys.filter((k) => k.key.id === keyId) : keys;

  if (targetKeys.length === 0) {
    return NextResponse.json(
      { error: keyId ? 'API key not found' : 'No API keys found for this user' },
      { status: 404 }
    );
  }

  // Get usage for each key
  const keysUsage = await Promise.all(
    targetKeys.map(async ({ key, plan }) => {
      const usageStats = await getKeyUsageStats(key.id, period);
      const rateLimitStatus = await getRateLimitStatus(key, plan);

      return {
        key: {
          id: key.id,
          name: key.name,
          prefix: key.keyPrefix,
          plan: plan.name,
          is_active: key.isActive,
          created_at: key.createdAt.toISOString(),
          last_used_at: key.lastUsedAt?.toISOString(),
        },
        plan_limits: {
          requests_per_minute: plan.requestsPerMinute,
          requests_per_day: plan.requestsPerDay === -1 ? 'unlimited' : plan.requestsPerDay,
          requests_per_month: plan.requestsPerMonth === -1 ? 'unlimited' : plan.requestsPerMonth,
          max_batch_size: plan.maxBatchSize,
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
          error_rate: Math.round(usageStats.errorRate * 10000) / 100,
          requests_by_endpoint: usageStats.requestsByEndpoint,
          requests_by_day: usageStats.requestsByDay,
        },
      };
    })
  );

  // Aggregate totals across all keys
  const totals = {
    total_requests: keysUsage.reduce((sum, k) => sum + k.usage.total_requests, 0),
    total_credits: keysUsage.reduce((sum, k) => sum + k.usage.total_credits, 0),
    total_wallets: keysUsage.reduce((sum, k) => sum + k.usage.total_wallets, 0),
    avg_latency_ms: Math.round(
      keysUsage.reduce((sum, k) => sum + k.usage.avg_latency_ms, 0) / keysUsage.length
    ),
  };

  return NextResponse.json({
    user: {
      email: user.email,
      tier: user.tier,
    },
    period,
    totals,
    keys: keysUsage,
    generated_at: new Date().toISOString(),
  });
}
