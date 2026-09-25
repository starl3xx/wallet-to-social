import { serve } from 'inngest/next';
import { inngest } from '@/inngest/client';

/**
 * Registers no functions, deliberately (STA-44, 2026-09-24).
 *
 * This served `wallet-lookup`, a second copy of the lookup pipeline that every
 * job over ten addresses was sent to. The cron worker picked the same jobs up
 * each minute with no claim, finalized nearly all of them anyway, and the two
 * disagreed on stale graph rows, fast scans, agent fields, negatives and
 * suppression until each difference was found and mirrored by hand. The job
 * routes now kick the worker instead, and `processJobChunk` is the only
 * pipeline (asserted in scripts/check-invariants.ts).
 *
 * The endpoint stays so the Inngest app still syncs cleanly while any run
 * started before the deploy winds down: its next step finds no function and
 * ends without writing, and the worker takes the job once the run's last write
 * is a lease's length old. Once the Inngest dashboard shows no active runs,
 * this route, `inngest/client.ts`, the `inngest` package and the INNGEST_*
 * variables can all go.
 */
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [],
});
