/**
 * x_accounts: remember WHEN a handle's reachability changed, before the first
 * recheck wave overwrites the evidence.
 *
 * `persist()` in `lib/x-accounts.ts` upserts reachability in place:
 * `status = EXCLUDED.status` with `checked_at = now()` on every check, changed
 * or not. Nothing records that a status moved. `social_graph_history` does not
 * cover this table: its `change_source` values are web3bio, graph, ens, neynar,
 * cache and manual, and reachability is none of them.
 *
 * That has cost nothing so far because there has been exactly one pass. Of
 * 474,140 rows, 409 were checked in the last seven days. **Rechecks begin
 * 2026-10-01** (`lib/x-accounts.ts`, the 45-day threshold), and the first wave
 * rewrites `status` in place for every handle whose reachability moved since
 * the first pass. Those transitions are not recoverable afterwards: the old
 * value is simply gone, and `checked_at` says only that somebody looked.
 *
 * This is the same shape as the `last_live_user_id` fix already recorded in
 * that upsert's comments, which was added because a suspended handle resolves
 * with no id and the old assignment destroyed the only durable identifier the
 * row had. Same wave, same first-recheck deadline, a different column.
 *
 * Two columns:
 *
 * - `status_changed_at`  when the status last actually moved. NULL means no
 *                        transition has ever been observed for this handle.
 * - `previous_status`    what it moved from. NULL for the same reason.
 *
 * ## Why NULL rather than a backfill
 *
 * Backfilling `status_changed_at = checked_at` would be convenient and false.
 * `checked_at` is when a handle was looked at, not when it changed, and every
 * current row was written by the first pass, which observed no transition at
 * all. Stamping a date there would manufacture 474,140 transitions that never
 * happened, on the one table whose job is to say when something moved. NULL is
 * the honest answer and it reads correctly: "no transition seen yet".
 *
 * DATABASE_URL: the owner role, and the direct endpoint rather than the pooler.
 * No new table, so no migrate-grant-readonly entry: columns inherit the grants
 * already held on x_accounts.
 */
import { neon } from '@neondatabase/serverless';

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  if (process.env.DATABASE_URL.includes('-pooler.')) {
    console.error(
      'Refusing to run against the pooler. Drop "-pooler" from the host: a\n' +
        'bare SET on a shared backend outlives the connection that set it.'
    );
    process.exit(1);
  }
  const sql = neon(process.env.DATABASE_URL);

  await sql`
    ALTER TABLE x_accounts
    ADD COLUMN IF NOT EXISTS status_changed_at timestamp
  `;
  console.log('column x_accounts.status_changed_at: ok');

  await sql`
    ALTER TABLE x_accounts
    ADD COLUMN IF NOT EXISTS previous_status text
  `;
  console.log('column x_accounts.previous_status: ok');

  /**
   * The index the change feed will read, and the reason this is not just two
   * columns. A watermark query wants "everything that moved since X" across
   * 474k rows; without it that is a sequential scan on every poll. Partial,
   * because a row that has never transitioned can never satisfy the predicate
   * and there are 474,140 of those on day one.
   */
  await sql`
    CREATE INDEX IF NOT EXISTS x_accounts_status_changed_at_idx
    ON x_accounts (status_changed_at)
    WHERE status_changed_at IS NOT NULL
  `;
  console.log('index x_accounts_status_changed_at_idx: ok');

  const [cols] = (await sql`
    SELECT count(*)::int AS n FROM information_schema.columns
    WHERE table_name = 'x_accounts'
      AND column_name IN ('status_changed_at', 'previous_status')
  `) as unknown as Array<{ n: number }>;
  const [idx] = (await sql`
    SELECT count(*)::int AS n FROM pg_indexes
    WHERE tablename = 'x_accounts'
      AND indexname = 'x_accounts_status_changed_at_idx'
  `) as unknown as Array<{ n: number }>;
  /**
   * Nothing may have been stamped by this migration. A non-zero count here
   * means somebody added a backfill, which is the one thing the header above
   * argues against: it would invent transitions that never happened.
   */
  const [stamped] = (await sql`
    SELECT count(*)::int AS n FROM x_accounts WHERE status_changed_at IS NOT NULL
  `) as unknown as Array<{ n: number }>;

  if (cols.n !== 2 || idx.n !== 1) {
    console.error(
      `verification failed: columns=${cols.n} index=${idx.n} (expected 2, 1)`
    );
    process.exit(1);
  }
  console.log(
    `\nverified: two columns, one partial index, ${stamped.n} rows carrying a transition`
  );
  if (stamped.n > 0) {
    console.log(
      'Rows already carry a transition, so this is a re-run after the upsert ' +
        'started recording. That is expected and not a backfill.'
    );
  }
}

main().catch((e) => {
  console.error('migration failed:', e);
  process.exit(1);
});
