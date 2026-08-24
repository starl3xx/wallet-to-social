/**
 * ENS text-record harvest CLI.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/ens-harvest.ts --backfill
 *   npx tsx --env-file=.env.local scripts/ens-harvest.ts --incremental
 *
 * --backfill     scan from block 7,000,000 (or the saved checkpoint if one
 *                exists) to the chain head — a few minutes on Alchemy
 * --incremental  scan from the saved checkpoint only (the daily cron does
 *                this automatically; the CLI form is for catch-up)
 *
 * Interrupt-safe: the checkpoint only advances after a chunk's nodes are
 * fully resolved and written.
 */

import {
  ENS_SCAN_START_BLOCK,
  getCheckpoint,
  harvestEnsTextRecords,
} from '../lib/ens-harvest';

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  if (!process.env.ALCHEMY_KEY) {
    console.warn(
      'ALCHEMY_KEY not set — falling back to a public RPC (slower, less reliable)'
    );
  }

  const mode = process.argv[2];
  const checkpoint = await getCheckpoint();

  let fromBlock: number;
  if (mode === '--backfill') {
    fromBlock = checkpoint ? checkpoint + 1 : ENS_SCAN_START_BLOCK;
  } else if (mode === '--incremental') {
    if (checkpoint === null) {
      console.error('No checkpoint found — run --backfill first');
      process.exit(1);
    }
    fromBlock = checkpoint + 1;
  } else {
    console.error('Usage: ens-harvest.ts --backfill | --incremental');
    process.exit(1);
  }

  console.log(
    `Harvesting ENS text records from block ${fromBlock.toLocaleString()}...`
  );
  const startTime = Date.now();

  const stats = await harvestEnsTextRecords(fromBlock, (msg) => {
    const elapsed = ((Date.now() - startTime) / 60000).toFixed(1);
    console.log(`  ${msg} | ${elapsed}m`);
  });

  console.log('\nDone:', JSON.stringify(stats, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
