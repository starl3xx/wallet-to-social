/**
 * Three columns on `lookup_jobs`, so only one worker can hold a job, and a
 * job the platform keeps killing stops being retried.
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
 * job with one conditional UPDATE:
 *
 * - `leased_until`: until when the holder has the job. A claim succeeds only
 *   when no other holder's lease is live, so the cron tick and the kick the
 *   submit routes now fire can never start one job at once.
 * - `lease_token`: a fresh uuid per claim. Every write after the claim matches
 *   on it, so a holder that outlives its lease (a platform that suspends
 *   rather than kills) writes nothing over the holder that came after it.
 * - `slice_attempts`: claims since the job was last handed back. A slice the
 *   platform kills never hands back, so this counts kills in a row: each one
 *   halves the next slice, and after five the job is failed, unbilled, rather
 *   than retaken for as long as an upstream stays slow.
 *
 * ## Why columns and not `updated_at`
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
 * names every column in `db/schema.ts`, so without these columns every job
 * path fails. Two are nullable and the third has a constant default, which
 * Postgres adds without rewriting the table, so the code running now ignores
 * all three and adding them first is safe.
 *
 * ## Rollback
 *
 * ALTER TABLE lookup_jobs
 *   DROP COLUMN leased_until, DROP COLUMN lease_token, DROP COLUMN slice_attempts;
 *
 * Only after the code that reads them is reverted, for the reason above.
 *
 * DATABASE_URL: the owner role, and the direct endpoint rather than the pooler.
 */

import { neon } from '@neondatabase/serverless';

const EXPECTED: Record<
  string,
  { dataType: string; nullable: 'YES' | 'NO'; defaultIs?: string }
> = {
  leased_until: { dataType: 'timestamp with time zone', nullable: 'YES' },
  lease_token: { dataType: 'uuid', nullable: 'YES' },
  slice_attempts: { dataType: 'integer', nullable: 'NO', defaultIs: '0' },
};

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
   * All three are catalog changes (a constant default has not rewritten the
   * table since Postgres 11), but each still needs a brief exclusive lock on
   * a table the worker writes every minute. `lock_timeout` makes the ALTER
   * give up rather than queue every job query behind it, and SET LOCAL inside
   * the transaction means the setting cannot outlive it. One statement, so
   * the three land together or not at all.
   */
  console.log('lookup_jobs.leased_until, lease_token, slice_attempts');
  await sql.transaction([
    sql`SET LOCAL lock_timeout = '3s'`,
    sql`ALTER TABLE lookup_jobs
          ADD COLUMN IF NOT EXISTS leased_until timestamptz,
          ADD COLUMN IF NOT EXISTS lease_token uuid,
          ADD COLUMN IF NOT EXISTS slice_attempts integer NOT NULL DEFAULT 0`,
  ]);

  const cols = (await sql`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'lookup_jobs'
      AND column_name IN ('leased_until', 'lease_token', 'slice_attempts')
  `) as unknown as Array<{
    column_name: string;
    data_type: string;
    is_nullable: string;
    column_default: string | null;
  }>;

  let bad = false;
  for (const [name, want] of Object.entries(EXPECTED)) {
    const col = cols.find((c) => c.column_name === name);
    if (!col) {
      console.error(`lookup_jobs.${name} was not created.`);
      bad = true;
      continue;
    }
    if (
      col.data_type !== want.dataType ||
      col.is_nullable !== want.nullable ||
      (want.defaultIs !== undefined && col.column_default !== want.defaultIs)
    ) {
      console.error(
        `lookup_jobs.${name} exists with the wrong shape: ${col.data_type}, nullable ${col.is_nullable}, default ${col.column_default}.`
      );
      bad = true;
      continue;
    }
    console.log(`ok: lookup_jobs.${name} (${col.data_type})`);
  }
  if (bad) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
