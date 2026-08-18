import { NextRequest, NextResponse } from 'next/server';
import { sweepEthos } from '@/lib/ethos';
import { trackEvent } from '@/lib/analytics';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Daily read of the whole Ethos dataset.
 *
 * About 80 requests and well under a minute for the entire base, against a
 * public API with no key and no metering, so unlike the Farcaster sweep and the
 * holder index this consults no budget: there is no allowance to protect and
 * nothing a heavy day could exhaust.
 *
 * It fills X handles where we hold none, attaches the numeric X account id
 * wherever the handle it belongs to is the one we already store, and records
 * disagreements without settling them.
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
    const stats = await sweepEthos();

    /**
     * `ok` decided BEFORE the event is written, by the same expression that
     * decides the status code.
     *
     * The event used to be written first and unconditionally, so a sweep that
     * read nothing and returned 502 left a record identical to a healthy one.
     * The dependency panel read those records and reported this job "ok",
     * which is the precise failure it exists to prevent: a job that runs and
     * fails looked the same as a job that runs and works.
     *
     * One expression, used twice, so the status code and the record can never
     * disagree.
     */
    const ok = stats.links > 0;

    trackEvent('lookup_completed', {
      metadata: { eventSubtype: 'ethos_sweep', ok, ...stats },
    }).catch(console.error);

    // A sweep that read no pages is a failure that returns 200 otherwise, and
    // this runs unattended, so say so in the status code.
    if (!ok) {
      return NextResponse.json(
        { message: 'Ethos sweep read no links', ...stats },
        { status: 502 }
      );
    }

    return NextResponse.json({ message: 'ok', ...stats });
  } catch (error) {
    console.error('Ethos sweep cron error:', error);
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 });
  }
}
