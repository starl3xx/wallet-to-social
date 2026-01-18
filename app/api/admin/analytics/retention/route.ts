import { NextRequest, NextResponse } from 'next/server';
import { getRetentionCohorts } from '@/lib/analytics';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const password = request.headers.get('x-admin-password');
  if (password !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const weeks = parseInt(url.searchParams.get('weeks') || '4', 10);

    const retention = await getRetentionCohorts(weeks);
    return NextResponse.json(retention);
  } catch (error) {
    console.error('Retention API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch retention data' },
      { status: 500 }
    );
  }
}
