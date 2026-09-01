/**
 * Farcaster protocol sweep — populate social_graph with FID → wallet mappings.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/farcaster-sweep.ts --full
 *   npx tsx --env-file=.env.local scripts/farcaster-sweep.ts --incremental
 *   npx tsx --env-file=.env.local scripts/farcaster-sweep.ts --range 1 50000
 *   npx tsx --env-file=.env.local scripts/farcaster-sweep.ts --auto
 *
 * --full         sweep FID 1 → network max (~3.3M FIDs ≈ 33k API calls ≈ 1
 *                hour at free-tier pacing; ~3.3M of the 10M monthly credits)
 * --incremental  sweep only FIDs above the highest fc_fid in social_graph
 * --range A B    sweep an explicit FID range (validation, backfill repair)
 * --slice        sweep this month's sixth of the network, then clean up its
 *                own revocations. The monthly cron mode.
 * --resume       continue the unfinished full sweep from its checkpoint
 * --auto         resume if there is a checkpoint, otherwise start a full sweep.
 *                This is what the monthly schedule runs.
 *
 * ## Why --auto exists
 *
 * A full sweep that exhausts the Neynar background ceiling stops partway and
 * records where. Before checkpointing, the next month's --full restarted from
 * FID 1, spent its budget re-covering ground, stopped in about the same place,
 * and left another ~580 MB seen table behind: the sweep could never finish, and
 * revocation cleanup could never run. --auto picks up where the last segment
 * stopped, carrying the same seen table and the original start timestamp, so
 * the segments together are equivalent to one uninterrupted sweep and cleanup
 * runs when the last one lands.
 *
 * Safe to interrupt and re-run: every batch upserts independently.
 * Scheduled monthly via .github/workflows/farcaster-sweep.yml; the daily
 * incremental runs as a Vercel cron (/api/cron/farcaster-sweep).
 */

import {
  beginSeenTracking,
  cleanupRevokedWallets,
  clearSweepCheckpoint,
  dropSeenTable,
  getMaxKnownFid,
  getNetworkMaxFid,
  monthlySliceRange,
  SWEEP_SLICES,
  isUsableCheckpoint,
  readSweepCheckpoint,
  sweepFidRange,
  writeSweepCheckpoint,
  type SweepCheckpoint,
} from '../lib/farcaster-sweep';

