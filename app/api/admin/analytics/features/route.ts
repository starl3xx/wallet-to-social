import { NextRequest, NextResponse } from 'next/server';
import { getFeatureAdoption } from '@/lib/analytics';

export const runtime = 'nodejs';

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

    const features = await getFeatureAdoption(startDate, endDate);
    return NextResponse.json(features);
  } catch (error) {
    console.error('Features API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch feature data' },
      { status: 500 }
    );
  }
}
