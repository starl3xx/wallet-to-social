/**
 * The match gate: columns and the ledger index split.
 *
 * Run manually with the OWNER `DATABASE_URL`, against the DIRECT endpoint
 * (drop `-pooler` from the host; CLAUDE.md explains the shared-backend SET
 * hazard):
 *
 *   npx tsx --env-file=.env.local scripts/migrate-match-gate.ts
 *
 * What it does, all idempotent:
 *
 * 1. `lookup_jobs.matches_delivered` (int, null): the gate. Null means every
 *    match is the owner's; a number means the free allowance covered only
 *    that many and the serve routes lock the rest.
 * 2. `lookup_history.job_id` + `lookup_history.matches_delivered`: the same
 *    gate mirrored onto the saved lookup, plus the link an unlock uses to
 *    clear it. With an index on `job_id` for that clear.
 * 3. Splits `credit_ledger_job_idx`: the unique-per-job debit index becomes
 *    partial (`paid_from <> 'unlock'`) so an unlock can be a second debit on
 *    the same job, and `credit_ledger_job_unlock_idx` makes the unlock
 *    itself once-per-job. The swap runs inside one transaction so no window
 *    exists where a resumed job could double-charge.
 *
 * No new table, so no `migrate-grant-readonly.ts` follow-up. Run BEFORE
 * deploying the code that reads these columns.
 */
import { neon } from '@neondatabase/serverless';

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }
  if (databaseUrl.includes('-pooler')) {
    console.error(
      'DATABASE_URL points at the pooler. Run DDL against the direct endpoint (drop -pooler from the host).'
    );
    process.exit(1);
  }

  const sql = neon(databaseUrl);

  await sql`ALTER TABLE lookup_jobs ADD COLUMN IF NOT EXISTS matches_delivered integer`;
  console.log('lookup_jobs.matches_delivered: ok');

  await sql`ALTER TABLE lookup_history ADD COLUMN IF NOT EXISTS job_id uuid`;
  console.log('lookup_history.job_id: ok');

  await sql`ALTER TABLE lookup_history ADD COLUMN IF NOT EXISTS matches_delivered integer`;
  console.log('lookup_history.matches_delivered: ok');

  await sql`CREATE INDEX IF NOT EXISTS lookup_history_job_id_idx ON lookup_history (job_id)`;
  console.log('lookup_history_job_id_idx: ok');

  /**
   * The index swap, only if the live predicate does not already exclude
   * unlock rows. Checked for the predicate itself rather than for WHERE,
   * because production already carries a WHERE this migration did not write:
   * the live index reads `WHERE (job_id IS NOT NULL)`, drift the Drizzle
   * schema never recorded (found 2026-09-14, the first run of this script
   * skipped the swap on exactly that). The null clause is kept in the new
   * predicate; NULL job ids never conflict in a btree unique index either
   * way, it just keeps the index off the API-call rows.
   */
  const [jobIdx] = (await sql`
    SELECT indexdef FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'credit_ledger_job_idx'
  `) as unknown as Array<{ indexdef: string }>;

  if (!jobIdx) {
    console.error('credit_ledger_job_idx not found; refusing to guess.');
    process.exit(1);
  }

  if (jobIdx.indexdef.includes('unlock')) {
    console.log(
      'credit_ledger_job_idx: already excludes unlock, skipping swap'
    );
  } else {
    await sql.transaction([
      sql`DROP INDEX credit_ledger_job_idx`,
      sql`CREATE UNIQUE INDEX credit_ledger_job_idx ON credit_ledger (job_id) WHERE job_id IS NOT NULL AND paid_from <> 'unlock'`,
    ]);
    console.log('credit_ledger_job_idx: swapped to partial, unlock excluded');
  }

  await sql`CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_job_unlock_idx ON credit_ledger (job_id) WHERE paid_from = 'unlock'`;
  console.log('credit_ledger_job_unlock_idx: ok');

  // Verify: three columns, two partial indexes with the right predicates.
  const [cols] = (await sql`
    SELECT count(*)::int AS n FROM information_schema.columns
    WHERE table_name = 'lookup_jobs' AND column_name = 'matches_delivered'
       OR table_name = 'lookup_history' AND column_name IN ('job_id', 'matches_delivered')
  `) as unknown as Array<{ n: number }>;
  if (cols.n !== 3) {
    console.error(`expected 3 columns, found ${cols.n}`);
    process.exit(1);
  }

  const [idx] = (await sql`
    SELECT count(*)::int AS n FROM pg_indexes
    WHERE schemaname = 'public'
      AND (
        (indexname = 'credit_ledger_job_idx' AND indexdef LIKE '%<> ''unlock''%')
        OR (indexname = 'credit_ledger_job_unlock_idx' AND indexdef LIKE '%= ''unlock''%')
        OR indexname = 'lookup_history_job_id_idx'
      )
  `) as unknown as Array<{ n: number }>;
  if (idx.n !== 3) {
    console.error(`expected 3 indexes, found ${idx.n}`);
    process.exit(1);
  }

  console.log('verified: 3 columns, 3 indexes. Deploy the code next.');
}

main().catch((e) => {
  console.error('migration failed:', e);
  process.exit(1);
});
