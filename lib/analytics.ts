import {
  getDb,
  analyticsEvents,
  apiMetrics,
  dailyStats,
  lookupJobs,
  users,
  type NewAnalyticsEvent,
  type NewApiMetric,
} from '@/db';
import { sql, eq, and, gte, lte, desc, count, avg } from 'drizzle-orm';

// Event types for tracking user behavior
export type AnalyticsEventType =
  | 'page_view'
  | 'csv_upload'
  | 'lookup_started'
  | 'lookup_completed'
  | 'export_clicked'
  | 'history_saved'
  | 'upgrade_modal_viewed'
  | 'checkout_started'
  | 'payment_completed'
  | 'limit_hit'
  | 'user_registered'
  | 'contract_import_blocked'
  | 'contract_import_success'
  // Social graph tracking events (Phase 3)
  | 'social_graph_hit'        // Served from high-quality graph data, skipped API
  | 'social_graph_miss'       // Not in graph or low quality, needed API
  | 'social_graph_stale'      // In graph but needed refresh
  | 'social_graph_write_success'
  | 'social_graph_write_failed';

// API provider names
export type ApiProvider = 'web3bio' | 'neynar' | 'ens';

// Track a user behavior event
export async function trackEvent(
  eventType: AnalyticsEventType,
  options: {
    userId?: string;
    sessionId?: string;
    metadata?: Record<string, unknown>;
  } = {}
): Promise<void> {
  const db = getDb();
  if (!db) return;

  try {
    const event: NewAnalyticsEvent = {
      eventType,
      userId: options.userId ?? null,
      sessionId: options.sessionId ?? null,
      metadata: options.metadata ?? null,
    };

    await db.insert(analyticsEvents).values(event);
  } catch (error) {
    console.error('Analytics event tracking error:', error);
  }
}

// Track API call performance
export async function trackApiCall(
  provider: ApiProvider,
  options: {
    latencyMs: number;
    statusCode?: number;
    errorMessage?: string;
    walletCount?: number;
    jobId?: string;
  }
): Promise<void> {
  const db = getDb();
  if (!db) return;

  try {
    const metric: NewApiMetric = {
      provider,
      latencyMs: options.latencyMs,
      statusCode: options.statusCode ?? null,
      errorMessage: options.errorMessage ?? null,
      walletCount: options.walletCount ?? null,
      jobId: options.jobId ?? null,
    };

    await db.insert(apiMetrics).values(metric);
  } catch (error) {
    console.error('API metrics tracking error:', error);
  }
}

// Get event counts for a specific event type within a date range
export async function getEventCounts(
  eventType: AnalyticsEventType,
  startDate: Date,
  endDate: Date
): Promise<number> {
  const db = getDb();
  if (!db) return 0;

  try {
    const result = await db
      .select({ count: count() })
      .from(analyticsEvents)
      .where(
        and(
          eq(analyticsEvents.eventType, eventType),
          gte(analyticsEvents.createdAt, startDate),
          lte(analyticsEvents.createdAt, endDate)
        )
      );

    return result[0]?.count ?? 0;
  } catch (error) {
    console.error('Event count error:', error);
    return 0;
  }
}

// Get unique user count for a date range
export async function getActiveUsers(startDate: Date, endDate: Date): Promise<number> {
  const db = getDb();
  if (!db) return 0;

  try {
    const result = await db
      .select({ count: sql<number>`COUNT(DISTINCT user_id)` })
      .from(analyticsEvents)
      .where(
        and(
          gte(analyticsEvents.createdAt, startDate),
          lte(analyticsEvents.createdAt, endDate),
          sql`user_id IS NOT NULL`
        )
      );

    return result[0]?.count ?? 0;
  } catch (error) {
    console.error('Active users error:', error);
    return 0;
  }
}

