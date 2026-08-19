import { NextRequest, NextResponse } from 'next/server';
import { sweepClanker } from '@/lib/clanker';
import { trackEvent } from '@/lib/analytics';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Daily incremental scan of Clanker token deploys on Base.
 *
 * Reads from the saved checkpoint, so a normal run covers a day of blocks and
 * finishes in seconds. The first run has no checkpoint and falls back to a
 * month's lookback, which is the only run that takes real time.
 *
 * Small by design: about 24 X-linked deploys a day. It is here because two
 * thirds of them carry the numeric X account id, and almost nothing else does.
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
    const stats = await sweepClanker();

    // A held checkpoint means the resolver could not answer, so this run did
    // not finish its range. Recorded as a failure for the same reason the
    // attestation sweeps do it: the health panel must be able to tell a run
    // that worked from a run that merely happened.
    //
    // Abandoning an id does NOT make a run fail. It is the mechanism working:
    // the frontier moved, so the range is finished. It still needs to be seen,
    // because it is the only path by which a link is knowingly given up, and
    // `abandonedAccountIds` rides in the event metadata for exactly that.
    const ok = !stats.checkpointHeld;

    trackEvent('lookup_completed', {
      metadata: { eventSubtype: 'clanker_sweep', ok, ...stats },
    }).catch(console.error);

    if (!ok) {
      return NextResponse.json(
        {
          message:
            `${stats.unresolvedAccountIds} deploy(s) unresolved; checkpoint held ` +
            `so the range is rescanned rather than lost`,
          ...stats,
        },
        { status: 502 }
      );
    }
    return NextResponse.json({ message: 'ok', ...stats });
  } catch (error) {
    console.error('Clanker sweep cron error:', error);
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 });
  }
}
