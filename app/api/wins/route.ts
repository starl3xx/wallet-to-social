import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { lookupJobs } from '@/db/schema';
import { eq, desc, sql, and } from 'drizzle-orm';

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
    // Social rate = anySocialFound / walletCount (unique wallets with any social)
    // Filter out hidden jobs from public feed
    const completedJobs = await db
      .select({
        id: lookupJobs.id,
        walletCount: sql<number>`jsonb_array_length(${lookupJobs.wallets})`,
        twitterFound: lookupJobs.twitterFound,
        farcasterFound: lookupJobs.farcasterFound,
        anySocialFound: lookupJobs.anySocialFound,
        completedAt: lookupJobs.completedAt,
      })
      .from(lookupJobs)
      .where(
        and(eq(lookupJobs.status, 'completed'), eq(lookupJobs.hidden, false))
      )
      .orderBy(desc(lookupJobs.completedAt))
      .limit(limit * 2); // Fetch extra to filter

    // Filter for >=25 wallets and >10% social rate
    const wins: RecentWin[] = completedJobs
      .filter((job) => {
        if (!job.walletCount || job.walletCount < 25) return false;
        // Use anySocialFound for unique count, fallback to sum for old jobs
        const anyFound = job.anySocialFound > 0 ? job.anySocialFound : job.twitterFound + job.farcasterFound;
        const socialRate = anyFound / job.walletCount;
        return socialRate > 0.1; // >10%
      })
      .slice(0, limit)
      .map((job) => {
        // Use anySocialFound for unique count, fallback to sum for old jobs
        const anyFound = job.anySocialFound > 0 ? job.anySocialFound : job.twitterFound + job.farcasterFound;
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
