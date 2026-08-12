/**
 * Farcaster protocol sweep — populate social_graph with FID → wallet mappings.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/farcaster-sweep.ts --full
 *   npx tsx --env-file=.env.local scripts/farcaster-sweep.ts --incremental
 *   npx tsx --env-file=.env.local scripts/farcaster-sweep.ts --range 1 50000
 *
 * --full         sweep FID 1 → network max (~3.3M FIDs ≈ 33k API calls ≈ 1
 *                hour at free-tier pacing; ~3.3M of the 10M monthly credits)
 * --incremental  sweep only FIDs above the highest fc_fid in social_graph
 * --range A B    sweep an explicit FID range (validation, backfill repair)
 *
 * Safe to interrupt and re-run: every batch upserts independently.
 * Scheduled monthly via .github/workflows/farcaster-sweep.yml; the daily
 * incremental runs as a Vercel cron (/api/cron/farcaster-sweep).
 */

import {
  getMaxKnownFid,
  getNetworkMaxFid,
  sweepFidRange,
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

  if (mode === '--range' && args[1] && args[2]) {
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
  } else if (mode === '--full') {
    startFid = 1;
    const maxKnown = await getMaxKnownFid();
    console.log(`Probing network max FID (hint ${maxKnown || 1})...`);
    endFid = await getNetworkMaxFid(apiKey, Math.max(maxKnown, 1));
  } else {
    console.error('Usage: farcaster-sweep.ts --full | --incremental | --range <start> <end>');
    process.exit(1);
  }

  if (endFid < startFid) {
    console.log(`Nothing to sweep (start ${startFid} > end ${endFid})`);
    return;
  }

  const total = endFid - startFid + 1;
  console.log(`Sweeping FIDs ${startFid} → ${endFid} (${total.toLocaleString()} FIDs)`);
  const startTime = Date.now();
  let lastLoggedAt = 0;

  const stats = await sweepFidRange(startFid, endFid, apiKey, (s, lastFid) => {
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
  });

  console.log('\nDone:', JSON.stringify(stats, null, 2));
  if (stats.failedCalls > 0) {
    console.warn(
      `${stats.failedCalls} API calls failed after retries — affected FID batches were skipped; re-run the range or wait for the next full sweep`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
