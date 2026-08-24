/**
 * Move the Clanker scan frontier past a deploy that will never resolve.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/repair-clanker-checkpoint.ts <block>
 *   npx tsx --env-file=.env.local scripts/repair-clanker-checkpoint.ts <block> --apply
 *
 * Without `--apply` it reports what it would do and writes nothing.
 *
 * ## When this is the right tool
 *
 * Almost never. `DEAD_AFTER_ATTEMPTS` in `lib/clanker.ts` releases a stuck
 * frontier on its own after the resolver has denied an id on five separate
 * runs, and waiting five days costs only a repeated block range.
 *
 * This exists for the case where the wait is not affordable, because the tip is
 * about to pass `from + MAX_RUN_BLOCKS` and the sweep is days from going blind.
 * Reach for it then, and record why in the changelog.
 *
 * ## What it gives up
 *
 * Every deploy at or below `<block>` is skipped permanently: the range is never
 * scanned again. Check first that the links in it are not worth keeping. On
 * 2026-08-19 they were not, because the one skipped deploy carried a link the
 * same wallet had already established 104 blocks later in a well-formed deploy,
 * so the graph lost nothing.
 *
 * ## The one guarantee
 *
 * The checkpoint only ever moves FORWARD. Lowering it would re-ingest a range
 * idempotently, which is harmless, but it would also silently undo the run cap
 * and could park the frontier below the tip by more than a week, which is the
 * blind state this whole mechanism exists to prevent.
 */
import { neon } from '@neondatabase/serverless';

const STATE_KEY = 'clanker_scan';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const arg = process.argv[2];
  const target = Number(arg);
  if (!arg || !Number.isInteger(target) || target <= 0) {
    console.error('Usage: repair-clanker-checkpoint.ts <block> [--apply]');
    process.exit(1);
  }
  const apply = process.argv.includes('--apply');

  const sql = neon(url);
  const rows = (await sql`
    SELECT (value->>'lastBlock')::bigint AS last_block, updated_at
    FROM ingest_state WHERE name = ${STATE_KEY}
  `) as unknown as Array<{ last_block: string | null; updated_at: string }>;

  if (rows.length === 0) {
    console.error(`No ${STATE_KEY} checkpoint exists. Nothing to repair.`);
    process.exit(1);
  }

  const current = Number(rows[0].last_block);
  console.log(
    `current checkpoint : ${current} (updated ${rows[0].updated_at})`
  );
  console.log(`requested          : ${target}`);

  if (target <= current) {
    console.error(
      `\nRefused: ${target} is not ahead of ${current}. The checkpoint only moves forward.`
    );
    process.exit(1);
  }

  console.log(
    `skips              : blocks ${current + 1}-${target}, permanently`
  );

  if (!apply) {
    console.log('\nDry run. Re-run with --apply to write it.');
    return;
  }

  await sql`
    UPDATE ingest_state
    SET value = jsonb_build_object('lastBlock', ${target}::bigint), updated_at = now()
    WHERE name = ${STATE_KEY}
  `;

  const after = (await sql`
    SELECT (value->>'lastBlock')::bigint AS last_block
    FROM ingest_state WHERE name = ${STATE_KEY}
  `) as unknown as Array<{ last_block: string }>;
  console.log(`\nwritten. checkpoint is now ${Number(after[0].last_block)}.`);
}

main().catch((e) => {
  console.error('repair failed:', e);
  process.exit(1);
});
