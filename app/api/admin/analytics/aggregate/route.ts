import { NextRequest, NextResponse } from 'next/server';
import { aggregateDailyStats, getDailyStatsRange } from '@/lib/analytics';

export const runtime = 'nodejs';

// POST: Trigger aggregation for a specific date (or today)
export async function POST(request: NextRequest) {
  const password = request.headers.get('x-admin-password');
  if (password !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const dateStr = body.date;

    // Parse date or use today
    const date = dateStr ? new Date(dateStr) : new Date();

    await aggregateDailyStats(date);

    return NextResponse.json({
      success: true,
      date: date.toISOString().split('T')[0],
      message: 'Daily stats aggregated successfully',
    });
  } catch (error) {
    console.error('Aggregation API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to aggregate stats' },
      { status: 500 }
    );
  }
}

// GET: Fetch daily stats for a date range
export async function GET(request: NextRequest) {
  const password = request.headers.get('x-admin-password');
  if (password !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const days = parseInt(url.searchParams.get('days') || '30', 10);

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const stats = await getDailyStatsRange(startDate, endDate);
    return NextResponse.json(stats);
  } catch (error) {
    console.error('Daily stats API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch daily stats' },
      { status: 500 }
    );
  }
}
