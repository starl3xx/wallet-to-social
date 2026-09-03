import { NextRequest, NextResponse } from 'next/server';
import { getCheckpoint, harvestBasenameRecords } from '@/lib/basenames';
import { trackEvent } from '@/lib/analytics';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * The most blocks one run will scan, however far behind the checkpoint is.
 *
 * About a week of Base at 43,200 blocks a day. It bounds the work rather than
 * the stall: a run that stops on the budget leaves the checkpoint where it got
 * to, so the next run continues, and a long outage costs several days of
 * catching up instead of one request that exceeds `maxDuration` and never
 * finishes. A normal day is a thirtieth of this.
 */
const MAX_RUN_BLOCKS = 43_200 * 7;

/**
 * Daily incremental basename text-record harvest.
 *
 * Scans `com.twitter` writes on the two Basenames resolvers from the saved
 * checkpoint (about 43,200 Base blocks a day, a handful of log queries),
 * re-reads each name's record from the resolver the registry names today,
 * refuses expired names and junk values, and fills the handles nobody has yet.
 *
 * Requires a checkpoint: the one-time backfill runs through
 * `scripts/harvest-basenames.ts --backfill --commit`.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      { error: 'Database not configured' },
      { status: 500 }
    );
  }

  try {
    const checkpoint = await getCheckpoint();
    if (checkpoint === null) {
      return NextResponse.json({
        message:
          'No checkpoint: run the backfill first (scripts/harvest-basenames.ts --backfill --commit)',
        harvested: 0,
      });
    }

    const stats = await harvestBasenameRecords({
      fromBlock: checkpoint + 1,
      maxBlocks: MAX_RUN_BLOCKS,
    });

    /**
     * A run that scanned nothing is the cron firing twice inside the reorg
     * buffer, not a failure. Say so and stop, rather than letting it fall into
     * the health test below and read as a stalled checkpoint.
     *
     * No `onReject` is passed: the drop counts are what a scheduled run needs,
     * and the raw refused values are for a person tuning the rules at a
     * terminal (`scripts/harvest-basenames.ts` samples ten of them).
     */
    if (stats.blocksScanned === 0) {
      return NextResponse.json({
        message: 'Already at the chain head',
        ...stats,
      });
    }

    /**
     * `ok` decided BEFORE the event is written, by the same expression that
     * decides the status code, so the record and the status can never
     * disagree. (The ethos sweep's header records what happened when they
     * could: a failing run left a record identical to a healthy one and the
     * dependency panel reported the job fine.)
     *
     * The test is that the checkpoint MOVED, not that links were written, and
     * that difference matters here where it did not for the ethos sweep. This
     * corpus takes a couple of hundred records a MONTH (208 in August 2026),
     * so a day with none at all is ordinary and a day whose handful all fail a
     * filter is ordinary too. Paging on zero links would page on a quiet
     * Tuesday. A checkpoint that did not move after a run scanned blocks means
     * the writer failed, which is the thing worth waking someone for.
     */
    const ok =
      stats.checkpointBlock !== null && stats.checkpointBlock > checkpoint;

    trackEvent('lookup_completed', {
      metadata: {
        eventSubtype: 'basenames_harvest_incremental',
        ok,
        ...stats,
      },
    }).catch(console.error);

    if (!ok) {
      return NextResponse.json(
        {
          message: 'Basename harvest did not advance its checkpoint',
          ...stats,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({ message: 'ok', ...stats });
  } catch (error) {
    console.error('Basename harvest cron error:', error);
    return NextResponse.json({ error: 'Harvest failed' }, { status: 500 });
  }
}
