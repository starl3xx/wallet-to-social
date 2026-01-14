import { getDb, lookupHistory } from '@/db';
import { desc, eq } from 'drizzle-orm';
import type { WalletSocialResult } from './types';

export interface SavedLookup {
  id: string;
  name: string | null;
  walletCount: number;
  twitterFound: number;
  farcasterFound: number;
  results: WalletSocialResult[];
  createdAt: Date;
}

export async function saveLookup(
  results: WalletSocialResult[],
  name?: string
): Promise<string | null> {
  const db = getDb();
  if (!db) return null;

  const twitterFound = results.filter((r) => r.twitter_handle).length;
  const farcasterFound = results.filter((r) => r.farcaster).length;

  const [inserted] = await db
    .insert(lookupHistory)
    .values({
      name: name ?? null,
      walletCount: results.length,
      twitterFound,
      farcasterFound,
      results: results,
    })
    .returning({ id: lookupHistory.id });

  return inserted.id;
}

export async function getLookupHistory(limit = 10): Promise<SavedLookup[]> {
  const db = getDb();
  if (!db) return [];

  const rows = await db
    .select()
    .from(lookupHistory)
    .orderBy(desc(lookupHistory.createdAt))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    walletCount: row.walletCount,
    twitterFound: row.twitterFound,
    farcasterFound: row.farcasterFound,
    results: row.results as WalletSocialResult[],
    createdAt: row.createdAt,
  }));
}

export async function getLookupById(id: string): Promise<SavedLookup | null> {
  const db = getDb();
  if (!db) return null;

  const rows = await db
    .select()
    .from(lookupHistory)
    .where(eq(lookupHistory.id, id))
    .limit(1);

  if (rows.length === 0) return null;

  const row = rows[0];
  return {
    id: row.id,
    name: row.name,
    walletCount: row.walletCount,
    twitterFound: row.twitterFound,
    farcasterFound: row.farcasterFound,
    results: row.results as WalletSocialResult[],
    createdAt: row.createdAt,
  };
}
