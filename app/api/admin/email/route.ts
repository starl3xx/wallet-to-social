import { NextRequest, NextResponse } from 'next/server';
import { getEmailStatus } from '@/lib/analytics';
import { requireAdmin } from '@/lib/admin-auth';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const authError = requireAdmin(request);
  if (authError) return authError;

  try {
    const status = await getEmailStatus();
    return NextResponse.json(status);
  } catch (error) {
    console.error('Email status API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch email status' },
      { status: 500 }
    );
  }
}