async function main() {
  const apiKey = process.env.NEYNAR_API_KEY;
  if (!apiKey || !process.env.DATABASE_URL) {
    console.error('NEYNAR_API_KEY and DATABASE_URL are required');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const mode = args[0];

  let startFid: number;
  let endFid: number;

  /**
   * A resume carries the previous segment's seen table, original start time and
   * cumulative counters. A fresh full sweep starts them.
   */
  let checkpoint: SweepCheckpoint | null = null;
  let effectiveMode = mode;

  if (mode === '--auto') {
    checkpoint = await readSweepCheckpoint();
    if (checkpoint && !isUsableCheckpoint(checkpoint)) {
      // A hand-edited or half-written checkpoint must not steer a sweep. The
      // shapes that matter are a missing, null, zero or string `nextFid`: each
      // sweeps nothing while looking like a completed run.
      console.warn(
        `Ignoring an unusable checkpoint: ${JSON.stringify(checkpoint)}`
      );
      await clearSweepCheckpoint();
      checkpoint = null;
    }
    effectiveMode = checkpoint ? '--resume' : '--full';
    console.log(
      checkpoint
        ? `Checkpoint found: resuming FID ${checkpoint.nextFid.toLocaleString()} → ${checkpoint.endFid.toLocaleString()} (segment ${checkpoint.segments + 1})`
        : 'No checkpoint: starting a full sweep'
    );
  } else if (mode === '--resume') {
    checkpoint = await readSweepCheckpoint();
    if (checkpoint && !isUsableCheckpoint(checkpoint)) {
      console.error(`Checkpoint is unusable: ${JSON.stringify(checkpoint)}`);
      process.exit(1);
    }
    if (!checkpoint) {
      console.error('No sweep checkpoint to resume. Run --full first.');
      process.exit(1);
    }
  }

  if (effectiveMode === '--resume' && checkpoint) {
    startFid = checkpoint.nextFid;
    endFid = checkpoint.endFid;
  } else if (mode === '--range' && args[1] && args[2]) {
    startFid = parseInt(args[1], 10);
    endFid = parseInt(args[2], 10);
  } else if (mode === '--incremental') {
    const maxKnown = await getMaxKnownFid();
    if (maxKnown === 0) {
      console.error('No swept FIDs in social_graph — run --full first');
      process.exit(1);
    }
    startFid = maxKnown + 1;
    console.log(`Probing network max FID (from ${maxKnown})...`);
    endFid = await getNetworkMaxFid(apiKey, maxKnown);
  } else if (mode === '--slice') {
    /**
     * One sixth of the network, chosen by the calendar month.
     *
     * The head is probed here rather than read from a constant, so the top
     * slice always ends on the real maximum and the partition grows with the
     * network. See monthlySliceRange.
     */
    const maxKnown = await getMaxKnownFid();
    console.log(`Probing network max FID (hint ${maxKnown || 1})...`);
    const networkMax = await getNetworkMaxFid(apiKey, Math.max(maxKnown, 1));
    const slice = monthlySliceRange(networkMax, new Date());
    startFid = slice.startFid;
    endFid = slice.endFid;
    console.log(
      `Monthly slice ${slice.index + 1} of ${SWEEP_SLICES}: FIDs ` +
        `${startFid.toLocaleString()} to ${endFid.toLocaleString()} ` +
        `(head ${networkMax.toLocaleString()})`
    );
  } else if (effectiveMode === '--full') {
    startFid = 1;
    const maxKnown = await getMaxKnownFid();
    console.log(`Probing network max FID (hint ${maxKnown || 1})...`);
    endFid = await getNetworkMaxFid(apiKey, Math.max(maxKnown, 1));
  } else {
    console.error(
      'Usage: farcaster-sweep.ts --full | --slice | --incremental | --resume | --auto | --range <start> <end>'
    );
    process.exit(1);
  }

  if (endFid < startFid) {
    console.log(`Nothing to sweep (start ${startFid} > end ${endFid})`);
    return;
  }

  const total = endFid - startFid + 1;
  console.log(
    `Sweeping FIDs ${startFid} → ${endFid} (${total.toLocaleString()} FIDs)`
  );
  const startTime = Date.now();
  const sweepStartedAt = new Date();
  let lastLoggedAt = 0;

  // Full sweeps see the entire network, so they can also detect revoked
  // verifications: track every wallet seen, clean up the unseen afterwards.
  // The tracking table is per-run so concurrent sweeps can't clobber it.
  /**
   * Only a sweep that intends to cover the whole range in ONE run tracks what
   * it saw, because only such a run may clean up afterwards.
   *
   * A resume deliberately does not track and cannot clean up. Carrying a seen
   * table across segments would let a final segment that silently returned
   * nothing pass cleanup's integrity guards on the strength of an earlier
   * segment's rows, and clear ~10^6 pure-sweep rows in the range it was
   * supposed to cover. See SweepCheckpoint in lib/farcaster-sweep.ts.
   */
  /**
   * Only a sweep that is working through the whole network keeps a checkpoint.
   *
   * `--range` and `--incremental` cover a span somebody else chose, so a
   * checkpoint from one of them is not a statement about the full sweep's
   * progress. Writing one anyway would let a `--range 1 50000` validation run
   * that happened to budget-stop overwrite a real full-sweep checkpoint with
   * its own narrow range; the next `--auto` would resume that tiny span,
   * "complete" it, clear the checkpoint, and the full sweep's progress would be
   * gone with nothing reporting it.
   */
  const tracksProgress =
    effectiveMode === '--full' || effectiveMode === '--resume';
  /**
   * A slice deliberately keeps no checkpoint. It is a span the calendar chose,
   * not progress through the network, and writing one would let next month's
   * `--auto` resume a sixth, "complete" it, and clear the real full-sweep
   * checkpoint. The same argument the comment above makes for `--range`.
   */

  /**
   * Which runs record what they saw, and therefore may clean up afterwards.
   *
   * A full sweep and a monthly slice both cover a known span completely in one
   * run, which is the only property cleanup needs now that its UPDATE is bounded
   * to that span. `--range` and `--incremental` are excluded: their spans are
   * chosen ad hoc, so a validation run over 50k FIDs would otherwise clear
   * revocations across a band nobody meant to audit.
   */
  const tracksSeen = effectiveMode === '--full' || effectiveMode === '--slice';
  const seenTable = tracksSeen ? await beginSeenTracking() : undefined;

  /**
   * Checkpoint as we go, not only when the budget stops us.
   *
   * The checkpoint used to be written in exactly one place: the budget-stop
   * branch below. Every other way a run can end wrote nothing, so a kill, a
   * crash, a lost network or a CI job timeout discarded the whole segment's
   * progress and the next `--auto` found no checkpoint and started again at
   * FID 1. That is not hypothetical twice over. The August 2026 run was
   * cancelled by hand at FID 2,396,590 and left no record, and a run started on
   * 2026-09-01 was killed after seconds and left none either; the resume point
   * had to be reconstructed from a memory note and written back by hand.
   *
   * Starting again at 1 is the expensive failure. A full sweep from 1 costs
   * more than the whole monthly background ceiling, so it can never reach the
   * FIDs above the last stop, and the newest FIDs stay unswept forever however
   * many times it runs.
   *
   * `lastFid` from `onProgress` is the FID the completed round covered up to,
   * so the next unswept FID is the one after it. Throttled to the same 25k
   * cadence as the log line, which at the measured rate is a write every few
   * minutes and at most 25k FIDs of repeated work after an abrupt end.
   */
  let lastCheckpointedAt = 0;
  let inFlightFid = startFid;
  const saveCheckpoint = async (nextFid: number) => {
    if (!tracksProgress) return;
    await writeSweepCheckpoint({
      nextFid,
      endFid,
      segments: (checkpoint?.segments ?? 0) + 1,
      startedAt: checkpoint?.startedAt ?? sweepStartedAt.toISOString(),
    });
  };

  /**
   * A signal must not lose the segment either.
   *
   * CI sends SIGTERM when a job is cancelled or times out, and Ctrl-C sends
   * SIGINT. Both previously ended the process between two throttled writes and
   * threw away up to 25k FIDs; more importantly, on a run that had not yet
   * reached its first throttled write, they threw away everything.
   */
  let signalled = false;
  const onSignal = (signal: string) => {
    if (signalled) return;
    signalled = true;
    console.warn(`\n${signal} received at FID ${inFlightFid.toLocaleString()}`);
    /**
     * The seen table dies with the run.
     *
     * It is only ever usable by a run that covered its whole span, and this run
     * did not. Nothing carries it across segments by design, so leaving it is
     * pure litter: a killed slice used to strand one permanently, and the
     * workflow comment already records a past incident of ~580 MB left behind
     * this way.
     *
     * **The checkpoint is written first.** Dropping first looked tidier and was
     * backwards: the sweep keeps inserting into the seen table until
     * `process.exit` runs, so a DROP racing those inserts makes one throw into
     * `main().catch`, which exits 1 before the resume point is ever written.
     * The table is litter; the resume point is a month of budget (found by
     * Bugbot). A drop that fails leaves one table behind and says so.
     */
    saveCheckpoint(inFlightFid)
      .then(() =>
        seenTable
          ? dropSeenTable(seenTable).catch((error) =>
              console.error('Seen-table drop failed:', error)
            )
          : undefined
      )
      .then(() => {
        if (tracksProgress) {
          console.warn(
            `Checkpoint saved. The next --auto run resumes from FID ${inFlightFid.toLocaleString()}.`
          );
        }
      })
      .catch((error) => console.error('Checkpoint write failed:', error))
      .finally(() => process.exit(130));
  };
  process.on('SIGINT', () => onSignal('SIGINT'));
  process.on('SIGTERM', () => onSignal('SIGTERM'));

  const stats = await sweepFidRange(
    startFid,
    endFid,
    apiKey,
    (s, lastFid) => {
      inFlightFid = lastFid + 1;
      const done = lastFid - startFid + 1;
      // Log roughly every 25k FIDs
      if (done - lastLoggedAt >= 25000 || lastFid >= endFid) {
        lastLoggedAt = done;
        const pct = ((done / total) * 100).toFixed(1);
        const elapsed = ((Date.now() - startTime) / 60000).toFixed(1);
        console.log(
          `  ${pct}% (fid ${lastFid.toLocaleString()}) | ` +
            `${s.fidsWithEthAddress.toLocaleString()} FIDs with wallets | ` +
            `${s.walletsUpserted.toLocaleString()} wallets upserted | ` +
            `${s.failedCalls} failed calls | ${elapsed}m elapsed`
        );
      }
      // Same cadence, separate counter: a checkpoint that rode on the log's
      // `lastLoggedAt` would stop being written the moment somebody changed the
      // log's condition, and nothing would report that it had.
      if (done - lastCheckpointedAt >= 25000 && lastFid < endFid) {
        lastCheckpointedAt = done;
        void saveCheckpoint(lastFid + 1).catch((error) =>
          console.error('Checkpoint write failed:', error)
        );
      }
    },
    { seenTable }
  );

  console.log('\nDone:', JSON.stringify(stats, null, 2));
  if (stats.failedCalls > 0) {
    console.warn(
      `${stats.failedCalls} API calls failed after retries — affected FID batches were skipped; re-run the range or wait for the next full sweep`
    );
  }

  /**
   * Only a sweep that is working through the whole network keeps a checkpoint.
   *
   * `--range` and `--incremental` cover a span somebody else chose, so a
   * checkpoint from one of them is not a statement about the full sweep's
   * progress. Writing one anyway would let a `--range 1 50000` validation run
   * that happened to budget-stop overwrite a real full-sweep checkpoint with
   * its own narrow range; the next `--auto` would resume that tiny span,
   * "complete" it, clear the checkpoint, and the full sweep's progress would be
   * gone with nothing reporting it.
   */
  if (stats.budgetStopped) {
    console.warn(
      `\nSweep stopped early on the Neynar credit budget: ${stats.budgetReason}` +
        (tracksProgress
          ? '\nA checkpoint is saved below; the next --auto run resumes from it.'
          : `\nResume with: npx tsx --env-file=.env.local scripts/farcaster-sweep.ts --range ${stats.budgetStoppedAtFid} ${endFid}`)
    );
  }

  const segments = (checkpoint?.segments ?? 0) + 1;

  /**
   * Every FID from startFid to endFid was actually requested.
   *
   * "Did not budget-stop" is not the same as "covered the range", and cleanup
   * treats them as the same thing. `fidsRequested` is the only direct evidence
   * of coverage, so it is checked rather than inferred.
   */
  const expectedFids = endFid - startFid + 1;
  const coveredRange = stats.fidsRequested >= expectedFids;

  if (
    tracksProgress &&
    stats.budgetStopped &&
    stats.budgetStoppedAtFid !== undefined
  ) {
    // `!== undefined`, not truthiness: FID 0 is falsy and would fall through to
    // the completion branch, which is the one that may clean up.
    await writeSweepCheckpoint({
      nextFid: stats.budgetStoppedAtFid,
      endFid,
      segments,
      startedAt: checkpoint?.startedAt ?? sweepStartedAt.toISOString(),
    });
    if (seenTable) {
      /**
       * Drop it now rather than leaking it.
       *
       * This table can never be used again: cleanup only runs for a sweep that
       * covers the whole range in one run, and this run did not. Keeping it
       * "for forensics" is what left 3,676,509 rows and 580 MB sitting in the
       * database for eleven days, and would have left another every month.
       */
      await dropSeenTable(seenTable);
    }
    console.warn(
      `\nCheckpoint saved: stopped at FID ${stats.budgetStoppedAtFid.toLocaleString()} of ${endFid.toLocaleString()} ` +
        `(segment ${segments}). The next --auto resumes there.\n` +
        `Revocation cleanup does not run for a resumed sweep; see SweepCheckpoint.`
    );
  } else if (tracksSeen && seenTable) {
    // A single-run sweep that covered its whole range: a full sweep, or one
    // monthly slice. Either may clean up, because cleanup is now bounded to the
    // span that was actually swept.
    if (stats.failedCalls === 0 && coveredRange) {
      const cleanup = await cleanupRevokedWallets(
        sweepStartedAt,
        seenTable,
        stats.walletsUpserted,
        // The range this run actually requested every FID of, checked above.
        // Passing the span rather than a boolean is what bounds the UPDATE, so
        // a slice can clean up its own FIDs and nothing else.
        { startFid, endFid }
      );
      console.log(
        `Revocation cleanup: cleared ${cleanup.cleared} wallets, deleted ${cleanup.deleted} empty rows`
      );
    } else {
      await dropSeenTable(seenTable);
      console.warn(
        `Skipping revocation cleanup — ${stats.failedCalls} failed call(s), ` +
          `${stats.fidsRequested.toLocaleString()} of ${expectedFids.toLocaleString()} FIDs requested. ` +
          `A partial seen set would be misread as revocations. Seen table dropped.`
      );
    }
    /**
     * Only a full sweep clears the full-sweep checkpoint.
     *
     * This branch used to be full-sweep exclusive, so an unconditional clear
     * was correct. Widening the gate to `tracksSeen` quietly handed the same
     * clear to the monthly slice, which would have wiped an in-progress
     * `--full` or `--auto` resume point every month: the exact failure the
     * "a slice writes no checkpoint" comments were written to prevent, arriving
     * through the other door (found by Bugbot).
     *
     * A slice has no relationship to that checkpoint. It neither writes one nor
     * reads one, so it must not clear one either.
     */
    if (effectiveMode === '--full') await clearSweepCheckpoint();
  } else if (effectiveMode === '--resume') {
    // Reached the end of the range. Nothing to clean up (a resume never
    // tracked), so the checkpoint has simply done its job.
    await clearSweepCheckpoint();
    console.log(
      `\nRange complete after ${segments} segment(s). Checkpoint cleared.\n` +
        `Revocation cleanup did not run: it requires a sweep that covers the ` +
        `whole range in one run. Run --full when the budget allows one.`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
