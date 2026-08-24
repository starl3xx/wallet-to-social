import { NextRequest, NextResponse } from 'next/server';
import { getDb, socialGraph, lookupJobs, analyticsEvents } from '@/db';
import { sql, gte, eq, and, count, isNotNull } from 'drizzle-orm';
import { requireAdmin } from '@/lib/admin-auth';

export const runtime = 'nodejs';

export interface SocialGraphHealthMetrics {
  /** Persisted negatives: wallets checked with no socials found */
  negativeRecordCount: number;
  // Overall statistics
  totalRecords: number;
  recordsWithTwitter: number;
  recordsWithFarcaster: number;

  // Quality distribution
  qualityDistribution: {
    high: number; // dataQualityScore >= 70
    medium: number; // 40-69 or has verified flags
    low: number; // < 40
  };

  // Staleness
  staleRecordCount: number;
  freshRecordCount: number;

  // Verified data
  verifiedTwitterCount: number;
  verifiedFarcasterCount: number;

  // Hit rate (from analytics events - last 24h)
  hitRate24h: {
    hits: number;
    misses: number;
    rate: number;
  };

  // Write success rate (from jobs - last 24h)
  writeSuccessRate24h: {
    success: number;
    partial: number;
    failed: number;
    rate: number;
  };

  // Source distribution
  sourceDistribution: Record<string, number>;
}

