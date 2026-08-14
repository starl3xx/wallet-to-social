import { NextRequest, NextResponse } from 'next/server';
import { getCheckpoint, harvestEnsTextRecords } from '@/lib/ens-harvest';
import { trackEvent } from '@/lib/analytics';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Daily incremental ENS text-record harvest: scans TextChanged events for
 * com.twitter / com.github from the saved checkpoint (~7,200 mainnet blocks
 * per day — a handful of getLogs calls), resolves current values onchain,
 * and upserts the new user-attested handles.
 *
 * Requires a checkpoint: the one-time backfill runs via
 * scripts/ens-harvest.ts --backfill.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
  }

  try {
    const checkpoint = await getCheckpoint();
    if (checkpoint === null) {
      return NextResponse.json({
        message: 'No checkpoint: run the backfill first (scripts/ens-harvest.ts --backfill)',
        harvested: 0,
      });
    }

    const stats = await harvestEnsTextRecords(checkpoint + 1);

    trackEvent('lookup_completed', {
      metadata: {
        eventSubtype: 'ens_harvest_incremental',
        fromBlock: checkpoint + 1,
        ...stats,
      },
    }).catch(console.error);

    return NextResponse.json({ message: 'ok', fromBlock: checkpoint + 1, ...stats });
  } catch (error) {
    console.error('ENS harvest cron error:', error);
    return NextResponse.json({ error: 'Harvest failed' }, { status: 500 });
  }
}
