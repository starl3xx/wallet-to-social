import { NextRequest, NextResponse } from 'next/server';
import { getDashboardData, TimePeriod } from '@/lib/dashboard-analytics';
import { requireAdmin } from '@/lib/admin-auth';

export const runtime = 'nodejs';

const validPeriods: TimePeriod[] = ['today', 'week', 'month'];

export async function GET(request: NextRequest) {
  const authError = requireAdmin(request);
  if (authError) return authError;

  try {
    const searchParams = request.nextUrl.searchParams;
    const periodParam = searchParams.get('period') || 'today';

    // Validate period
    const period = validPeriods.includes(periodParam as TimePeriod)
      ? (periodParam as TimePeriod)
      : 'today';

    const data = await getDashboardData(period);

    return NextResponse.json(data);
  } catch (error) {
    console.error('Dashboard fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch dashboard data' },
      { status: 500 }
    );
  }
}
