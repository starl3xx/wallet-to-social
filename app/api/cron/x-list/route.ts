/**
 * The X list builder: one tick a minute while a list is being built, nothing
 * at all while none is.
 *
 * A minute between ticks, because X's member-add window is fifteen minutes
 * wide: a list of 319 spends its first 300 over the first fifteen minutes and
 * finishes in the next window, which is the fastest the provider allows.
 *
 * Until 2026-11-21 Vercel Cron called this every minute, and each idle tick
 * read Postgres, so the database never got the five quiet minutes it needs to
 * suspend (STA-77). One list has ever been built. So a list now starts itself:
 * the X callback kicks this route (POST with `x-worker-kick`), which answers
 * 202 and, in `after()`, ticks once a minute for four minutes while a list is
 * open, then kicks its successor if one still is. The hourly cron (GET) is the
 * safety net for a kick that never arrived, and starts a chain itself when it
 * finds open work.
 */
import { NextRequest, NextResponse, after } from 'next/server';
import { hasOpenXListJob, runXListTick } from '@/lib/x-list-worker';
import { isConfigured as xConfigured } from '@/lib/x-oauth';
import { isConfigured as boxConfigured } from '@/lib/secret-box';
import { kickHopOf, kickWorker } from '@/lib/worker-kick';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// A kicked run ticks for four minutes inside `after()`.
export const maxDuration = 300;

const TICK_SPACING_MS = 60_000;
const TICKS_PER_RUN = 4;

function authorized(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  return !cronSecret || authHeader === `Bearer ${cronSecret}`;
}

/**
 * Answers 200 rather than 503 when unconfigured.
 *
 * A cron that reports failure on a deployment where the feature is simply
 * switched off trains everyone to ignore its alerts, and the alert that
 * matters here is a job that stalls while the feature IS on.
 */
function configured(): boolean {
  return xConfigured() && boxConfigured();
}

/** The hourly safety net: one tick, and a chain if a list is still open. */
export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!configured()) {
    return NextResponse.json({ status: 'disabled' });
  }

  try {
    const result = await runXListTick();
    if (await hasOpenXListJob()) after(() => kickWorker('/api/cron/x-list'));
    return NextResponse.json(result);
  } catch (error) {
    console.error('X list tick failed:', error);
    return NextResponse.json(
      { error: 'tick_failed', message: String(error) },
      { status: 500 }
    );
  }
}

/** A kick: answered at once, worked in `after()`. */
export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const hop = kickHopOf(request.headers);
  if (hop === null) {
    return NextResponse.json(
      { error: 'POST is for worker kicks only' },
      { status: 400 }
    );
  }
  if (!configured()) {
    return NextResponse.json({ status: 'disabled' });
  }

  after(async () => {
    try {
      for (let i = 0; i < TICKS_PER_RUN; i++) {
        if (i > 0) {
          await new Promise((resolve) => setTimeout(resolve, TICK_SPACING_MS));
        }
        const result = await runXListTick();
        // Nothing claimable and nothing waiting: the list is done.
        if (result.jobId === null && !(await hasOpenXListJob())) return;
      }
      if (await hasOpenXListJob()) {
        await kickWorker('/api/cron/x-list', hop + 1);
      }
    } catch (error) {
      console.error(
        'Kicked X list run failed; the hourly tick retries:',
        error
      );
    }
  });
  return NextResponse.json({ accepted: true, hop }, { status: 202 });
}
