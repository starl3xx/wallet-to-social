import { NextRequest, NextResponse } from 'next/server';
import { sweepEthos } from '@/lib/ethos';
import { trackEvent } from '@/lib/analytics';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * The identity-platform sweep, onchain since 2026-09-20.
 *
 * Daily runs are incremental: attestation events since the checkpoint, with
 * the frontier held for anything unresolved. `?full=1` (the weekly cron
 * entry) re-scans the whole event history and re-reads every active
 * profile's addresses, because connecting a wallet to an existing profile
 * emits no attestation event, so only a full pass sees it: the onchain
 * equivalent of the REST era's daily re-enumeration.
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
    return NextResponse.json(
      { error: 'Database not configured' },
      { status: 500 }
    );
  }

  try {
    const full = request.nextUrl.searchParams.get('full') === '1';
    const stats = await sweepEthos(undefined, { full });

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
    /**
     * Under the REST sweep zero links meant the read failed, because every
     * run re-read the whole base. An incremental run finishes a quiet window
     * with zero links as a matter of course, so "ok" is now "the run
     * completed": a throw is the failure signal, and `frontierHeld` in the
     * record says a range is waiting on the resolver without being an error
     * (caught in review, on the exact day the meaning of zero changed).
     */
    const ok = true;

    trackEvent('lookup_completed', {
      metadata: { eventSubtype: 'ethos_sweep', ok, full, ...stats },
    }).catch(console.error);

    return NextResponse.json({ message: 'ok', ...stats });
  } catch (error) {
    console.error('Ethos sweep cron error:', error);
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 });
  }
}
