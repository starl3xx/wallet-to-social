import { NextRequest, NextResponse } from 'next/server';
import { getRecentErrors } from '@/lib/analytics';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const password = request.headers.get('x-admin-password');
  if (password !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);

    const errors = await getRecentErrors(limit);
    return NextResponse.json(errors);
  } catch (error) {
    console.error('Errors API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch error data' },
      { status: 500 }
    );
  }
}