// Get API performance stats for a provider
export async function getApiStats(
  provider: ApiProvider,
  startDate: Date,
  endDate: Date
): Promise<{
  avgLatency: number;
  p99Latency: number;
  errorRate: number;
  totalCalls: number;
}> {
  const db = getDb();
  if (!db) return { avgLatency: 0, p99Latency: 0, errorRate: 0, totalCalls: 0 };

  try {
    const stats = await db
      .select({
        avgLatency: avg(apiMetrics.latencyMs),
        totalCalls: count(),
        errorCount: sql<number>`SUM(CASE WHEN error_message IS NOT NULL THEN 1 ELSE 0 END)`,
      })
      .from(apiMetrics)
      .where(
        and(
          eq(apiMetrics.provider, provider),
          gte(apiMetrics.createdAt, startDate),
          lte(apiMetrics.createdAt, endDate)
        )
      );

    // Get P99 latency separately
    const p99Result = await db
      .select({ latency: apiMetrics.latencyMs })
      .from(apiMetrics)
      .where(
        and(
          eq(apiMetrics.provider, provider),
          gte(apiMetrics.createdAt, startDate),
          lte(apiMetrics.createdAt, endDate),
          sql`latency_ms IS NOT NULL`
        )
      )
      .orderBy(desc(apiMetrics.latencyMs));

    const p99Index = Math.floor(p99Result.length * 0.01);
    const p99Latency = p99Result[p99Index]?.latency ?? 0;

    const totalCalls = stats[0]?.totalCalls ?? 0;
    const errorCount = Number(stats[0]?.errorCount ?? 0);

    return {
      avgLatency: Math.round(Number(stats[0]?.avgLatency ?? 0)),
      p99Latency,
      errorRate: totalCalls > 0 ? (errorCount / totalCalls) * 100 : 0,
      totalCalls,
    };
  } catch (error) {
    console.error('API stats error:', error);
    return { avgLatency: 0, p99Latency: 0, errorRate: 0, totalCalls: 0 };
  }
}

