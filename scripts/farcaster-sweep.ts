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
  } else if (effectiveMode === '--full') {
    startFid = 1;
    const maxKnown = await getMaxKnownFid();
    console.log(`Probing network max FID (hint ${maxKnown || 1})...`);
    endFid = await getNetworkMaxFid(apiKey, Math.max(maxKnown, 1));
  } else {
    console.error(
      'Usage: farcaster-sweep.ts --full | --incremental | --resume | --auto | --range <start> <end>'
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
  const isFull = effectiveMode === '--full';
  const seenTable = isFull ? await beginSeenTracking() : undefined;

  const stats = await sweepFidRange(
    startFid,
    endFid,
    apiKey,
    (s, lastFid) => {
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
    },
    { seenTable }
  );

  console.log('\nDone:', JSON.stringify(stats, null, 2));
  if (stats.failedCalls > 0) {
    console.warn(
      `${stats.failedCalls} API calls failed after retries — affected FID batches were skipped; re-run the range or wait for the next full sweep`
    );
  }

  if (stats.budgetStopped) {
    console.warn(
      `\nSweep stopped early on the Neynar credit budget: ${stats.budgetReason}\n` +
        `Resume with: npx tsx --env-file=.env.local scripts/farcaster-sweep.ts --range ${stats.budgetStoppedAtFid} ${endFid}`
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

  if (stats.budgetStopped && stats.budgetStoppedAtFid !== undefined) {
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
  } else if (isFull && seenTable) {
    // A single-run full sweep: the only shape that may clean up, and the
    // semantics are exactly what they were before checkpointing existed.
    if (stats.failedCalls === 0 && coveredRange) {
      const cleanup = await cleanupRevokedWallets(
        sweepStartedAt,
        seenTable,
        stats.walletsUpserted,
        true
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
    await clearSweepCheckpoint();
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
