import { NextRequest, NextResponse } from 'next/server';
import { runGraphRepairs, findUnrepairable } from '@/lib/graph-repair';
import { trackEvent } from '@/lib/analytics';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Weekly hygiene pass over `social_graph`.
 *
 * It fixes only rows that contradict themselves, where the correct value is
 * already in the row: an attestation flag with nothing to attest, a handle in a
 * casing reverse lookup will not match, a URL that disagrees with the handle
 * beside it. Every repair, its ceiling and its justification are in
 * `lib/graph-repair.ts`, which is also what `scripts/graph-repair.ts` runs, so
 * a hand run and the cron cannot diverge.
 *
 * What it will not do:
 *
 * - **Delete.** There is no DELETE anywhere in the repair set.
 * - **Guess.** An ENS name on two wallets, a Farcaster id under two usernames,
 *   a username with no id: each needs an answer from outside the row, so they
 *   are counted and reported rather than repaired.
 * - **Run away.** Each repair refuses above its own ceiling. A repair matching
 *   far more rows than it ever has means the predicate is broken, not that the
 *   data went bad overnight, and the response to that is to stop.
 *
 * Weekly rather than daily because the input is drift, and drift is slow: the
 * whole backlog after seven months of ingest was about 63,000 rows out of 4.75
 * million. A cleanup job that runs more often than its input changes is just a
 * way to be woken up by your own noise.
 *
 * GET is supported for a manual trigger and behaves identically, including the
 * secret check.
 */
export async function POST(request: NextRequest) {
  try {
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

    const run = await runGraphRepairs(true);
    const blocked = (await findUnrepairable()).filter((b) => b.count > 0);

    const refused = run.results.filter((r) => r.refused);
    const incomplete = run.results.filter((r) => r.incomplete);

    // A refusal or an incomplete repair is the interesting outcome, not the
    // happy path, so both are recorded as events rather than only logged. The
    // whole point of the ceiling is that somebody finds out it was hit.
    if (refused.length > 0 || incomplete.length > 0) {
      trackEvent('graph_repair_blocked', {
        metadata: {
          refused: refused.map((r) => ({
            id: r.id,
            found: r.found,
            reason: r.refused,
          })),
          incomplete: incomplete.map((r) => ({
            id: r.id,
            reason: r.incomplete,
          })),
        },
      });
    }

    if (run.totalChanged > 0) {
      trackEvent('graph_repair_applied', {
        metadata: {
          totalChanged: run.totalChanged,
          byRepair: run.results
            .filter((r) => r.changed > 0)
            .map((r) => ({ id: r.id, changed: r.changed })),
        },
      });
    }

    console.log(
      `Graph repair: ${run.totalChanged} rows changed, ${run.refusals} refused` +
        (blocked.length > 0
          ? `, ${blocked.reduce((s, b) => s + b.count, 0)} left for a live lookup`
          : '')
    );

    return NextResponse.json({
      changed: run.totalChanged,
      found: run.totalFound,
      refusals: run.refusals,
      repairs: run.results,
      needsLiveLookup: blocked,
    });
  } catch (error) {
    console.error('Graph repair error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Graph repair failed' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
