import { NextRequest, NextResponse } from 'next/server';
import { getApiStats, type ApiProvider } from '@/lib/analytics';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const password = request.headers.get('x-admin-password');
  if (password !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const hours = parseInt(url.searchParams.get('hours') || '24', 10);

    const endDate = new Date();
    const startDate = new Date();
    startDate.setHours(startDate.getHours() - hours);

    const providers: ApiProvider[] = ['web3bio', 'neynar', 'ens'];
    const stats = await Promise.all(
      providers.map(async (provider) => ({
        provider,
        ...(await getApiStats(provider, startDate, endDate)),
      }))
    );

    return NextResponse.json(stats);
  } catch (error) {
    console.error('API stats error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch API stats' },
      { status: 500 }
    );
  }
}
