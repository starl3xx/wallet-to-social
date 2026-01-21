import { getDb } from '@/db';
import { lookupJobs } from '@/db/schema';
import { sql, eq, and, gte, lte, desc } from 'drizzle-orm';

export type TimePeriod = 'today' | 'week' | 'month';

export interface TimeRange {
  start: Date;
  end: Date;
  previousStart: Date;
  previousEnd: Date;
}

export interface UsageMetrics {
  totalLookups: number;
  totalWallets: number;
  avgMatchRate: number;
  avgProcessingTime: number;
  // Comparison to previous period
  lookupsChange: number;
  walletsChange: number;
  matchRateChange: number;
  processingTimeChange: number;
}

export interface MatchAnalytics {
  twitterRate: number;
  farcasterRate: number;
  anyRate: number;
  trendData: {
    date: string;
    twitterRate: number;
    farcasterRate: number;
    anyRate: number;
  }[];
}

export interface PerformanceMetrics {
  pendingJobs: number;
  runningJobs: number;
  successRate: number;
  failedCount: number;
  stageDistribution: {
    stage: string;
    percentage: number;
  }[];
}

export interface RecentActivity {
  id: string;
  walletCount: number;
  twitterFound: number;
  farcasterFound: number;
  matchRate: number;
  completedAt: string;
}

export interface DashboardData {
  usage: UsageMetrics;
  match: MatchAnalytics;
  performance: PerformanceMetrics;
  recentActivity: RecentActivity[];
}

/**
 * Get time range bounds for a given period
 */
export function getTimeRangeBounds(period: TimePeriod): TimeRange {
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  let start: Date;
  let previousStart: Date;
  let previousEnd: Date;

  switch (period) {
    case 'today':
      start = new Date(now);
      start.setHours(0, 0, 0, 0);
      previousEnd = new Date(start);
      previousEnd.setMilliseconds(-1);
      previousStart = new Date(previousEnd);
      previousStart.setHours(0, 0, 0, 0);
      break;
    case 'week':
      start = new Date(now);
      start.setDate(start.getDate() - 7);
      start.setHours(0, 0, 0, 0);
      previousEnd = new Date(start);
      previousEnd.setMilliseconds(-1);
      previousStart = new Date(previousEnd);
      previousStart.setDate(previousStart.getDate() - 7);
      previousStart.setHours(0, 0, 0, 0);
      break;
    case 'month':
      start = new Date(now);
      start.setDate(start.getDate() - 30);
      start.setHours(0, 0, 0, 0);
      previousEnd = new Date(start);
      previousEnd.setMilliseconds(-1);
      previousStart = new Date(previousEnd);
      previousStart.setDate(previousStart.getDate() - 30);
      previousStart.setHours(0, 0, 0, 0);
      break;
  }

  return { start, end, previousStart, previousEnd };
}

/**
 * Get usage metrics for a time period
 */
