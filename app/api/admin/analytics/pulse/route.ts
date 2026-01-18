import { NextRequest, NextResponse } from 'next/server';
import { getExecutivePulse } from '@/lib/analytics';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  // Check admin password
  const password = request.headers.get('x-admin-password');
  if (password !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

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
