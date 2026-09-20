import { NextRequest, NextResponse } from 'next/server';
import { refreshHeroSnapshot } from '@/lib/identity-hero/server';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function GET(request: NextRequest) {
  if (
    !process.env.CRON_SECRET ||
    request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const snapshot = await refreshHeroSnapshot();
    return NextResponse.json({
      ok: true,
      accounts: snapshot.accounts.length,
      checkedAt: snapshot.checkedAt,
    });
  } catch {
    return NextResponse.json(
      { error: 'Hero refresh failed; previous snapshot retained' },
      { status: 503 }
    );
  }
}