export async function getUsageMetrics(period: TimePeriod): Promise<UsageMetrics> {
  const db = getDb();
  if (!db) {
    return {
      totalLookups: 0,
      totalWallets: 0,
      avgMatchRate: 0,
      avgProcessingTime: 0,
      lookupsChange: 0,
      walletsChange: 0,
      matchRateChange: 0,
      processingTimeChange: 0,
    };
  }

  const { start, end, previousStart, previousEnd } = getTimeRangeBounds(period);

  // Current period metrics
  const [current] = await db
    .select({
      totalLookups: sql<number>`COUNT(*)::int`,
      totalWallets: sql<number>`COALESCE(SUM(jsonb_array_length(${lookupJobs.wallets})), 0)::int`,
      avgMatchRate: sql<number>`COALESCE(
        AVG(
          CASE WHEN jsonb_array_length(${lookupJobs.wallets}) > 0
          THEN (${lookupJobs.anySocialFound}::float / jsonb_array_length(${lookupJobs.wallets})) * 100
          ELSE 0 END
        ), 0
      )::float`,
      avgProcessingTime: sql<number>`COALESCE(
        AVG(
          EXTRACT(EPOCH FROM (${lookupJobs.completedAt} - ${lookupJobs.startedAt}))
        ), 0
      )::float`,
    })
    .from(lookupJobs)
    .where(
      and(
        eq(lookupJobs.status, 'completed'),
        gte(lookupJobs.completedAt, start),
        lte(lookupJobs.completedAt, end)
      )
    );

  // Previous period metrics for comparison
  const [previous] = await db
    .select({
      totalLookups: sql<number>`COUNT(*)::int`,
      totalWallets: sql<number>`COALESCE(SUM(jsonb_array_length(${lookupJobs.wallets})), 0)::int`,
      avgMatchRate: sql<number>`COALESCE(
        AVG(
          CASE WHEN jsonb_array_length(${lookupJobs.wallets}) > 0
          THEN (${lookupJobs.anySocialFound}::float / jsonb_array_length(${lookupJobs.wallets})) * 100
          ELSE 0 END
        ), 0
      )::float`,
      avgProcessingTime: sql<number>`COALESCE(
        AVG(
          EXTRACT(EPOCH FROM (${lookupJobs.completedAt} - ${lookupJobs.startedAt}))
        ), 0
      )::float`,
    })
    .from(lookupJobs)
    .where(
      and(
        eq(lookupJobs.status, 'completed'),
        gte(lookupJobs.completedAt, previousStart),
        lte(lookupJobs.completedAt, previousEnd)
      )
    );

  // Calculate percentage changes
  const calcChange = (curr: number, prev: number) => {
    if (prev === 0) return curr > 0 ? 100 : 0;
    return ((curr - prev) / prev) * 100;
  };

  return {
    totalLookups: current.totalLookups,
    totalWallets: current.totalWallets,
    avgMatchRate: current.avgMatchRate,
    avgProcessingTime: current.avgProcessingTime,
    lookupsChange: calcChange(current.totalLookups, previous.totalLookups),
    walletsChange: calcChange(current.totalWallets, previous.totalWallets),
    matchRateChange: current.avgMatchRate - previous.avgMatchRate,
    processingTimeChange: current.avgProcessingTime - previous.avgProcessingTime,
  };
}

/**
 * Get match analytics with platform breakdown and trend data
 */
export async function getMatchAnalytics(period: TimePeriod): Promise<MatchAnalytics> {
  const db = getDb();
  if (!db) {
    return {
      twitterRate: 0,
      farcasterRate: 0,
      anyRate: 0,
      trendData: [],
    };
  }

  const { start, end } = getTimeRangeBounds(period);

  // Aggregate platform match rates
  const [rates] = await db
    .select({
      totalWallets: sql<number>`COALESCE(SUM(jsonb_array_length(${lookupJobs.wallets})), 1)::int`,
      twitterFound: sql<number>`COALESCE(SUM(${lookupJobs.twitterFound}), 0)::int`,
      farcasterFound: sql<number>`COALESCE(SUM(${lookupJobs.farcasterFound}), 0)::int`,
      anySocialFound: sql<number>`COALESCE(SUM(${lookupJobs.anySocialFound}), 0)::int`,
    })
    .from(lookupJobs)
    .where(
      and(
        eq(lookupJobs.status, 'completed'),
        gte(lookupJobs.completedAt, start),
        lte(lookupJobs.completedAt, end)
      )
    );

  const totalWallets = rates.totalWallets || 1;
  const twitterRate = (rates.twitterFound / totalWallets) * 100;
  const farcasterRate = (rates.farcasterFound / totalWallets) * 100;
  const anyRate = (rates.anySocialFound / totalWallets) * 100;

  // 7-day trend data
  const trendStart = new Date();
  trendStart.setDate(trendStart.getDate() - 7);
  trendStart.setHours(0, 0, 0, 0);

  const trendRows = await db
    .select({
      date: sql<string>`DATE(${lookupJobs.completedAt})::text`,
      totalWallets: sql<number>`SUM(jsonb_array_length(${lookupJobs.wallets}))::int`,
      twitterFound: sql<number>`SUM(${lookupJobs.twitterFound})::int`,
      farcasterFound: sql<number>`SUM(${lookupJobs.farcasterFound})::int`,
      anySocialFound: sql<number>`SUM(${lookupJobs.anySocialFound})::int`,
    })
    .from(lookupJobs)
    .where(
      and(
        eq(lookupJobs.status, 'completed'),
        gte(lookupJobs.completedAt, trendStart)
      )
    )
    .groupBy(sql`DATE(${lookupJobs.completedAt})`)
    .orderBy(sql`DATE(${lookupJobs.completedAt})`);

  const trendData = trendRows.map((row) => ({
    date: row.date,
    twitterRate: row.totalWallets ? (row.twitterFound / row.totalWallets) * 100 : 0,
    farcasterRate: row.totalWallets ? (row.farcasterFound / row.totalWallets) * 100 : 0,
    anyRate: row.totalWallets ? (row.anySocialFound / row.totalWallets) * 100 : 0,
  }));

  return {
    twitterRate,
    farcasterRate,
    anyRate,
    trendData,
  };
}

