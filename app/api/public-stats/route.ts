import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { socialGraph } from '@/db/schema';

export const runtime = 'nodejs';

// Public, keyless stats for marketing surfaces (homepage stat strip).
// Cached and revalidated hourly so the daily-refreshed index numbers stay
// live without hitting the database on every page view.
export const revalidate = 3600;

export async function GET() {
  const db = getDb();
  if (!db) {
    return NextResponse.json(
      { error: 'Service temporarily unavailable' },
      { status: 503 }
    );
  }

  try {
    const [stats] = await db
      .select({
        // Rows with at least one linked identity — persisted negatives
        // ("checked, no socials") are excluded, matching /api/v1/stats
        totalWallets: sql<number>`COUNT(*) FILTER (WHERE ${socialGraph.twitterHandle} IS NOT NULL OR ${socialGraph.farcaster} IS NOT NULL OR ${socialGraph.ensName} IS NOT NULL OR ${socialGraph.lens} IS NOT NULL OR ${socialGraph.github} IS NOT NULL)::int`,
        withFarcaster: sql<number>`COUNT(*) FILTER (WHERE ${socialGraph.farcaster} IS NOT NULL)::int`,
        withTwitter: sql<number>`COUNT(*) FILTER (WHERE ${socialGraph.twitterHandle} IS NOT NULL)::int`,
        agents: sql<number>`COUNT(*) FILTER (WHERE ${socialGraph.isAgent} = true)::int`,
      })
      .from(socialGraph);

    return NextResponse.json({
      total_wallets: stats?.totalWallets ?? 0,
      farcaster: stats?.withFarcaster ?? 0,
      twitter: stats?.withTwitter ?? 0,
      agents: stats?.agents ?? 0,
    });
  } catch (error) {
    console.error('public-stats query failed:', error);
    return NextResponse.json(
      { error: 'Service temporarily unavailable' },
      { status: 503 }
    );
  }
}