export async function GET(request: NextRequest) {
  const authError = requireAdmin(request);
  if (authError) return authError;

  const db = getDb();
  if (!db) {
    return NextResponse.json(
      { error: 'Database not configured' },
      { status: 500 }
    );
  }

  try {
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Overall statistics - use COUNT aggregates for efficiency.
    // Quality/staleness metrics are scoped to positive rows — persisted
    // negatives (checked, no socials found) are healthy rows doing their job,
    // not low-quality or stale data, so they get their own counter instead of
    // dragging every health metric down as they accumulate.
    const hasSocials = sql`(${socialGraph.twitterHandle} IS NOT NULL OR ${socialGraph.farcaster} IS NOT NULL OR ${socialGraph.ensName} IS NOT NULL OR ${socialGraph.lens} IS NOT NULL OR ${socialGraph.github} IS NOT NULL)`;
    const overallStats = await db
      .select({
        totalRecords: sql<number>`COUNT(*) FILTER (WHERE ${hasSocials})::int`,
        negativeRecordCount: sql<number>`COUNT(*) FILTER (WHERE NOT ${hasSocials})::int`,
        recordsWithTwitter: sql<number>`COUNT(*) FILTER (WHERE ${socialGraph.twitterHandle} IS NOT NULL)::int`,
        recordsWithFarcaster: sql<number>`COUNT(*) FILTER (WHERE ${socialGraph.farcaster} IS NOT NULL)::int`,
        verifiedTwitterCount: sql<number>`COUNT(*) FILTER (WHERE ${socialGraph.twitterVerified} = true)::int`,
        verifiedFarcasterCount: sql<number>`COUNT(*) FILTER (WHERE ${socialGraph.farcasterVerified} = true)::int`,
        highQualityCount: sql<number>`COUNT(*) FILTER (WHERE ${hasSocials} AND COALESCE(${socialGraph.dataQualityScore}, 0) >= 70)::int`,
        mediumQualityCount: sql<number>`COUNT(*) FILTER (WHERE ${hasSocials} AND COALESCE(${socialGraph.dataQualityScore}, 0) >= 40 AND COALESCE(${socialGraph.dataQualityScore}, 0) < 70)::int`,
        lowQualityCount: sql<number>`COUNT(*) FILTER (WHERE ${hasSocials} AND COALESCE(${socialGraph.dataQualityScore}, 0) < 40)::int`,
        staleRecordCount: sql<number>`COUNT(*) FILTER (WHERE ${hasSocials} AND ${socialGraph.staleAt} < ${now})::int`,
        freshRecordCount: sql<number>`COUNT(*) FILTER (WHERE ${hasSocials} AND (${socialGraph.staleAt} >= ${now} OR ${socialGraph.staleAt} IS NULL))::int`,
      })
      .from(socialGraph);

    const stats = overallStats[0];

    // Hit rate from analytics events (last 24h)
    const hitEvents = await db
      .select({ count: count() })
      .from(analyticsEvents)
      .where(
        and(
          eq(analyticsEvents.eventType, 'social_graph_hit'),
          gte(analyticsEvents.createdAt, twentyFourHoursAgo)
        )
      );

    const missEvents = await db
      .select({ count: count() })
      .from(analyticsEvents)
      .where(
        and(
          eq(analyticsEvents.eventType, 'social_graph_miss'),
          gte(analyticsEvents.createdAt, twentyFourHoursAgo)
        )
      );

    const hits = hitEvents[0]?.count ?? 0;
    const misses = missEvents[0]?.count ?? 0;
    const totalLookups = hits + misses;
    const hitRate =
      totalLookups > 0 ? Math.round((hits / totalLookups) * 100) : 0;

    // Write success rate from jobs (last 24h)
    const writeStatusCounts = await db
      .select({
        status: lookupJobs.socialGraphWriteStatus,
        count: count(),
      })
      .from(lookupJobs)
      .where(
        and(
          gte(lookupJobs.completedAt, twentyFourHoursAgo),
          isNotNull(lookupJobs.socialGraphWriteStatus)
        )
      )
      .groupBy(lookupJobs.socialGraphWriteStatus);

    const writeStats = {
      success: 0,
      partial: 0,
      failed: 0,
    };

    for (const row of writeStatusCounts) {
      if (row.status === 'success') writeStats.success = row.count;
      else if (row.status === 'partial') writeStats.partial = row.count;
      else if (row.status === 'failed') writeStats.failed = row.count;
    }

    const totalWrites =
      writeStats.success + writeStats.partial + writeStats.failed;
    const writeSuccessRate =
      totalWrites > 0
        ? Math.round((writeStats.success / totalWrites) * 100)
        : 100;

    // Source distribution - get counts by source
    // This is a bit expensive but provides valuable insight
    const sourceRows = await db
      .select({
        sources: socialGraph.sources,
      })
      .from(socialGraph)
      // Positive rows only — negatives carry sources ['none'] and would both
      // pollute the distribution and dilute the sample
      .where(and(isNotNull(socialGraph.sources), sql`${hasSocials}`))
      .limit(10000); // Sample for performance

    const sourceDistribution: Record<string, number> = {};
    for (const row of sourceRows) {
      if (row.sources) {
        for (const source of row.sources) {
          sourceDistribution[source] = (sourceDistribution[source] || 0) + 1;
        }
      }
    }

    const metrics: SocialGraphHealthMetrics = {
      totalRecords: stats?.totalRecords ?? 0,
      negativeRecordCount: stats?.negativeRecordCount ?? 0,
      recordsWithTwitter: stats?.recordsWithTwitter ?? 0,
      recordsWithFarcaster: stats?.recordsWithFarcaster ?? 0,

      qualityDistribution: {
        high: stats?.highQualityCount ?? 0,
        medium: stats?.mediumQualityCount ?? 0,
        low: stats?.lowQualityCount ?? 0,
      },

      staleRecordCount: stats?.staleRecordCount ?? 0,
      freshRecordCount: stats?.freshRecordCount ?? 0,

      verifiedTwitterCount: stats?.verifiedTwitterCount ?? 0,
      verifiedFarcasterCount: stats?.verifiedFarcasterCount ?? 0,

      hitRate24h: {
        hits,
        misses,
        rate: hitRate,
      },

      writeSuccessRate24h: {
        ...writeStats,
        rate: writeSuccessRate,
      },

      sourceDistribution,
    };

    return NextResponse.json(metrics);
  } catch (error) {
    console.error('Social graph analytics error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch social graph analytics' },
      { status: 500 }
    );
  }
}
