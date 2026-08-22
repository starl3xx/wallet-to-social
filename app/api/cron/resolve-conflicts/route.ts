import { NextRequest, NextResponse } from 'next/server';
import {
  resolveUnreachableConflicts,
  DEFAULT_RECHECK_CREDITS,
} from '@/lib/conflict-resolution';
import { remainingCredits } from '@/lib/x-accounts';
import { isConfigured, resolverKey } from '@/lib/x-resolver';
import { RESERVE_CREDITS } from '@/lib/x-sweep-budget';
import { trackEvent } from '@/lib/analytics';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Resolve the handle conflicts that have only one honest reading, daily.
 *
 * Scheduled at 08:40 UTC, after the attested ingests (06:00 to 06:40) have
 * recorded today's conflicts and the reachability sweep (08:00) has had its
 * turn at the resolver. The rule and the write are in
 * `lib/conflict-resolution.ts`; this route supplies the budget and the record.
 *
 * ## Two budgets, and which one this is
 *
 * The reachability sweep sizes its spend to the money: a share of the balance
 * above the reserve, divided by the days until the allowance refills. This run
 * is a fixed small number, `CONFLICT_RECHECK_CREDITS`, default 300, because its
 * rechecks are a trickle over a queue the sweep already covers on its own
 * cycle, and a second formula-sized spender would compete with the first for
 * the same pool. What it does keep from the sweep is the floor: if the balance
 * cannot be read or sits at the reserve, nothing is re-checked. Acceptance
 * still runs, since it costs nothing.
 */
const CREDIT_CAP = Number(
  process.env.CONFLICT_RECHECK_CREDITS ?? DEFAULT_RECHECK_CREDITS
);

/** Leaves 60s of the route's 300s for the accept statements and the response. */
const WORKING_WINDOW_MS = 240_000;

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

  const startedAt = Date.now();

  try {
    let key = '';
    let creditCap = 0;
    let refusal: string | null = null;

    if (!isConfigured()) {
      refusal = 'X resolver is not configured';
    } else {
      key = resolverKey();
      const balance = await remainingCredits(key);
      if (balance === null) {
        refusal = 'could not read the credit balance';
      } else if (balance <= RESERVE_CREDITS) {
        refusal = `balance ${balance.toLocaleString()} is at or below the reserve of ${RESERVE_CREDITS.toLocaleString()}`;
      } else {
        creditCap = Math.max(
          0,
          Number.isFinite(CREDIT_CAP) ? CREDIT_CAP : DEFAULT_RECHECK_CREDITS
        );
      }
    }

    const outcome = await resolveUnreachableConflicts({
      key,
      creditCap,
      deadlineAt: startedAt + WORKING_WINDOW_MS,
    });

    /**
     * A run is a success when it wrote what qualified, whether or not that was
     * anything. A blocked recheck is worth seeing in the health panel but is
     * not a failure of this job: the rows wait, and nothing wrong was written.
     */
    trackEvent('lookup_completed', {
      metadata: {
        eventSubtype: 'handle_conflicts_resolve',
        ok: true,
        candidates: outcome.candidates,
        eligible: outcome.eligible,
        accepted: outcome.accepted,
        walletsUpdated: outcome.walletsUpdated,
        cacheRowsDeleted: outcome.cacheRowsDeleted,
        blocked: outcome.blocked,
        recheckWanted: outcome.recheck.wanted,
        recheckRequested: outcome.recheck.requested,
        recheckSkipped: refusal ?? outcome.recheck.skipped,
        creditsSpent: outcome.recheck.progress?.creditsSpent ?? 0,
        durationMs: Date.now() - startedAt,
      },
    }).catch(console.error);

    return NextResponse.json({
      message: 'ok',
      recheckRefused: refusal,
      ...outcome,
    });
  } catch (error) {
    console.error('Conflict resolution cron error:', error);
    trackEvent('lookup_completed', {
      metadata: {
        eventSubtype: 'handle_conflicts_resolve',
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
    }).catch(console.error);
    return NextResponse.json({ error: 'Resolution failed' }, { status: 500 });
  }
}
