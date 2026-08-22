import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  getLookupHistory,
  getHistorySummaries,
  getHistoryCount,
  getEnrichmentCounts,
} from '@/lib/history';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth';
import { getUserAccess } from '@/lib/access';
import { hasPaidAccess } from '@/lib/credits';

export async function GET(request: NextRequest) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      { error: 'Database not configured' },
      { status: 503 }
    );
  }

  // Require authenticated session to access history
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!sessionToken) {
    return NextResponse.json(
      { error: 'Login required to view history' },
      { status: 401 }
    );
  }

  const session = await validateSession(sessionToken);
  if (!session.user) {
    return NextResponse.json(
      { error: 'Invalid or expired session' },
      { status: 401 }
    );
  }

  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get('limit') || '10', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);
    const summaryOnly = searchParams.get('summaryOnly') === 'true';
    const includeCount = searchParams.get('includeCount') === 'true';
    const includeEnrichment = searchParams.get('includeEnrichment') === 'true';

    // Use session userId for secure history filtering
    const userId = session.user.id;

    // Use lightweight summaries when full results aren't needed
    const history = summaryOnly
      ? await getHistorySummaries(Math.min(limit, 50), userId, offset)
      : await getLookupHistory(Math.min(limit, 50), userId);

    // Optionally include total count for pagination
    const totalCount = includeCount ? await getHistoryCount(userId) : undefined;

    /**
     * Enrichment counts are the "N new matches" pills on the history list, and
     * they are the same paid feature as the NEW row markers inside a
     * lookup. Gating one and not the other was worse than gating neither: the
     * list advertised new matches, opening the lookup showed none, and the act
     * of opening it advanced `lastViewedAt` and destroyed the window those
     * matches were counted against.
     */
    const access = await getUserAccess(session.user.email ?? undefined);
    const canSeeEnrichment = await hasPaidAccess(userId, access.tier);

    let enrichmentCounts: Record<string, number> | undefined;
    if (includeEnrichment && canSeeEnrichment && history.length > 0) {
      const lookupIds = history.map((h) => h.id);
      const countsMap = await getEnrichmentCounts(lookupIds);
      enrichmentCounts = Object.fromEntries(countsMap);
    }

    return NextResponse.json({ history, totalCount, enrichmentCounts });
  } catch (error) {
    console.error('History fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch history' },
      { status: 500 }
    );
  }
}
