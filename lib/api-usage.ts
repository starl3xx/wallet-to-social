import { eq, and, gte, sql, desc } from 'drizzle-orm';
import { getDb } from '@/db';
import { apiUsage, type NewApiUsage } from '@/db/schema';

/**
 * Tracks an API request for billing and analytics
 * Fire-and-forget - doesn't block the response
 */
export async function trackApiUsage(usage: {
  apiKeyId: string;
  endpoint: string;
  method: string;
  walletCount?: number;
  responseStatus: number;
  latencyMs: number;
  creditsUsed?: number;
}): Promise<void> {
  const db = getDb();
  if (!db) return;

  try {
    await db.insert(apiUsage).values({
      apiKeyId: usage.apiKeyId,
      endpoint: usage.endpoint,
      method: usage.method,
      walletCount: usage.walletCount ?? 1,
      responseStatus: usage.responseStatus,
      latencyMs: usage.latencyMs,
      creditsUsed: usage.creditsUsed ?? 1,
    });
  } catch (error) {
    console.error('Failed to track API usage:', error);
  }
}

/**
 * Gets usage statistics for an API key
 */
export async function getKeyUsageStats(
  apiKeyId: string,
  period: 'day' | 'week' | 'month' = 'month'
): Promise<{
  totalRequests: number;
  totalCredits: number;
  totalWallets: number;
  avgLatencyMs: number;
  errorRate: number;
  requestsByEndpoint: Record<string, number>;
  requestsByDay: Array<{ date: string; count: number; credits: number }>;
}> {
  const db = getDb();
  if (!db) {
    return {
      totalRequests: 0,
      totalCredits: 0,
      totalWallets: 0,
      avgLatencyMs: 0,
      errorRate: 0,
      requestsByEndpoint: {},
      requestsByDay: [],
    };
  }

  const periodStart = new Date();
  switch (period) {
    case 'day':
      periodStart.setDate(periodStart.getDate() - 1);
      break;
    case 'week':
      periodStart.setDate(periodStart.getDate() - 7);
      break;
    case 'month':
      periodStart.setMonth(periodStart.getMonth() - 1);
      break;
  }

  // Get aggregate stats
  const [stats] = await db
    .select({
      totalRequests: sql<number>`COUNT(*)::int`,
      totalCredits: sql<number>`COALESCE(SUM(${apiUsage.creditsUsed}), 0)::int`,
      totalWallets: sql<number>`COALESCE(SUM(${apiUsage.walletCount}), 0)::int`,
      avgLatencyMs: sql<number>`COALESCE(AVG(${apiUsage.latencyMs}), 0)::int`,
      errorCount: sql<number>`COUNT(*) FILTER (WHERE ${apiUsage.responseStatus} >= 400)::int`,
    })
    .from(apiUsage)
    .where(and(eq(apiUsage.apiKeyId, apiKeyId), gte(apiUsage.createdAt, periodStart)));

  const totalRequests = stats?.totalRequests ?? 0;
  const errorCount = stats?.errorCount ?? 0;

  // Get requests by endpoint
  const endpointStats = await db
    .select({
      endpoint: apiUsage.endpoint,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(apiUsage)
    .where(and(eq(apiUsage.apiKeyId, apiKeyId), gte(apiUsage.createdAt, periodStart)))
    .groupBy(apiUsage.endpoint);

  const requestsByEndpoint: Record<string, number> = {};
  for (const row of endpointStats) {
    requestsByEndpoint[row.endpoint] = row.count;
  }

  // Get requests by day
  const dailyStats = await db
    .select({
      date: sql<string>`DATE(${apiUsage.createdAt})::text`,
      count: sql<number>`COUNT(*)::int`,
      credits: sql<number>`COALESCE(SUM(${apiUsage.creditsUsed}), 0)::int`,
    })
    .from(apiUsage)
    .where(and(eq(apiUsage.apiKeyId, apiKeyId), gte(apiUsage.createdAt, periodStart)))
    .groupBy(sql`DATE(${apiUsage.createdAt})`)
    .orderBy(sql`DATE(${apiUsage.createdAt})`);

  return {
    totalRequests,
    totalCredits: stats?.totalCredits ?? 0,
    totalWallets: stats?.totalWallets ?? 0,
    avgLatencyMs: stats?.avgLatencyMs ?? 0,
    errorRate: totalRequests > 0 ? errorCount / totalRequests : 0,
    requestsByEndpoint,
    requestsByDay: dailyStats,
  };
}

/**
 * Gets recent usage history for an API key
 */
export async function getRecentUsage(
  apiKeyId: string,
  limit: number = 100
): Promise<Array<{
  id: string;
  endpoint: string;
  method: string;
  walletCount: number;
  responseStatus: number;
  latencyMs: number;
  creditsUsed: number;
  createdAt: Date;
}>> {
  const db = getDb();
  if (!db) return [];

  return db
    .select({
      id: apiUsage.id,
      endpoint: apiUsage.endpoint,
      method: apiUsage.method,
      walletCount: apiUsage.walletCount,
      responseStatus: apiUsage.responseStatus,
      latencyMs: apiUsage.latencyMs,
      creditsUsed: apiUsage.creditsUsed,
      createdAt: apiUsage.createdAt,
    })
    .from(apiUsage)
    .where(eq(apiUsage.apiKeyId, apiKeyId))
    .orderBy(desc(apiUsage.createdAt))
    .limit(limit);
}

/**
 * Gets total credits used for billing period
 */
export async function getBillingCredits(
  apiKeyId: string,
  startDate: Date,
  endDate: Date
): Promise<number> {
  const db = getDb();
  if (!db) return 0;

  const [result] = await db
    .select({
      total: sql<number>`COALESCE(SUM(${apiUsage.creditsUsed}), 0)::int`,
    })
    .from(apiUsage)
    .where(
      and(
        eq(apiUsage.apiKeyId, apiKeyId),
        gte(apiUsage.createdAt, startDate),
        sql`${apiUsage.createdAt} < ${endDate}`
      )
    );

  return result?.total ?? 0;
}

/**
 * Gets usage aggregated by user (for admin analytics)
 */
export async function getUsageByUser(
  period: 'day' | 'week' | 'month' = 'month'
): Promise<Array<{
  apiKeyId: string;
  totalRequests: number;
  totalCredits: number;
  avgLatencyMs: number;
}>> {
  const db = getDb();
  if (!db) return [];

  const periodStart = new Date();
  switch (period) {
    case 'day':
      periodStart.setDate(periodStart.getDate() - 1);
      break;
    case 'week':
      periodStart.setDate(periodStart.getDate() - 7);
      break;
    case 'month':
      periodStart.setMonth(periodStart.getMonth() - 1);
      break;
  }

  return db
    .select({
      apiKeyId: apiUsage.apiKeyId,
      totalRequests: sql<number>`COUNT(*)::int`,
      totalCredits: sql<number>`COALESCE(SUM(${apiUsage.creditsUsed}), 0)::int`,
      avgLatencyMs: sql<number>`COALESCE(AVG(${apiUsage.latencyMs}), 0)::int`,
    })
    .from(apiUsage)
    .where(gte(apiUsage.createdAt, periodStart))
    .groupBy(apiUsage.apiKeyId)
    .orderBy(desc(sql`SUM(${apiUsage.creditsUsed})`));
}
