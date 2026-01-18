import {
  getDb,
  socialGraph,
  type SocialGraph,
  type NewSocialGraph,
} from '@/db';
import { inArray, sql } from 'drizzle-orm';
import type { WalletSocialResult } from './types';

/**
 * Check if a result has at least one social account worth storing
 */
function hasAnySocialAccount(result: WalletSocialResult): boolean {
  return !!(
    result.twitter_handle ||
    result.farcaster ||
    result.lens ||
    result.github ||
    result.ens_name
  );
}

/**
 * Merge source arrays, keeping unique values and removing 'cache'
 */
function mergeSources(
  newSources: string[] | undefined,
  existingSources: string[] | null | undefined
): string[] {
  const combined = new Set<string>([
    ...(existingSources ?? []),
    ...(newSources ?? []),
  ]);
  // Remove 'cache' and 'graph' from permanent storage - only track actual API sources
  combined.delete('cache');
  combined.delete('graph');
  return Array.from(combined);
}

/**
 * Upsert wallet results into social_graph with merge logic
 * - Only stores wallets with at least one social account
 * - Merges new data with existing, never overwrites with empty values
 * - Updates follower counts and timestamps
 */
export async function upsertSocialGraph(
  results: WalletSocialResult[]
): Promise<number> {
  const db = getDb();
  if (!db || results.length === 0) return 0;

  // Filter to only results with at least one social account
  const validResults = results.filter(hasAnySocialAccount);
  if (validResults.length === 0) return 0;

  const wallets = validResults.map((r) => r.wallet.toLowerCase());

  try {
    // Fetch existing records for merge
    const existing = await db
      .select()
      .from(socialGraph)
      .where(inArray(socialGraph.wallet, wallets));

    const existingMap = new Map(existing.map((e) => [e.wallet, e]));

    // Prepare upsert rows with merge logic
    const rows: NewSocialGraph[] = validResults.map((r) => {
      const walletLower = r.wallet.toLowerCase();
      const prev = existingMap.get(walletLower);

      return {
        wallet: walletLower,
        ensName: r.ens_name || prev?.ensName || null,
        twitterHandle: r.twitter_handle || prev?.twitterHandle || null,
        twitterUrl: r.twitter_url || prev?.twitterUrl || null,
        farcaster: r.farcaster || prev?.farcaster || null,
        farcasterUrl: r.farcaster_url || prev?.farcasterUrl || null,
        // Always update follower counts if we have new data
        fcFollowers: r.fc_followers ?? prev?.fcFollowers ?? null,
        fcFid: (r as Record<string, unknown>).fc_fid as number | null ?? prev?.fcFid ?? null,
        lens: r.lens || prev?.lens || null,
        github: r.github || prev?.github || null,
        sources: mergeSources(r.source, prev?.sources),
        firstSeenAt: prev?.firstSeenAt ?? new Date(),
        lastUpdatedAt: new Date(),
        lookupCount: (prev?.lookupCount ?? 0) + 1,
      };
    });

    // Upsert in batches of 100
    let upserted = 0;
    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i, i + 100);

      await db
        .insert(socialGraph)
        .values(batch)
        .onConflictDoUpdate({
          target: socialGraph.wallet,
          set: {
            ensName: sql`COALESCE(EXCLUDED.ens_name, ${socialGraph.ensName})`,
            twitterHandle: sql`COALESCE(EXCLUDED.twitter_handle, ${socialGraph.twitterHandle})`,
            twitterUrl: sql`COALESCE(EXCLUDED.twitter_url, ${socialGraph.twitterUrl})`,
            farcaster: sql`COALESCE(EXCLUDED.farcaster, ${socialGraph.farcaster})`,
            farcasterUrl: sql`COALESCE(EXCLUDED.farcaster_url, ${socialGraph.farcasterUrl})`,
            fcFollowers: sql`COALESCE(EXCLUDED.fc_followers, ${socialGraph.fcFollowers})`,
            fcFid: sql`COALESCE(EXCLUDED.fc_fid, ${socialGraph.fcFid})`,
            lens: sql`COALESCE(EXCLUDED.lens, ${socialGraph.lens})`,
            github: sql`COALESCE(EXCLUDED.github, ${socialGraph.github})`,
            sources: sql`EXCLUDED.sources`,
            lastUpdatedAt: sql`EXCLUDED.last_updated_at`,
            lookupCount: sql`${socialGraph.lookupCount} + 1`,
          },
        });

      upserted += batch.length;
    }

    return upserted;
  } catch (error) {
    console.error('Social graph upsert error:', error);
    return 0;
  }
}