/**
 * Get performance metrics including queue status and success rates
 */
export async function getPerformanceMetrics(period: TimePeriod): Promise<PerformanceMetrics> {
  const db = getDb();
  if (!db) {
    return {
      pendingJobs: 0,
      runningJobs: 0,
      successRate: 100,
      failedCount: 0,
      stageDistribution: [],
    };
  }

  const { start, end } = getTimeRangeBounds(period);

  // Queue status (pending and processing jobs)
  const queueRows = await db
    .select({
      status: lookupJobs.status,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(lookupJobs)
    .where(sql`${lookupJobs.status} IN ('pending', 'processing')`)
    .groupBy(lookupJobs.status);

  const pendingJobs = queueRows.find((r) => r.status === 'pending')?.count || 0;
  const runningJobs = queueRows.find((r) => r.status === 'processing')?.count || 0;

  // Success/failure stats for period
  const [statusCounts] = await db
    .select({
      completed: sql<number>`COUNT(*) FILTER (WHERE ${lookupJobs.status} = 'completed')::int`,
      failed: sql<number>`COUNT(*) FILTER (WHERE ${lookupJobs.status} = 'failed')::int`,
    })
    .from(lookupJobs)
    .where(
      and(
        gte(lookupJobs.createdAt, start),
        lte(lookupJobs.createdAt, end)
      )
    );

  const total = statusCounts.completed + statusCounts.failed;
  const successRate = total > 0 ? (statusCounts.completed / total) * 100 : 100;

  // Stage distribution (what stage jobs completed at - shows cache efficiency)
  const stageRows = await db
    .select({
      stage: lookupJobs.currentStage,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(lookupJobs)
    .where(
      and(
        eq(lookupJobs.status, 'completed'),
        gte(lookupJobs.completedAt, start),
        lte(lookupJobs.completedAt, end)
      )
    )
    .groupBy(lookupJobs.currentStage);

  const totalStageJobs = stageRows.reduce((acc, r) => acc + r.count, 0) || 1;
  const stageDistribution = stageRows
    .filter((r) => r.stage) // Remove null stages
    .map((r) => ({
      stage: r.stage || 'unknown',
      percentage: (r.count / totalStageJobs) * 100,
    }))
    .sort((a, b) => b.percentage - a.percentage);

  return {
    pendingJobs,
    runningJobs,
    successRate,
    failedCount: statusCounts.failed,
    stageDistribution,
  };
}

/**
 * Get recent completed jobs for the activity feed
 */
export async function getRecentActivity(limit: number = 5): Promise<RecentActivity[]> {
  const db = getDb();
  if (!db) {
    return [];
  }

  const rows = await db
    .select({
      id: lookupJobs.id,
      walletCount: sql<number>`jsonb_array_length(${lookupJobs.wallets})::int`,
      twitterFound: lookupJobs.twitterFound,
      farcasterFound: lookupJobs.farcasterFound,
      anySocialFound: lookupJobs.anySocialFound,
      completedAt: lookupJobs.completedAt,
    })
    .from(lookupJobs)
    .where(eq(lookupJobs.status, 'completed'))
    .orderBy(desc(lookupJobs.completedAt))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    walletCount: row.walletCount,
    twitterFound: row.twitterFound,
    farcasterFound: row.farcasterFound,
    matchRate: row.walletCount > 0 ? (row.anySocialFound / row.walletCount) * 100 : 0,
    completedAt: row.completedAt?.toISOString() || '',
  }));
}

/**
 * Get all dashboard data in a single call
 */
export async function getDashboardData(period: TimePeriod): Promise<DashboardData> {
  const [usage, match, performance, recentActivity] = await Promise.all([
    getUsageMetrics(period),
    getMatchAnalytics(period),
    getPerformanceMetrics(period),
    getRecentActivity(5),
  ]);

  return {
    usage,
    match,
    performance,
    recentActivity,
  };
}
