import { getDb, lookupHistory } from '@/db';
import { desc, eq, sql } from 'drizzle-orm';
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
  name?: string,
  userId?: string
): Promise<string | null> {
  const db = getDb();
  if (!db) return null;

  const twitterFound = results.filter((r) => r.twitter_handle).length;
  const farcasterFound = results.filter((r) => r.farcaster).length;

  const [inserted] = await db
    .insert(lookupHistory)
    .values({
      name: name ?? null,
      userId: userId ?? null,
      walletCount: results.length,
      twitterFound,
      farcasterFound,
      results: results,
    })
    .returning({ id: lookupHistory.id });

  return inserted.id;
}

export async function getLookupHistory(
  limit = 10,
  userId?: string
): Promise<SavedLookup[]> {
  const db = getDb();
  if (!db) return [];

  // Filter by userId if provided
  const whereClause = userId ? eq(lookupHistory.userId, userId) : undefined;

  const rows = await db
    .select()
    .from(lookupHistory)
    .where(whereClause)
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

// Lightweight version that only fetches summary columns (no JSONB results)
export interface LookupSummary {
  id: string;
  name: string | null;
  walletCount: number;
  twitterFound: number;
  farcasterFound: number;
  createdAt: Date;
}

export async function getHistorySummaries(
  limit = 10,
  userId?: string,
  offset = 0
): Promise<LookupSummary[]> {
  const db = getDb();
  if (!db) return [];

  const whereClause = userId ? eq(lookupHistory.userId, userId) : undefined;

  const rows = await db
    .select({
      id: lookupHistory.id,
      name: lookupHistory.name,
      walletCount: lookupHistory.walletCount,
      twitterFound: lookupHistory.twitterFound,
      farcasterFound: lookupHistory.farcasterFound,
      createdAt: lookupHistory.createdAt,
    })
    .from(lookupHistory)
    .where(whereClause)
    .orderBy(desc(lookupHistory.createdAt))
    .limit(limit)
    .offset(offset);

  return rows;
}

export async function getHistoryCount(userId?: string): Promise<number> {
  const db = getDb();
  if (!db) return 0;

  const whereClause = userId ? eq(lookupHistory.userId, userId) : undefined;

  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(lookupHistory)
    .where(whereClause);

  return result?.count || 0;
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

export async function updateLookup(
  id: string,
  results: WalletSocialResult[]
): Promise<boolean> {
  const db = getDb();
  if (!db) return false;

  const twitterFound = results.filter((r) => r.twitter_handle).length;
  const farcasterFound = results.filter((r) => r.farcaster).length;

  const updated = await db
    .update(lookupHistory)
    .set({
      walletCount: results.length,
      twitterFound,
      farcasterFound,
      results: results,
    })
    .where(eq(lookupHistory.id, id))
    .returning({ id: lookupHistory.id });

  return updated.length > 0;
}

export async function updateLookupName(
  id: string,
  name: string
): Promise<boolean> {
  const db = getDb();
  if (!db) return false;

  const updated = await db
    .update(lookupHistory)
    .set({ name })
    .where(eq(lookupHistory.id, id))
    .returning({ id: lookupHistory.id });

  return updated.length > 0;
}
