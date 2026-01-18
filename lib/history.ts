import { getDb, lookupHistory, socialGraph } from '@/db';
import { desc, eq, sql, inArray } from 'drizzle-orm';
import type { WalletSocialResult } from './types';

export interface SavedLookup {
  id: string;
  name: string | null;
  userId: string | null;
  walletCount: number;
  twitterFound: number;
  farcasterFound: number;
  results: WalletSocialResult[];
  createdAt: Date;
}

export type InputSource = 'file_upload' | 'text_input' | 'api';

export async function saveLookup(
  results: WalletSocialResult[],
  name?: string,
  userId?: string,
  inputSource?: InputSource
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
      inputSource: inputSource ?? null,
    })
    .returning();

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
    userId: row.userId,
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
    userId: row.userId,
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
    .returning();

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
    .returning();

  return updated.length > 0;
}

/**
 * Mark a lookup as viewed, updating the lastViewedAt timestamp
 */
export async function markLookupViewed(id: string): Promise<void> {
  const db = getDb();
  if (!db) return;

  try {
    await db
      .update(lookupHistory)
      .set({ lastViewedAt: new Date() })
      .where(eq(lookupHistory.id, id));
  } catch (error) {
    console.error('Mark lookup viewed error:', error);
  }
}

/**
 * Get lastViewedAt timestamp for a lookup
 */
export async function getLookupLastViewedAt(id: string): Promise<Date | null> {
  const db = getDb();
  if (!db) return null;

  try {
    const rows = await db
      .select({ lastViewedAt: lookupHistory.lastViewedAt })
      .from(lookupHistory)
      .where(eq(lookupHistory.id, id))
      .limit(1);

    return rows[0]?.lastViewedAt || null;
  } catch (error) {
    console.error('Get lookup last viewed error:', error);
    return null;
  }
}

/**
 * Get enrichment counts for multiple lookups
 * Returns a map of lookupId -> number of wallets enriched since lastViewedAt
 */
export async function getEnrichmentCounts(
  lookupIds: string[]
): Promise<Map<string, number>> {
  const db = getDb();
  const result = new Map<string, number>();
  if (!db || lookupIds.length === 0) return result;

  try {
    // First, get all lookups with their lastViewedAt and results
    const lookups = await db
      .select({
        id: lookupHistory.id,
        lastViewedAt: lookupHistory.lastViewedAt,
        results: lookupHistory.results,
      })
      .from(lookupHistory)
      .where(inArray(lookupHistory.id, lookupIds));

    // For each lookup, count wallets enriched since lastViewedAt
    for (const lookup of lookups) {
      // If never viewed, skip (no "new" enrichments to show)
      if (!lookup.lastViewedAt) {
        result.set(lookup.id, 0);
        continue;
      }

      const results = lookup.results as WalletSocialResult[];
      const wallets = results.map((r) => r.wallet.toLowerCase());

      if (wallets.length === 0) {
        result.set(lookup.id, 0);
        continue;
      }

      // Count wallets in social_graph updated after lastViewedAt
      const [countResult] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(socialGraph)
        .where(
          sql`${socialGraph.wallet} IN ${wallets} AND ${socialGraph.lastUpdatedAt} > ${lookup.lastViewedAt}`
        );

      result.set(lookup.id, countResult?.count || 0);
    }

    return result;
  } catch (error) {
    console.error('Get enrichment counts error:', error);
    return result;
  }
}
