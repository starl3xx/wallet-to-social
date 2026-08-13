import { NextRequest, NextResponse } from 'next/server';
import { getExecutivePulse } from '@/lib/analytics';
import { requireAdmin } from '@/lib/admin-auth';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const authError = requireAdmin(request);
  if (authError) return authError;

  try {
    const pulse = await getExecutivePulse();
    return NextResponse.json(pulse);
  } catch (error) {
    console.error('Pulse API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch pulse data' },
      { status: 500 }
    );
  }
}
