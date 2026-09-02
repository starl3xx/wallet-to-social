/**
 * The coverage numbers behind `GET /v1/stats` and the MCP coverage tool,
 * served from a materialized row instead of a live count.
 *
 * ## Why materialized
 *
 * The live version aggregated the whole social_graph (millions of rows) on
 * every call, on an endpoint documented as free. The tool description had to
 * warn agents it was "slow enough not to poll", which turned the one free
 * planning signal into one an agent could not actually use (tier B, item 12
 * of docs/AGENT-SYSTEM.md). The index moves by thousands of rows a day, so a
 * day-old count is as good as a live one for the question the endpoint
 * answers; what matters is saying when it was taken, which is what `as_of`
 * carries.
 *
 * ## Where it lives
 *
 * One `ingest_state` row, the same jsonb name/value store every sweep
 * checkpoint and budget counter already uses; `updated_at` on the row is the
 * as-of moment. Refreshed by the daily `/api/cron/refresh-coverage` cron, and
 * self-priming: a read that finds no row computes and stores one, so a fresh
 * database never answers empty.
 */
import { eq, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { ingestState, socialGraph } from '@/db/schema';

export const COVERAGE_STATE_KEY = 'v1_stats_coverage';

export interface CoverageStats {
  total_wallets: number;
  wallets_checked: number;
  coverage: {
    twitter: number;
    farcaster: number;
    ens: number;
    lens: number;
    github: number;
  };
  farcaster_stats: {
    avg_followers: number;
    max_followers: number;
  };
}

export interface MaterializedCoverage {
  stats: CoverageStats;
  /** When the counts were computed, not when they were served. */
  asOf: Date;
}

type Db = NonNullable<ReturnType<typeof getDb>>;

/** The live count. One aggregate pass over the whole index; cron-priced. */
async function computeCoverageStats(db: Db): Promise<CoverageStats> {
  const [stats] = await db
    .select({
      // Positive rows only — persisted negatives ("checked, no socials") would
      // otherwise inflate the denominator customers compute coverage against
      totalWallets: sql<number>`COUNT(*) FILTER (WHERE ${socialGraph.twitterHandle} IS NOT NULL OR ${socialGraph.farcaster} IS NOT NULL OR ${socialGraph.ensName} IS NOT NULL OR ${socialGraph.lens} IS NOT NULL OR ${socialGraph.github} IS NOT NULL)::int`,
      walletsChecked: sql<number>`COUNT(*)::int`,
      withTwitter: sql<number>`COUNT(*) FILTER (WHERE ${socialGraph.twitterHandle} IS NOT NULL)::int`,
      withFarcaster: sql<number>`COUNT(*) FILTER (WHERE ${socialGraph.farcaster} IS NOT NULL)::int`,
      withEns: sql<number>`COUNT(*) FILTER (WHERE ${socialGraph.ensName} IS NOT NULL)::int`,
      withLens: sql<number>`COUNT(*) FILTER (WHERE ${socialGraph.lens} IS NOT NULL)::int`,
      withGithub: sql<number>`COUNT(*) FILTER (WHERE ${socialGraph.github} IS NOT NULL)::int`,
      avgFcFollowers: sql<number>`COALESCE(AVG(${socialGraph.fcFollowers}) FILTER (WHERE ${socialGraph.fcFollowers} IS NOT NULL), 0)::int`,
      maxFcFollowers: sql<number>`COALESCE(MAX(${socialGraph.fcFollowers}), 0)::int`,
    })
    .from(socialGraph);

  return {
    total_wallets: stats?.totalWallets ?? 0,
    wallets_checked: stats?.walletsChecked ?? 0,
    coverage: {
      twitter: stats?.withTwitter ?? 0,
      farcaster: stats?.withFarcaster ?? 0,
      ens: stats?.withEns ?? 0,
      lens: stats?.withLens ?? 0,
      github: stats?.withGithub ?? 0,
    },
    farcaster_stats: {
      avg_followers: stats?.avgFcFollowers ?? 0,
      max_followers: stats?.maxFcFollowers ?? 0,
    },
  };
}

/** Recompute and store. Called by the daily cron, and on a cold first read. */
export async function refreshCoverageStats(): Promise<MaterializedCoverage | null> {
  const db = getDb();
  if (!db) return null;

  const stats = await computeCoverageStats(db);
  const asOf = new Date();
  await db
    .insert(ingestState)
    .values({ name: COVERAGE_STATE_KEY, value: stats, updatedAt: asOf })
    .onConflictDoUpdate({
      target: ingestState.name,
      set: { value: stats, updatedAt: asOf },
    });
  return { stats, asOf };
}

/** The materialized counts, however old; `asOf` says how old. */
export async function readCoverageStats(): Promise<MaterializedCoverage | null> {
  const db = getDb();
  if (!db) return null;

  const [row] = await db
    .select({ value: ingestState.value, updatedAt: ingestState.updatedAt })
    .from(ingestState)
    .where(eq(ingestState.name, COVERAGE_STATE_KEY))
    .limit(1);

  if (row) {
    return { stats: row.value as CoverageStats, asOf: row.updatedAt };
  }
  // Cold start: no row yet (first deploy, or a scratch database). Compute
  // once and store, so the miss pays the cost instead of every call forever.
  return refreshCoverageStats();
}
