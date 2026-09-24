/**
 * One nullable column on `lookup_jobs`, so only one worker can hold a job.
 *
 * ## Why
 *
 * Until STA-44, two pipelines worked a lookup job over ten addresses at the
 * same time: Inngest, which the submit routes sent it to, and the cron worker,
 * which picks up every `pending` or `processing` job each minute with no owner
 * check. Neither took a claim. `processJobChunk` read the row and then wrote
 * `status = 'processing'` unconditionally, so a second invocation (a later
 * tick while a slow chunk still ran, or the other pipeline) simply worked the
 * same wallets again. Measured over 30 days to 2026-09-24, the worker
 * finalized almost every such job anyway, and at least 9 of them ran through
 * both.
 *
 * Inngest is retired as a pipeline in the same change, and the worker claims a
 * job with one conditional UPDATE that sets this column. A claim succeeds only
 * when no other holder's lease is live, so the cron tick and the kick the
 * submit routes now fire can never run one job at once.
 *
 * ## Why a column and not `updated_at`
 *
 * A lease has to be handed back between slices, or the next tick waits out
 * the whole lease before it can start the next 3,000 wallets. `updated_at`
 * alone cannot say "released": the job is still `processing`, and the row was
 * just written. The x-list worker solved the same problem the same way
 * (`x_list_jobs.leased_until`).
 *
 * ## Order
 *
 * Run BEFORE the code that reads it deploys. `db.select().from(lookupJobs)`
 * names every column in `db/schema.ts`, so without this column every job path
 * fails. The column is nullable with no default, so the code running now
 * ignores it and adding it first is safe.
 *
 * ## Rollback
 *
 * ALTER TABLE lookup_jobs DROP COLUMN leased_until;
 *
 * Only after the code that reads it is reverted, for the reason above.
 *
 * DATABASE_URL: the owner role, and the direct endpoint rather than the pooler.
 */

import { neon } from '@neondatabase/serverless';

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required (must be the owner role)');
    process.exit(1);
  }
  if (databaseUrl.includes('-pooler')) {
    console.error(
      'Refusing to run against the pooler. Drop "-pooler" from the host.'
    );
    process.exit(1);
  }

  const sql = neon(databaseUrl);

  /**
   * Adding a nullable column is a catalog change, but it still needs a brief
   * exclusive lock on a table the worker writes every minute. `lock_timeout`
   * makes it give up rather than queue every job query behind it, and SET
   * LOCAL inside the transaction means the setting cannot outlive it.
   */
  console.log('lookup_jobs.leased_until');
  await sql.transaction([
    sql`SET LOCAL lock_timeout = '3s'`,
    sql`ALTER TABLE lookup_jobs ADD COLUMN IF NOT EXISTS leased_until timestamptz`,
  ]);

  const [col] = (await sql`
    SELECT data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'lookup_jobs' AND column_name = 'leased_until'
  `) as unknown as Array<{ data_type: string; is_nullable: string }>;
  if (!col) {
    console.error('lookup_jobs.leased_until was not created.');
    process.exit(1);
  }
  if (
    col.data_type !== 'timestamp with time zone' ||
    col.is_nullable !== 'YES'
  ) {
    console.error(
      `lookup_jobs.leased_until exists with the wrong shape: ${col.data_type}, nullable ${col.is_nullable}.`
    );
    process.exit(1);
  }

  console.log('ok: lookup_jobs.leased_until present (timestamptz, nullable)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