// Aggregate daily stats - run this via cron job
export async function aggregateDailyStats(date: Date): Promise<void> {
  const db = getDb();
  if (!db) return;

  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  const dateStr = startOfDay.toISOString().split('T')[0];

  try {
    // Count lookups (completed jobs)
    const lookupStats = await db
      .select({
        totalLookups: count(),
        totalWallets: sql<number>`COALESCE(SUM(COALESCE(array_length(wallets::text[], 1), 0)), 0)`,
        uniqueUsers: sql<number>`COUNT(DISTINCT user_id)`,
        avgMatchRate: sql<number>`AVG(
          CASE WHEN COALESCE(array_length(wallets::text[], 1), 0) > 0
          THEN (COALESCE(twitter_found, 0) + COALESCE(farcaster_found, 0)) * 100.0 / COALESCE(array_length(wallets::text[], 1), 1)
          ELSE 0 END
        )`,
        cacheHits: sql<number>`COALESCE(SUM(cache_hits), 0)`,
      })
      .from(lookupJobs)
      .where(
        and(
          eq(lookupJobs.status, 'completed'),
          gte(lookupJobs.completedAt, startOfDay),
          lte(lookupJobs.completedAt, endOfDay)
        )
      );

    // Count new users
    const newUserStats = await db
      .select({ count: count() })
      .from(users)
      .where(and(gte(users.createdAt, startOfDay), lte(users.createdAt, endOfDay)));

    // Count purchases
    const purchaseStats = await db
      .select({
        proPurchases: sql<number>`SUM(CASE WHEN tier = 'pro' THEN 1 ELSE 0 END)`,
        unlimitedPurchases: sql<number>`SUM(CASE WHEN tier = 'unlimited' THEN 1 ELSE 0 END)`,
      })
      .from(users)
      .where(and(gte(users.paidAt, startOfDay), lte(users.paidAt, endOfDay)));

    // Calculate revenue (Pro = $149 = 14900 cents, Unlimited = $420 = 42000 cents)
    const proPurchases = Number(purchaseStats[0]?.proPurchases ?? 0);
    const unlimitedPurchases = Number(purchaseStats[0]?.unlimitedPurchases ?? 0);
    const revenueCents = proPurchases * 14900 + unlimitedPurchases * 42000;

    // Get API error count
    const errorStats = await db
      .select({ count: count() })
      .from(apiMetrics)
      .where(
        and(
          gte(apiMetrics.createdAt, startOfDay),
          lte(apiMetrics.createdAt, endOfDay),
          sql`error_message IS NOT NULL`
        )
      );

    // Get average latency
    const latencyStats = await db
      .select({ avgLatency: avg(apiMetrics.latencyMs) })
      .from(apiMetrics)
      .where(and(gte(apiMetrics.createdAt, startOfDay), lte(apiMetrics.createdAt, endOfDay)));

    // Calculate cache hit rate
    const totalWallets = Number(lookupStats[0]?.totalWallets ?? 0);
    const cacheHits = Number(lookupStats[0]?.cacheHits ?? 0);
    const cacheHitRate = totalWallets > 0 ? (cacheHits / totalWallets) * 100 : 0;

    // Upsert daily stats
    await db
      .insert(dailyStats)
      .values({
        date: dateStr,
        totalLookups: lookupStats[0]?.totalLookups ?? 0,
        totalWalletsProcessed: totalWallets,
        uniqueUsers: Number(lookupStats[0]?.uniqueUsers ?? 0),
        newUsers: newUserStats[0]?.count ?? 0,
        revenueCents,
        proPurchases,
        unlimitedPurchases,
        avgMatchRate: String(lookupStats[0]?.avgMatchRate ?? 0),
        cacheHitRate: String(cacheHitRate.toFixed(2)),
        avgLatencyMs: Math.round(Number(latencyStats[0]?.avgLatency ?? 0)),
        errorCount: errorStats[0]?.count ?? 0,
        computedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: dailyStats.date,
        set: {
          totalLookups: sql`EXCLUDED.total_lookups`,
          totalWalletsProcessed: sql`EXCLUDED.total_wallets_processed`,
          uniqueUsers: sql`EXCLUDED.unique_users`,
          newUsers: sql`EXCLUDED.new_users`,
          revenueCents: sql`EXCLUDED.revenue_cents`,
          proPurchases: sql`EXCLUDED.pro_purchases`,
          unlimitedPurchases: sql`EXCLUDED.unlimited_purchases`,
          avgMatchRate: sql`EXCLUDED.avg_match_rate`,
          cacheHitRate: sql`EXCLUDED.cache_hit_rate`,
          avgLatencyMs: sql`EXCLUDED.avg_latency_ms`,
          errorCount: sql`EXCLUDED.error_count`,
          computedAt: sql`EXCLUDED.computed_at`,
        },
      });
  } catch (error) {
    console.error('Daily stats aggregation error:', error);
  }
}

// Get daily stats for a date range (for sparklines)
export async function getDailyStatsRange(
  startDate: Date,
  endDate: Date
): Promise<Array<{
  date: string;
  totalLookups: number;
  totalWalletsProcessed: number;
  uniqueUsers: number;
  newUsers: number;
  revenueCents: number;
  avgMatchRate: number;
  errorCount: number;
}>> {
  const db = getDb();
  if (!db) return [];

  const startStr = startDate.toISOString().split('T')[0];
  const endStr = endDate.toISOString().split('T')[0];

  try {
    const stats = await db
      .select()
      .from(dailyStats)
      .where(and(gte(dailyStats.date, startStr), lte(dailyStats.date, endStr)))
      .orderBy(dailyStats.date);

    return stats.map((s) => ({
      date: s.date,
      totalLookups: s.totalLookups,
      totalWalletsProcessed: s.totalWalletsProcessed,
      uniqueUsers: s.uniqueUsers,
      newUsers: s.newUsers,
      revenueCents: s.revenueCents,
      avgMatchRate: Number(s.avgMatchRate ?? 0),
      errorCount: s.errorCount,
    }));
  } catch (error) {
    console.error('Daily stats range error:', error);
    return [];
  }
}

