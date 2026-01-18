import { NextRequest, NextResponse } from 'next/server';
import { getLookupHistory, getHistorySummaries, getHistoryCount, getEnrichmentCounts } from '@/lib/history';

export async function GET(request: NextRequest) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      { error: 'Database not configured' },
      { status: 503 }
    );
  }

  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get('limit') || '10', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);
    const userId = searchParams.get('userId') || undefined;
    const summaryOnly = searchParams.get('summaryOnly') === 'true';
    const includeCount = searchParams.get('includeCount') === 'true';
    const includeEnrichment = searchParams.get('includeEnrichment') === 'true';

    // Use lightweight summaries when full results aren't needed
    const history = summaryOnly
      ? await getHistorySummaries(Math.min(limit, 50), userId, offset)
      : await getLookupHistory(Math.min(limit, 50), userId);

    // Optionally include total count for pagination
    const totalCount = includeCount ? await getHistoryCount(userId) : undefined;

    // Optionally include enrichment counts (how many wallets updated since last view)
    let enrichmentCounts: Record<string, number> | undefined;
    if (includeEnrichment && history.length > 0) {
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
