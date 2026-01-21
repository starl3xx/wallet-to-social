import { NextRequest, NextResponse } from 'next/server';
import { getDashboardData, TimePeriod } from '@/lib/dashboard-analytics';

export const runtime = 'nodejs';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

function isAuthorized(request: NextRequest): boolean {
  if (!ADMIN_PASSWORD) return false;
  const password = request.headers.get('x-admin-password');
  return password === ADMIN_PASSWORD;
}

const validPeriods: TimePeriod[] = ['today', 'week', 'month'];

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

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
