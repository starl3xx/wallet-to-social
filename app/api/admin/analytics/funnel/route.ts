import { NextRequest, NextResponse } from 'next/server';
import { getUserFunnel } from '@/lib/analytics';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const password = request.headers.get('x-admin-password');
  if (password !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const days = parseInt(url.searchParams.get('days') || '7', 10);

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const funnel = await getUserFunnel(startDate, endDate);
    return NextResponse.json(funnel);
  } catch (error) {
    console.error('Funnel API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch funnel data' },
      { status: 500 }
    );
  }
}
