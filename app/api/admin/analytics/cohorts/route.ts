import { NextRequest, NextResponse } from 'next/server';
import { getUserCohorts } from '@/lib/analytics';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const password = request.headers.get('x-admin-password');
  if (password !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const cohorts = await getUserCohorts();
    return NextResponse.json(cohorts);
  } catch (error) {
    console.error('Cohorts API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch cohort data' },
      { status: 500 }
    );
  }
}
