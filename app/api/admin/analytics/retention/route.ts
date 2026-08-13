import { NextRequest, NextResponse } from 'next/server';
import { getRetentionCohorts } from '@/lib/analytics';
import { requireAdmin } from '@/lib/admin-auth';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const authError = requireAdmin(request);
  if (authError) return authError;

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
