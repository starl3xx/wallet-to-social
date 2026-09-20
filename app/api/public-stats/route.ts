import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { socialGraph } from '@/db/schema';
import {
  INDEXED_WALLETS,
  FARCASTER_WALLETS,
  WALLETS_WITH_X,
  AGENT_WALLETS_FLAGGED,
} from '@/lib/public-figures';

export const runtime = 'nodejs';

// Public, keyless stats for marketing surfaces (homepage stat strip).
// Cached and revalidated hourly so the daily-refreshed index numbers stay
// live without hitting the database on every page view.
export const revalidate = 3600;

/**
 * A published display figure back into the number it rounds.
 *
 * '4.8M' and '4.7 million' become 4,800,000 and 4,700,000; '13,622' stays
 * 13,622. Derived from `lib/public-figures.ts` rather than typed here, so the
 * frozen preview answer below cannot drift from the one authority for these
 * figures (physics rule 1, docs/AGENT-SYSTEM.md).
 */
const figure = (s: string) =>
  Math.round(
    parseFloat(s.replace(/,/g, '')) * (/million|M$/.test(s) ? 1_000_000 : 1)
  );

export async function GET() {
  /**
   * Preview deployments serve the published constants and never touch Neon.
   *
   * This route is prerendered at build time, so on Vercel it used to run its
   * aggregate against the live database during every preview build; two
   * concurrent branch pushes starved each other under the 60s static
   * generation cap (docs/CI.md, the Vercel row). The guard is the exact
   * equality on purpose: in production the variable holds 'production' and
   * the live path below runs unchanged, and locally it is unset, so
   * `npm run build` keeps exercising the real query. Asserted, with the
   * mutations that would loosen it, in `scripts/check-invariants.ts`.
   */
  if (process.env.VERCEL_ENV === 'preview') {
    return NextResponse.json({
      total_wallets: figure(INDEXED_WALLETS),
      farcaster: figure(FARCASTER_WALLETS),
      twitter: figure(WALLETS_WITH_X),
      // The same fact the live branch below returns (social_graph.is_agent),
      // not the detector's catalog. These disagreed 56-fold under one key.
      agents: figure(AGENT_WALLETS_FLAGGED),
      new_wallets_7d: null,
    });
  }

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
        // First additions, not refreshes or newly enriched older records.
        newWallets7d: sql<number>`COUNT(*) FILTER (WHERE ${socialGraph.firstSeenAt} >= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '7 days' AND ${socialGraph.firstSeenAt} <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AND (${socialGraph.twitterHandle} IS NOT NULL OR ${socialGraph.farcaster} IS NOT NULL OR ${socialGraph.ensName} IS NOT NULL OR ${socialGraph.lens} IS NOT NULL OR ${socialGraph.github} IS NOT NULL))::int`,
      })
      .from(socialGraph);

    return NextResponse.json({
      total_wallets: stats?.totalWallets ?? 0,
      farcaster: stats?.withFarcaster ?? 0,
      twitter: stats?.withTwitter ?? 0,
      agents: stats?.agents ?? 0,
      new_wallets_7d: stats?.newWallets7d ?? null,
    });
  } catch (error) {
    console.error('public-stats query failed:', error);
    return NextResponse.json(
      { error: 'Service temporarily unavailable' },
      { status: 503 }
    );
  }
}