// Get user funnel metrics
export async function getUserFunnel(
  startDate: Date,
  endDate: Date
): Promise<{
  pageViews: number;
  csvUploads: number;
  lookupsStarted: number;
  lookupsCompleted: number;
  exportsClicked: number;
  historySaved: number;
  upgradeModalViewed: number;
  checkoutStarted: number;
  paymentCompleted: number;
}> {
  const db = getDb();
  if (!db)
    return {
      pageViews: 0,
      csvUploads: 0,
      lookupsStarted: 0,
      lookupsCompleted: 0,
      exportsClicked: 0,
      historySaved: 0,
      upgradeModalViewed: 0,
      checkoutStarted: 0,
      paymentCompleted: 0,
    };

  try {
    const result = await db
      .select({
        eventType: analyticsEvents.eventType,
        count: count(),
      })
      .from(analyticsEvents)
      .where(
        and(gte(analyticsEvents.createdAt, startDate), lte(analyticsEvents.createdAt, endDate))
      )
      .groupBy(analyticsEvents.eventType);

    const counts = new Map(result.map((r) => [r.eventType, r.count]));

    return {
      pageViews: counts.get('page_view') ?? 0,
      csvUploads: counts.get('csv_upload') ?? 0,
      lookupsStarted: counts.get('lookup_started') ?? 0,
      lookupsCompleted: counts.get('lookup_completed') ?? 0,
      exportsClicked: counts.get('export_clicked') ?? 0,
      historySaved: counts.get('history_saved') ?? 0,
      upgradeModalViewed: counts.get('upgrade_modal_viewed') ?? 0,
      checkoutStarted: counts.get('checkout_started') ?? 0,
      paymentCompleted: counts.get('payment_completed') ?? 0,
    };
  } catch (error) {
    console.error('User funnel error:', error);
    return {
      pageViews: 0,
      csvUploads: 0,
      lookupsStarted: 0,
      lookupsCompleted: 0,
      exportsClicked: 0,
      historySaved: 0,
      upgradeModalViewed: 0,
      checkoutStarted: 0,
      paymentCompleted: 0,
    };
  }
}

// Get user behavior cohorts
export async function getUserCohorts(): Promise<
  Array<{
    name: string;
    definition: string;
    count: number;
    avgLookups: number;
    conversionRate: number;
  }>
> {
  const db = getDb();
  if (!db) return [];

  try {
    // Power Users: 5+ lookups with exports
    const powerUsers = await db
      .select({
        userId: analyticsEvents.userId,
        lookupCount: sql<number>`COUNT(CASE WHEN event_type = 'lookup_completed' THEN 1 END)`,
        hasExport: sql<number>`MAX(CASE WHEN event_type = 'export_clicked' THEN 1 ELSE 0 END)`,
        hasPaid: sql<number>`MAX(CASE WHEN event_type = 'payment_completed' THEN 1 ELSE 0 END)`,
      })
      .from(analyticsEvents)
      .where(sql`user_id IS NOT NULL`)
      .groupBy(analyticsEvents.userId);

    let powerUserCount = 0;
    let powerUserLookups = 0;
    let powerUserPaid = 0;
    let tireKickerCount = 0;
    let tireKickerPaid = 0;
    let almostConvertedCount = 0;

    for (const user of powerUsers) {
      const lookups = Number(user.lookupCount);
      const hasExport = Number(user.hasExport) > 0;
      const hasPaid = Number(user.hasPaid) > 0;

      if (lookups >= 5 && hasExport) {
        powerUserCount++;
        powerUserLookups += lookups;
        if (hasPaid) powerUserPaid++;
      } else if (lookups === 1 && !hasExport) {
        tireKickerCount++;
        if (hasPaid) tireKickerPaid++;
      } else if (lookups >= 3 && !hasPaid) {
        almostConvertedCount++;
      }
    }

    // Churned paid users (paid but no activity in 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const churnedResult = await db
      .select({ count: count() })
      .from(users)
      .where(
        and(
          sql`tier != 'free'`,
          sql`NOT EXISTS (
            SELECT 1 FROM analytics_events
            WHERE analytics_events.user_id = users.email
            AND analytics_events.created_at > ${thirtyDaysAgo}
          )`
        )
      );

    return [
      {
        name: 'Power Users',
        definition: '5+ lookups, exports regularly',
        count: powerUserCount,
        avgLookups: powerUserCount > 0 ? powerUserLookups / powerUserCount : 0,
        conversionRate: powerUserCount > 0 ? (powerUserPaid / powerUserCount) * 100 : 0,
      },
      {
        name: 'Tire Kickers',
        definition: '1 lookup, no export',
        count: tireKickerCount,
        avgLookups: 1,
        conversionRate: tireKickerCount > 0 ? (tireKickerPaid / tireKickerCount) * 100 : 0,
      },
      {
        name: 'Almost Converted',
        definition: "3+ lookups, hit limit, didn't pay",
        count: almostConvertedCount,
        avgLookups: 3,
        conversionRate: 0,
      },
      {
        name: 'Churned Paid',
        definition: 'Paid but no activity in 30d',
        count: churnedResult[0]?.count ?? 0,
        avgLookups: 0,
        conversionRate: 100,
      },
    ];
  } catch (error) {
    console.error('User cohorts error:', error);
    return [];
  }
}

