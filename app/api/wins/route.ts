import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { lookupJobs } from '@/db/schema';
import { eq, desc, sql } from 'drizzle-orm';

export interface RecentWin {
  id: string;
  walletCount: number;
  twitterFound: number;
  farcasterFound: number;
  socialRate: number; // percentage
  completedAt: string;
}

export async function GET(request: NextRequest) {
  const db = getDb();
  if (!db) {
    return NextResponse.json({ wins: [] });
  }

  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get('limit') || '10', 10);

    // Query completed jobs with >10% social hit rate
    // Social rate = (twitterFound + farcasterFound) / walletCount
    // We need to calculate this and filter
    const completedJobs = await db
      .select({
        id: lookupJobs.id,
        walletCount: sql<number>`jsonb_array_length(${lookupJobs.wallets})`,
        twitterFound: lookupJobs.twitterFound,
        farcasterFound: lookupJobs.farcasterFound,
        completedAt: lookupJobs.completedAt,
      })
      .from(lookupJobs)
      .where(eq(lookupJobs.status, 'completed'))
      .orderBy(desc(lookupJobs.completedAt))
      .limit(limit * 2); // Fetch extra to filter

    // Filter for >10% social rate and format response
    const wins: RecentWin[] = completedJobs
      .filter((job) => {
        if (!job.walletCount || job.walletCount === 0) return false;
        const anyFound = job.twitterFound + job.farcasterFound;
        // Use unique social accounts (some have both twitter and farcaster)
        const socialRate = anyFound / job.walletCount;
        return socialRate > 0.1; // >10%
      })
      .slice(0, limit)
      .map((job) => {
        const anyFound = job.twitterFound + job.farcasterFound;
        const socialRate = Math.round((anyFound / job.walletCount) * 100);
        return {
          id: job.id,
          walletCount: job.walletCount,
          twitterFound: job.twitterFound,
          farcasterFound: job.farcasterFound,
          socialRate,
          completedAt: job.completedAt?.toISOString() || '',
        };
      });

    return NextResponse.json({ wins });
  } catch (error) {
    console.error('Wins fetch error:', error);
    return NextResponse.json({ wins: [] });
  }
}