/**
 * Get social graph data for wallets (used for enrichment after API calls)
 */
export async function getSocialGraphData(
  wallets: string[]
): Promise<Map<string, SocialGraph>> {
  const db = getDb();
  if (!db || wallets.length === 0) return new Map();

  const lowercaseWallets = wallets.map((w) => w.toLowerCase());

  try {
    const rows = await db
      .select()
      .from(socialGraph)
      .where(inArray(socialGraph.wallet, lowercaseWallets));

    return new Map(rows.map((r) => [r.wallet, r]));
  } catch (error) {
    console.error('Social graph read error:', error);
    return new Map();
  }
}

/**
 * Convert SocialGraph record to partial WalletSocialResult format for merging
 */
export function socialGraphToResult(
  record: SocialGraph
): Partial<WalletSocialResult> {
  return {
    ens_name: record.ensName ?? undefined,
    twitter_handle: record.twitterHandle ?? undefined,
    twitter_url: record.twitterUrl ?? undefined,
    farcaster: record.farcaster ?? undefined,
    farcaster_url: record.farcasterUrl ?? undefined,
    fc_followers: record.fcFollowers ?? undefined,
    lens: record.lens ?? undefined,
    github: record.github ?? undefined,
  };
}

/**
 * Upsert wallet with 'manual' source (admin enrichment)
 * This allows admins to manually add/edit social data for any wallet.
 * The 'manual' source takes precedence and is tracked separately.
 */
export async function upsertManualSocialGraph(
  wallet: string,
  data: { twitterHandle?: string; farcaster?: string; ensName?: string }
): Promise<SocialGraph | null> {
  const db = getDb();
  if (!db) return null;

  const walletLower = wallet.toLowerCase();

  try {
    // Fetch existing record to merge
    const existing = await db
      .select()
      .from(socialGraph)
      .where(sql`${socialGraph.wallet} = ${walletLower}`)
      .limit(1);

    const prev = existing[0];

    // Merge sources, adding 'manual' if not present
    const newSources = mergeSources(['manual'], prev?.sources);

    const row: NewSocialGraph = {
      wallet: walletLower,
      ensName: data.ensName || prev?.ensName || null,
      twitterHandle: data.twitterHandle || prev?.twitterHandle || null,
      twitterUrl: data.twitterHandle ? `https://x.com/${data.twitterHandle}` : prev?.twitterUrl || null,
      farcaster: data.farcaster || prev?.farcaster || null,
      farcasterUrl: data.farcaster ? `https://warpcast.com/${data.farcaster}` : prev?.farcasterUrl || null,
      fcFollowers: prev?.fcFollowers ?? null,
      fcFid: prev?.fcFid ?? null,
      lens: prev?.lens || null,
      github: prev?.github || null,
      sources: newSources,
      firstSeenAt: prev?.firstSeenAt ?? new Date(),
      lastUpdatedAt: new Date(),
      lookupCount: (prev?.lookupCount ?? 0) + 1,
    };

    const [result] = await db
      .insert(socialGraph)
      .values(row)
      .onConflictDoUpdate({
        target: socialGraph.wallet,
        set: {
          ensName: sql`COALESCE(EXCLUDED.ens_name, ${socialGraph.ensName})`,
          twitterHandle: sql`COALESCE(EXCLUDED.twitter_handle, ${socialGraph.twitterHandle})`,
          twitterUrl: sql`COALESCE(EXCLUDED.twitter_url, ${socialGraph.twitterUrl})`,
          farcaster: sql`COALESCE(EXCLUDED.farcaster, ${socialGraph.farcaster})`,
          farcasterUrl: sql`COALESCE(EXCLUDED.farcaster_url, ${socialGraph.farcasterUrl})`,
          sources: sql`EXCLUDED.sources`,
          lastUpdatedAt: sql`EXCLUDED.last_updated_at`,
          lookupCount: sql`${socialGraph.lookupCount} + 1`,
        },
      })
      .returning();

    return result;
  } catch (error) {
    console.error('Manual social graph upsert error:', error);
    return null;
  }
}

