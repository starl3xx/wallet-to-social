/**
 * Basename text-record harvest CLI.
 *
 * Reads `com.twitter` records written against `*.base.eth` names on Base L2
 * and hands the survivors to the shared attested-link ingest. The filters, the
 * measurements behind them and the reason this is a sibling of the ENS harvest
 * rather than a flag on it are all in `lib/basenames.ts`.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/harvest-basenames.ts --backfill
 *   npx tsx --env-file=.env.local scripts/harvest-basenames.ts --backfill --commit
 *   npx tsx --env-file=.env.local scripts/harvest-basenames.ts --incremental --commit
 *
 * Modes:
 *   --backfill      from the saved checkpoint, or from the first block that
 *                   ever carried one of these records if there is none
 *   --incremental   from the saved checkpoint only, and refuse without one
 *
 * Flags:
 *   --commit        write. WITHOUT IT THIS IS A DRY RUN: it resolves and
 *                   filters exactly as a real run does, reports what it would
 *                   write, and saves no checkpoint.
 *   --max-blocks N  stop after N blocks, so a first look can be bounded
 *   --from BLOCK    override the start block (ignores the checkpoint)
 *
 * Interrupt-safe: the checkpoint advances only after a chunk's candidates are
 * resolved and written, so an interrupted run repeats a chunk rather than
 * skipping one, and repeating is free because the ingest is fill-only.
 */

import {
  BASENAMES_SCAN_START_BLOCK,
  getCheckpoint,
  harvestBasenameRecords,
} from '../lib/basenames';

interface Args {
  mode: 'backfill' | 'incremental';
  commit: boolean;
  maxBlocks: number | null;
  from: number | null;
}

function parseArgs(argv: string[]): Args {
  let mode: Args['mode'] | null = null;
  const args: Omit<Args, 'mode'> = {
    commit: false,
    maxBlocks: null,
    from: null,
  };
  const takesValue = new Set(['--max-blocks', '--from']);

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--backfill' || flag === '--incremental') {
      mode = flag === '--backfill' ? 'backfill' : 'incremental';
      continue;
    }
    if (flag === '--commit') {
      args.commit = true;
      continue;
    }
    if (!takesValue.has(flag)) throw new Error(`Unknown flag: ${flag}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`${flag} needs a value`);
    }
    i++;
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) {
      throw new Error(`${flag} needs a positive integer`);
    }
    if (flag === '--max-blocks') args.maxBlocks = n;
    else args.from = n;
  }

  if (!mode) {
    throw new Error(
      'Usage: harvest-basenames.ts --backfill | --incremental [--commit] ' +
        '[--max-blocks N] [--from BLOCK]'
    );
  }
  return { mode, ...args };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  if (!process.env.ALCHEMY_KEY) {
    console.warn(
      'ALCHEMY_KEY not set, so this falls back to the public Base RPC. Two ' +
        'consequences, both real: the public endpoint caps every log query at ' +
        '10,000 blocks, which turns a whole-chain backfill from about 40 ' +
        'requests into about 5,000; and the registration-recency guard cannot ' +
        'run at all, so it is skipped and reported rather than silently passing.'
    );
  }

  const checkpoint = await getCheckpoint();

  let fromBlock: number;
  if (args.from !== null) {
    fromBlock = args.from;
  } else if (args.mode === 'backfill') {
    fromBlock =
      checkpoint !== null ? checkpoint + 1 : BASENAMES_SCAN_START_BLOCK;
  } else {
    if (checkpoint === null) {
      console.error('No checkpoint found. Run --backfill first.');
      process.exit(1);
    }
    fromBlock = checkpoint + 1;
  }

  console.log(
    `${args.commit ? 'COMMIT' : 'dry run'}: ${args.mode} from block ` +
      `${fromBlock.toLocaleString()}` +
      (checkpoint !== null
        ? ` (checkpoint ${checkpoint.toLocaleString()})`
        : ' (no checkpoint)') +
      (args.maxBlocks !== null
        ? `, at most ${args.maxBlocks.toLocaleString()} blocks`
        : '')
  );

  const startedAt = Date.now();
  /** A sample, not a log of every refusal: the counts already carry the totals. */
  const sampleRejects: string[] = [];
  const stats = await harvestBasenameRecords({
    fromBlock,
    maxBlocks: args.maxBlocks ?? undefined,
    dryRun: !args.commit,
    onProgress: (message) => {
      const elapsed = ((Date.now() - startedAt) / 60000).toFixed(1);
      console.log(`  ${message} | ${elapsed}m`);
    },
    onReject: (raw, reason) => {
      if (sampleRejects.length < 10)
        sampleRejects.push(`${reason}: ${raw.slice(0, 60)}`);
    },
  });

  console.log('\nDone:', JSON.stringify(stats, null, 2));

  if (sampleRejects.length > 0) {
    console.log(
      `\nSample of refused records (${stats.dropped.handleNumeric} numeric and ` +
        `${stats.dropped.handleMalformed} malformed in total):`
    );
    for (const value of sampleRejects)
      console.log(`  ${JSON.stringify(value)}`);
  }

  if (stats.registrationCheckSkipped) {
    console.warn(
      '\nThe registration-recency guard did not run on at least one chunk, so ' +
        'a record written by a previous owner of a reclaimed name could have ' +
        'survived. Re-run with ALCHEMY_KEY set to close it.'
    );
  }
  if (stats.budgetReached) {
    console.log(
      '\nStopped on the block budget rather than at the chain head. Re-run to ' +
        'continue from the checkpoint.'
    );
  }
  if (!args.commit) {
    console.log(
      '\nDry run: nothing written and no checkpoint saved. Re-run with ' +
        '--commit. (In a dry run "conflicts" counts the disagreements found.)'
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