// Get retention cohorts (week over week)
export async function getRetentionCohorts(
  weeks: number = 4
): Promise<Array<{ cohortWeek: string; retention: number[] }>> {
  const db = getDb();
  if (!db) return [];

  try {
    const results: Array<{ cohortWeek: string; retention: number[] }> = [];
    const now = new Date();

    for (let w = weeks - 1; w >= 0; w--) {
      const cohortStart = new Date(now);
      cohortStart.setDate(cohortStart.getDate() - (w + 1) * 7);
      cohortStart.setHours(0, 0, 0, 0);

      const cohortEnd = new Date(cohortStart);
      cohortEnd.setDate(cohortEnd.getDate() + 7);

      const cohortWeek = cohortStart.toISOString().split('T')[0];

      // Get users who first appeared in this cohort week
      const cohortUsers = await db
        .select({ userId: analyticsEvents.userId })
        .from(analyticsEvents)
        .where(
          and(
            sql`user_id IS NOT NULL`,
            gte(analyticsEvents.createdAt, cohortStart),
            lte(analyticsEvents.createdAt, cohortEnd)
          )
        )
        .groupBy(analyticsEvents.userId);

      const userIds = cohortUsers.map((u) => u.userId).filter(Boolean);
      if (userIds.length === 0) {
        results.push({ cohortWeek, retention: [100] });
        continue;
      }

      const retention: number[] = [100]; // Week 0 is always 100%

      // Check subsequent weeks
      for (let followUp = 1; followUp <= weeks - w - 1; followUp++) {
        const weekStart = new Date(cohortEnd);
        weekStart.setDate(weekStart.getDate() + (followUp - 1) * 7);

        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 7);

        const activeInWeek = await db
          .select({ count: sql<number>`COUNT(DISTINCT user_id)` })
          .from(analyticsEvents)
          .where(
            and(
              sql`user_id = ANY(${userIds})`,
              gte(analyticsEvents.createdAt, weekStart),
              lte(analyticsEvents.createdAt, weekEnd)
            )
          );

        const retainedCount = Number(activeInWeek[0]?.count ?? 0);
        retention.push(Math.round((retainedCount / userIds.length) * 100));
      }

      results.push({ cohortWeek, retention });
    }

    return results;
  } catch (error) {
    console.error('Retention cohorts error:', error);
    return [];
  }
}

// Get queue depth (pending/processing jobs)
export async function getQueueDepth(): Promise<{
  pending: number;
  processing: number;
}> {
  const db = getDb();
  if (!db) return { pending: 0, processing: 0 };

  try {
    const result = await db
      .select({
        status: lookupJobs.status,
        count: count(),
      })
      .from(lookupJobs)
      .where(sql`status IN ('pending', 'processing')`)
      .groupBy(lookupJobs.status);

    const counts = new Map(result.map((r) => [r.status, r.count]));

    return {
      pending: counts.get('pending') ?? 0,
      processing: counts.get('processing') ?? 0,
    };
  } catch (error) {
    console.error('Queue depth error:', error);
    return { pending: 0, processing: 0 };
  }
}

// Get recent errors for error log
export async function getRecentErrors(
  limit: number = 50
): Promise<
  Array<{
    id: string;
    provider: string;
    errorMessage: string;
    jobId: string | null;
    createdAt: Date;
  }>
