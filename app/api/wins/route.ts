import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { lookupJobs } from '@/db/schema';
import { eq, desc, sql, and, gte } from 'drizzle-orm';

export interface RecentWin {
  id: string;
  walletCount: number;
  twitterFound: number;
  farcasterFound: number;
  /**
   * Unique wallets with any social. NOT twitterFound + farcasterFound: a wallet
   * with both accounts appears in each of those, so the sum overcounts and
   * disagrees with socialRate, which is computed from this. Resolved here rather
   * than on the client so the old-job fallback exists in exactly one place.
   */
  anySocialFound: number;
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

    // Query completed jobs with >8% social hit rate from the last 7 days.
    // Social rate = anySocialFound / walletCount (unique wallets with any social).
    // Hidden jobs are excluded from the public feed.
    //
    // Seed-cron jobs are deliberately INCLUDED. They are automated imports of
    // collections nobody asked about, so they are not customer activity, but a
    // seeded collection that resolves well is a true statement about the index
    // and reads as exactly what the strip is for. Confirmed with the owner on
    // 2026-08-18 rather than assumed.
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    /**
     * The hit-rate filter belongs in SQL, so LIMIT counts wins rather than rows.
     *
     * It used to run in JS over `limit * 5` rows fetched newest-first. That
     * multiplier is an assumed pass rate, and the real one is about 19%:
     * measured on 2026-08-18, 42 eligible jobs in the window, 8 clearing the
     * bar, but only 1 inside the 25 rows the endpoint fetched. The homepage
     * strip asks for five and showed one, with seven qualifying wins sitting
     * just outside the fetch.
     *
     * A post-filter behind a LIMIT degrades quietly and always downward, so it
     * reads as "nothing happened" rather than as a bug. Filtering here means
     * the limit applies to rows that already qualify, and no multiplier has to
     * track a rate that moves.
     *
     * The expression mirrors the old JS exactly, including the fallback for
     * jobs written before `any_social_found` existed. Multiplication rather
     * than division: `wallets >= 25` above already excludes zero, and this way
     * there is no float division to disagree with the JS that recomputes the
     * displayed percentage below.
     */
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
        and(
          eq(lookupJobs.status, 'completed'),
          eq(lookupJobs.hidden, false),
          gte(lookupJobs.completedAt, sevenDaysAgo),
          sql`jsonb_array_length(${lookupJobs.wallets}) >= 25`,
          sql`(CASE WHEN ${lookupJobs.anySocialFound} > 0
                    THEN ${lookupJobs.anySocialFound}
                    ELSE ${lookupJobs.twitterFound} + ${lookupJobs.farcasterFound}
               END) > 0.08 * jsonb_array_length(${lookupJobs.wallets})`
        )
      )
      .orderBy(desc(lookupJobs.completedAt))
      .limit(limit);

    // Already filtered and limited in SQL. This only shapes the response.
    const wins: RecentWin[] = completedJobs.map((job) => {
      // Use anySocialFound for unique count, fallback to sum for old jobs
      const anyFound =
        job.anySocialFound > 0
          ? job.anySocialFound
          : job.twitterFound + job.farcasterFound;
      const socialRate = Math.round((anyFound / job.walletCount) * 100);
      return {
        id: job.id,
        walletCount: job.walletCount,
        twitterFound: job.twitterFound,
        farcasterFound: job.farcasterFound,
        anySocialFound: anyFound,
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
