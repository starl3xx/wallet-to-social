import { NextRequest, NextResponse } from 'next/server';
import { pendingHandles, remainingCredits, sweepHandles } from '@/lib/x-accounts';
import { isConfigured, resolverKey } from '@/lib/x-resolver';
import { planSweep } from '@/lib/x-sweep-budget';
import { trackEvent } from '@/lib/analytics';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Resolve X handles against the resolver, on a schedule.
 *
 * ## Why this exists
 *
 * Until now this was a manual script with no cron, while `docs-site` told
 * customers handles were resolved "on a daily cycle". Every reachability figure
 * we publish ages from the moment it was measured, and on 2026-08-18 the whole
 * index rested on a single 3.5 hour run performed the day before.
 *
 * ## The two jobs this does
 *
 * `pendingHandles` returns never-checked handles first, then any checked longer
 * ago than the staleness threshold, with a random tie-break inside each group.
 * The tie-break is load-bearing: without it Postgres returns storage order,
 * which is effectively alphabetical, and the first run's interim not-found rate
 * read 15.28% against a true 8.47% because every handle it had seen began with
 * '0'. A partial pass must be a fair sample of the whole or every number it
 * reports on the way is wrong.
 *
 * ## The November wave, now spread
 *
 * Every one of the 417,998 rows was checked inside a four-hour window on
 * 2026-08-17. At a flat 90 day threshold all of them became due on the same
 * day: modelled against the real timestamps, 417,872 handles falling due on
 * 2026-11-15, which is 82 days of work arriving at once.
 *
 * `pendingHandles` now gives each handle its own threshold, derived from the
 * handle itself, so the same rows come due across 91 days from 2026-10-01,
 * peaking at 4,804 on 2026-10-27 against a daily capacity near 5,112. The wave
 * never exceeds what one run absorbs, and clearing the current backlog no
 * longer builds the next cohort behind it.
 */

/**
 * Handles fetched in one run, whatever the money allows.
 *
 * On the day before a reset the whole remaining balance is available, which at
 * 18 credits is over 150,000 handles: far beyond what fits in 300 seconds, and
 * a pointlessly large query. Measured throughput is roughly 70 lookups a
 * second, so a 240 second working window is about 16,800. This sits under that
 * so the run ends on its own terms rather than on the deadline.
 */
const MAX_HANDLES_PER_RUN = 12_000;

/** Leaves 60s of the route's 300s for the final flush and the response. */
const WORKING_WINDOW_MS = 240_000;

/**
 * Controls every 250 lookups rather than the default 2,000.
 *
 * A run capped near 2,000 would otherwise get no mid-flight check at all, and
 * its entire output would rest on the single pre-flight one. If the resolver
 * starts answering "not found" to everything partway through, every remaining
 * handle is written as `not_found`, which we publish as `unclaimed`. The cost
 * is at most 32 extra lookups per run.
 */
const CONTROL_EVERY = 250;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
  }
  if (!isConfigured()) {
    // Not an error worth alarming on: it is a configuration fact, and the
    // dependency panel already reports it plainly.
    return NextResponse.json(
      { message: 'X resolver is not configured; nothing to do', skipped: true },
      { status: 200 }
    );
  }

  const startedAt = Date.now();

  try {
    const key = resolverKey();
    const budget = planSweep(await remainingCredits(key), new Date());

    if (budget.refusal) {
      /**
       * Recorded with ok:false so a refusal is visible in the health panel
       * rather than looking like a quiet success. A sweep that has not run for
       * a week because the balance is at the reserve is something a person
       * needs to know, and it is exactly the shape of failure that hid the
       * missing cron in the first place.
       */
      trackEvent('lookup_completed', {
        metadata: {
          eventSubtype: 'x_reachability_sweep',
          ok: false,
          refusal: budget.refusal,
          balance: budget.balance,
          daysLeft: budget.daysLeft,
        },
      }).catch(console.error);
      return NextResponse.json(
        { message: `Refused: ${budget.refusal}`, ...budget },
        { status: 503 }
      );
    }

    const want = Math.min(budget.handleCap, MAX_HANDLES_PER_RUN);
    const handles = await pendingHandles(want);

    if (handles.length === 0) {
      trackEvent('lookup_completed', {
        metadata: { eventSubtype: 'x_reachability_sweep', ok: true, checked: 0, caughtUp: true },
      }).catch(console.error);
      return NextResponse.json({ message: 'Nothing pending', checked: 0, caughtUp: true });
    }

    const progress = await sweepHandles(handles, key, {
      creditCap: budget.creditCap,
      deadlineAt: startedAt + WORKING_WINDOW_MS,
      controlEvery: CONTROL_EVERY,
    });

    /**
     * A run is a success when it resolved something. A run where every handle
     * failed reached the resolver and got nothing usable back, which is a
     * provider problem worth surfacing rather than a healthy tick.
     */
    const ok = progress.checked > 0 && progress.live + progress.notFound + progress.unavailable > 0;

    trackEvent('lookup_completed', {
      metadata: {
        eventSubtype: 'x_reachability_sweep',
        ok,
        requested: handles.length,
        ...progress,
        balanceBefore: budget.balance,
        daysLeft: budget.daysLeft,
        durationMs: Date.now() - startedAt,
      },
    }).catch(console.error);

    if (!ok) {
      return NextResponse.json(
        { message: 'Resolved nothing; the resolver returned no usable answers', ...progress },
        { status: 502 }
      );
    }
    return NextResponse.json({ message: 'ok', requested: handles.length, ...progress });
  } catch (error) {
    console.error('X reachability sweep cron error:', error);
    trackEvent('lookup_completed', {
      metadata: {
        eventSubtype: 'x_reachability_sweep',
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
    }).catch(console.error);
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 });
  }
}
