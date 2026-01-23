import { getDb, walletCache, type NewWalletCache } from '@/db';
import { inArray, lt, sql } from 'drizzle-orm';
import type { WalletSocialResult } from './types';

const CACHE_TTL_HOURS = 24;

export async function getCachedWallets(
  wallets: string[]
): Promise<Map<string, WalletSocialResult>> {
  const db = getDb();
  if (!db || wallets.length === 0) return new Map();

  const cutoff = new Date(Date.now() - CACHE_TTL_HOURS * 60 * 60 * 1000);
  const lowercaseWallets = wallets.map((w) => w.toLowerCase());

  try {
    const cached = await db
      .select()
      .from(walletCache)
      .where(inArray(walletCache.wallet, lowercaseWallets));

    const results = new Map<string, WalletSocialResult>();

    for (const row of cached) {
      // Skip expired cache entries
      if (row.cachedAt < cutoff) continue;

      results.set(row.wallet, {
        wallet: row.wallet,
        ens_name: row.ensName ?? undefined,
        twitter_handle: row.twitterHandle ?? undefined,
        twitter_url: row.twitterUrl ?? undefined,
        farcaster: row.farcaster ?? undefined,
        farcaster_url: row.farcasterUrl ?? undefined,
        fc_followers: row.fcFollowers ?? undefined,
        fc_fid: row.fcFid ?? undefined,
        lens: row.lens ?? undefined,
        github: row.github ?? undefined,
        source: row.sources ?? [],
      });
    }

    return results;
  } catch (error) {
    console.error('Cache read error:', error);
    return new Map();
  }
}

export async function cacheWalletResults(
  results: WalletSocialResult[]
): Promise<void> {
  const db = getDb();
  if (!db || results.length === 0) return;

  try {
    const rows: NewWalletCache[] = results.map((r) => ({
      wallet: r.wallet.toLowerCase(),
      ensName: r.ens_name ?? null,
      twitterHandle: r.twitter_handle ?? null,
      twitterUrl: r.twitter_url ?? null,
      farcaster: r.farcaster ?? null,
      farcasterUrl: r.farcaster_url ?? null,
      fcFollowers: r.fc_followers ?? null,
      fcFid: r.fc_fid ?? null,
      lens: r.lens ?? null,
      github: r.github ?? null,
      sources: r.source,
      cachedAt: new Date(),
    }));

    // Upsert in batches of 100
    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i, i + 100);
      await db
        .insert(walletCache)
        .values(batch)
        .onConflictDoUpdate({
          target: walletCache.wallet,
          set: {
            ensName: sql`EXCLUDED.ens_name`,
            twitterHandle: sql`EXCLUDED.twitter_handle`,
            twitterUrl: sql`EXCLUDED.twitter_url`,
            farcaster: sql`EXCLUDED.farcaster`,
            farcasterUrl: sql`EXCLUDED.farcaster_url`,
            fcFollowers: sql`EXCLUDED.fc_followers`,
            fcFid: sql`EXCLUDED.fc_fid`,
            lens: sql`EXCLUDED.lens`,
            github: sql`EXCLUDED.github`,
            sources: sql`EXCLUDED.sources`,
            cachedAt: sql`EXCLUDED.cached_at`,
          },
        });
    }
  } catch (error) {
    console.error('Cache write error:', error);
  }
}

export async function cleanExpiredCache(): Promise<number> {
  const db = getDb();
  if (!db) return 0;

  const cutoff = new Date(Date.now() - CACHE_TTL_HOURS * 60 * 60 * 1000);

  try {
    await db.delete(walletCache).where(lt(walletCache.cachedAt, cutoff));

    return 0;
  } catch (error) {
    console.error('Cache cleanup error:', error);
    return 0;
  }
}

export async function getCacheStats(): Promise<{
  total: number;
  recentHits: number;
}> {
  const db = getDb();
  if (!db) return { total: 0, recentHits: 0 };

  try {
    const cutoff = new Date(Date.now() - CACHE_TTL_HOURS * 60 * 60 * 1000);

    // Use COUNT aggregates instead of loading entire table
    // This is ~99% faster for large tables
    const result = await db
      .select({
        total: sql<number>`COUNT(*)::int`,
        recentHits: sql<number>`COUNT(*) FILTER (WHERE ${walletCache.cachedAt} >= ${cutoff})::int`,
      })
      .from(walletCache);

    return {
      total: result[0]?.total ?? 0,
      recentHits: result[0]?.recentHits ?? 0,
    };
  } catch (error) {
    console.error('Cache stats error:', error);
    return { total: 0, recentHits: 0 };
  }
}