> {
  const db = getDb();
  if (!db) return [];

  try {
    const errors = await db
      .select({
        id: apiMetrics.id,
        provider: apiMetrics.provider,
        errorMessage: apiMetrics.errorMessage,
        jobId: apiMetrics.jobId,
        createdAt: apiMetrics.createdAt,
      })
      .from(apiMetrics)
      .where(sql`error_message IS NOT NULL`)
      .orderBy(desc(apiMetrics.createdAt))
      .limit(limit);

    return errors.map((e) => ({
      id: e.id,
      provider: e.provider,
      errorMessage: e.errorMessage ?? '',
      jobId: e.jobId,
      createdAt: e.createdAt,
    }));
  } catch (error) {
    console.error('Recent errors error:', error);
    return [];
  }
}

// Calculate executive pulse metrics
export async function getExecutivePulse(): Promise<{
  lookupsToday: number;
  lookupsTrend: number[];
  activeUsers7d: number;
  activeUsersTrend: 'up' | 'down' | 'flat';
  conversionRate: number;
  revenueMTD: number;
  revenueVsLastMonth: number;
  errorRate: number;
  errorStatus: 'green' | 'yellow' | 'red';
  queueDepth: number;
}> {
  const db = getDb();
  if (!db)
    return {
      lookupsToday: 0,
      lookupsTrend: [],
      activeUsers7d: 0,
      activeUsersTrend: 'flat',
      conversionRate: 0,
      revenueMTD: 0,
      revenueVsLastMonth: 0,
      errorRate: 0,
      errorStatus: 'green',
      queueDepth: 0,
    };

  try {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const fourteenDaysAgo = new Date(now);
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

    // Lookups today
    const todayLookups = await db
      .select({ count: count() })
      .from(lookupJobs)
      .where(and(eq(lookupJobs.status, 'completed'), gte(lookupJobs.completedAt, todayStart)));

    // 7-day trend
    const weeklyStats = await getDailyStatsRange(sevenDaysAgo, now);
    const lookupsTrend = weeklyStats.map((s) => s.totalLookups);

    // Active users (7d)
    const activeUsers7d = await getActiveUsers(sevenDaysAgo, now);
    const activeUsersPrev7d = await getActiveUsers(fourteenDaysAgo, sevenDaysAgo);
    const activeUsersTrend: 'up' | 'down' | 'flat' =
      activeUsers7d > activeUsersPrev7d ? 'up' : activeUsers7d < activeUsersPrev7d ? 'down' : 'flat';

    // Conversion rate (this week)
    const funnel = await getUserFunnel(sevenDaysAgo, now);
    const conversionRate =
      funnel.lookupsStarted > 0 ? (funnel.paymentCompleted / funnel.lookupsStarted) * 100 : 0;

    // Revenue MTD
    const mtdStats = await getDailyStatsRange(monthStart, now);
    const revenueMTD = mtdStats.reduce((sum, s) => sum + s.revenueCents, 0) / 100;

    // Revenue vs last month
    const lastMonthStats = await getDailyStatsRange(lastMonthStart, lastMonthEnd);
    const lastMonthRevenue = lastMonthStats.reduce((sum, s) => sum + s.revenueCents, 0) / 100;
    const revenueVsLastMonth =
      lastMonthRevenue > 0 ? ((revenueMTD - lastMonthRevenue) / lastMonthRevenue) * 100 : 0;

    // Error rate (24h)
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const allApiCalls = await db
      .select({ count: count() })
      .from(apiMetrics)
      .where(gte(apiMetrics.createdAt, twentyFourHoursAgo));

    const errorApiCalls = await db
      .select({ count: count() })
      .from(apiMetrics)
      .where(and(gte(apiMetrics.createdAt, twentyFourHoursAgo), sql`error_message IS NOT NULL`));

    const totalCalls = allApiCalls[0]?.count ?? 0;
    const errorCalls = errorApiCalls[0]?.count ?? 0;
    const errorRate = totalCalls > 0 ? (errorCalls / totalCalls) * 100 : 0;
    const errorStatus: 'green' | 'yellow' | 'red' =
      errorRate < 1 ? 'green' : errorRate < 5 ? 'yellow' : 'red';

    // Queue depth
    const queue = await getQueueDepth();
    const queueDepth = queue.pending + queue.processing;

    return {
      lookupsToday: todayLookups[0]?.count ?? 0,
      lookupsTrend,
      activeUsers7d,
      activeUsersTrend,
      conversionRate: Math.round(conversionRate * 100) / 100,
      revenueMTD,
      revenueVsLastMonth: Math.round(revenueVsLastMonth),
      errorRate: Math.round(errorRate * 100) / 100,
      errorStatus,
      queueDepth,
    };
  } catch (error) {
    console.error('Executive pulse error:', error);
    return {
      lookupsToday: 0,
      lookupsTrend: [],
      activeUsers7d: 0,
      activeUsersTrend: 'flat',
      conversionRate: 0,
      revenueMTD: 0,
      revenueVsLastMonth: 0,
      errorRate: 0,
      errorStatus: 'green',
      queueDepth: 0,
    };
  }
}