/**
 * Find wallets that have been updated/enriched since a given date
 * Used to show "new matches" notifications for users
 */
export async function getEnrichedWalletsSince(
  wallets: string[],
  since: Date
): Promise<string[]> {
  const db = getDb();
  if (!db || wallets.length === 0) return [];

  const lowercaseWallets = wallets.map((w) => w.toLowerCase());

  try {
    const rows = await db
      .select({ wallet: socialGraph.wallet })
      .from(socialGraph)
      .where(
        sql`${socialGraph.wallet} IN ${lowercaseWallets} AND ${socialGraph.lastUpdatedAt} > ${since}`
      );

    return rows.map((r) => r.wallet);
  } catch (error) {
    console.error('Enriched wallets query error:', error);
    return [];
  }
}

/**
 * Get a single wallet from social_graph by address
 */
export async function getSocialGraphWallet(
  wallet: string
): Promise<SocialGraph | null> {
  const db = getDb();
  if (!db) return null;

  try {
    const rows = await db
      .select()
      .from(socialGraph)
      .where(sql`${socialGraph.wallet} = ${wallet.toLowerCase()}`)
      .limit(1);

    return rows[0] || null;
  } catch (error) {
    console.error('Social graph wallet lookup error:', error);
    return null;
  }
}

/**
 * Get recent manual edits from social_graph (for admin UI)
 */
export async function getRecentManualEdits(
  limit = 10
): Promise<SocialGraph[]> {
  const db = getDb();
  if (!db) return [];

  try {
    const rows = await db
      .select()
      .from(socialGraph)
      .where(sql`'manual' = ANY(${socialGraph.sources})`)
      .orderBy(sql`${socialGraph.lastUpdatedAt} DESC`)
      .limit(limit);

    return rows;
  } catch (error) {
    console.error('Recent manual edits query error:', error);
    return [];
  }
}

/**
 * Get stats about the social graph
 * Uses COUNT aggregates instead of loading entire table for efficiency
 */
export async function getSocialGraphStats(): Promise<{
  totalWallets: number;
  withTwitter: number;
  withFarcaster: number;
  withLens: number;
  withGithub: number;
}> {
  const db = getDb();
  if (!db)
    return {
      totalWallets: 0,
      withTwitter: 0,
      withFarcaster: 0,
      withLens: 0,
      withGithub: 0,
    };

  try {
    // Use COUNT aggregates instead of loading entire table
    // This is ~99% faster for tables with 100K+ rows
    const result = await db
      .select({
        totalWallets: sql<number>`COUNT(*)::int`,
        withTwitter: sql<number>`COUNT(*) FILTER (WHERE ${socialGraph.twitterHandle} IS NOT NULL)::int`,
        withFarcaster: sql<number>`COUNT(*) FILTER (WHERE ${socialGraph.farcaster} IS NOT NULL)::int`,
        withLens: sql<number>`COUNT(*) FILTER (WHERE ${socialGraph.lens} IS NOT NULL)::int`,
        withGithub: sql<number>`COUNT(*) FILTER (WHERE ${socialGraph.github} IS NOT NULL)::int`,
      })
      .from(socialGraph);

    return {
      totalWallets: result[0]?.totalWallets ?? 0,
      withTwitter: result[0]?.withTwitter ?? 0,
      withFarcaster: result[0]?.withFarcaster ?? 0,
      withLens: result[0]?.withLens ?? 0,
      withGithub: result[0]?.withGithub ?? 0,
    };
  } catch (error) {
    console.error('Social graph stats error:', error);
    return {
      totalWallets: 0,
      withTwitter: 0,
      withFarcaster: 0,
      withLens: 0,
      withGithub: 0,
    };
  }
}
