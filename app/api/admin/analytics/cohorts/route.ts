import { NextRequest, NextResponse } from 'next/server';
import { getUserCohorts } from '@/lib/analytics';
import { requireAdmin } from '@/lib/admin-auth';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const authError = requireAdmin(request);
  if (authError) return authError;

  try {
    const cohorts = await getUserCohorts();
    return NextResponse.json(cohorts);
  } catch (error) {
    console.error('Cohorts API error:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to fetch cohort data',
      },
      { status: 500 }
    );
  }
}
