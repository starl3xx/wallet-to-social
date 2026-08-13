import { NextRequest, NextResponse } from 'next/server';
import {
  getMaxKnownFid,
  getNetworkMaxFid,
  sweepFidRange,
} from '@/lib/farcaster-sweep';
import { trackEvent } from '@/lib/analytics';

export const runtime = 'nodejs';
export const maxDuration = 300; // FID registration bursts need headroom

// Daily incremental cap. Farcaster registers roughly 1-3k FIDs/day; 30k
// bounds a worst-case burst to ~300 API calls (~1 minute at our pacing).
// Anything beyond rolls into the next day's run or the monthly full sweep.
const MAX_FIDS_PER_RUN = 30000;

/**
 * Daily incremental Farcaster sweep: ingest FIDs registered since the highest
 * fc_fid already in social_graph. The monthly FULL sweep (GitHub Actions,
 * scripts/farcaster-sweep.ts --full) catches changes on existing FIDs —
 * new verifications, handle changes, revocations don't reach this route.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const apiKey = process.env.NEYNAR_API_KEY;
  if (!apiKey || !process.env.DATABASE_URL) {
    return NextResponse.json(
      { error: 'NEYNAR_API_KEY and DATABASE_URL are required' },
      { status: 500 }
    );
  }

  try {
    const maxKnown = await getMaxKnownFid();
    if (maxKnown === 0) {
      // No sweep data yet — the initial full sweep hasn't run. Don't try to
      // do it from a serverless function; it takes ~an hour.
      return NextResponse.json({
        message: 'No swept FIDs found: run the full sweep first (scripts/farcaster-sweep.ts --full)',
        swept: 0,
      });
    }

    const networkMax = await getNetworkMaxFid(apiKey, maxKnown);
    const startFid = maxKnown + 1;
    const endFid = Math.min(networkMax, maxKnown + MAX_FIDS_PER_RUN);

    if (endFid < startFid) {
      return NextResponse.json({ message: 'No new FIDs', maxKnown, networkMax, swept: 0 });
    }

    const stats = await sweepFidRange(startFid, endFid, apiKey);

    trackEvent('lookup_completed', {
      metadata: {
        eventSubtype: 'farcaster_sweep_incremental',
        startFid,
        endFid,
        ...stats,
      },
    }).catch(console.error);

    return NextResponse.json({
      message: `Swept FIDs ${startFid}-${endFid}`,
      truncated: endFid < networkMax,
      ...stats,
    });
  } catch (error) {
    console.error('Farcaster sweep cron error:', error);
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 });
  }
}