// Get feature adoption metrics
export async function getFeatureAdoption(
  startDate: Date,
  endDate: Date
): Promise<{
  ensLookupRate: number;
  historySaveRate: number;
  exportRate: number;
  exportFormats: { csv: number; twitter: number };
  avgLookupSize: { free: number; pro: number; unlimited: number };
}> {
  const db = getDb();
  if (!db)
    return {
      ensLookupRate: 0,
      historySaveRate: 0,
      exportRate: 0,
      exportFormats: { csv: 0, twitter: 0 },
      avgLookupSize: { free: 0, pro: 0, unlimited: 0 },
    };

  try {
    const events = await db
      .select()
      .from(analyticsEvents)
      .where(and(gte(analyticsEvents.createdAt, startDate), lte(analyticsEvents.createdAt, endDate)));

    const totalLookups = events.filter((e) => e.eventType === 'lookup_completed').length;
    const ensLookups = events.filter(
      (e) =>
        e.eventType === 'lookup_completed' &&
        (e.metadata as Record<string, unknown>)?.includeENS === true
    ).length;
    const historySaves = events.filter((e) => e.eventType === 'history_saved').length;
    const exports = events.filter((e) => e.eventType === 'export_clicked');
    const csvExports = exports.filter(
      (e) => (e.metadata as Record<string, unknown>)?.format === 'csv'
    ).length;
    const twitterExports = exports.filter(
      (e) => (e.metadata as Record<string, unknown>)?.format === 'twitter'
    ).length;

    // Calculate average lookup sizes by tier
    const lookupsByTier: Record<string, number[]> = { free: [], pro: [], unlimited: [] };
    for (const event of events) {
      if (event.eventType === 'lookup_started') {
        const metadata = event.metadata as Record<string, unknown>;
        const tier = (metadata?.tier as string) ?? 'free';
        const walletCount = (metadata?.walletCount as number) ?? 0;
        if (lookupsByTier[tier]) {
          lookupsByTier[tier].push(walletCount);
        }
      }
    }

    const avgSize = (arr: number[]) => (arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

    return {
      ensLookupRate: totalLookups > 0 ? (ensLookups / totalLookups) * 100 : 0,
      historySaveRate: totalLookups > 0 ? (historySaves / totalLookups) * 100 : 0,
      exportRate: totalLookups > 0 ? (exports.length / totalLookups) * 100 : 0,
      exportFormats: { csv: csvExports, twitter: twitterExports },
      avgLookupSize: {
        free: Math.round(avgSize(lookupsByTier.free)),
        pro: Math.round(avgSize(lookupsByTier.pro)),
        unlimited: Math.round(avgSize(lookupsByTier.unlimited)),
      },
    };
  } catch (error) {
    console.error('Feature adoption error:', error);
    return {
      ensLookupRate: 0,
      historySaveRate: 0,
      exportRate: 0,
      exportFormats: { csv: 0, twitter: 0 },
      avgLookupSize: { free: 0, pro: 0, unlimited: 0 },
    };
  }
}
