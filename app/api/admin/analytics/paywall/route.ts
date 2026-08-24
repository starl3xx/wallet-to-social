import { NextRequest, NextResponse } from 'next/server';
import { getPaywallTriggers } from '@/lib/analytics';
import { requireAdmin } from '@/lib/admin-auth';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const authError = requireAdmin(request);
  if (authError) return authError;

  try {
    const url = new URL(request.url);
    const days = parseInt(url.searchParams.get('days') || '30', 10);

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const triggers = await getPaywallTriggers(startDate, endDate);
    return NextResponse.json({ triggers });
  } catch (error) {
    console.error('Paywall triggers API error:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to fetch paywall triggers',
      },
      { status: 500 }
    );
  }
}
