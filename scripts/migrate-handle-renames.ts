/**
 * Migration: a column that remembers the handle a wallet used to serve.
 *
 * Usage: npx tsx --env-file=.env.local scripts/migrate-handle-renames.ts
 *
 * Applied by hand rather than with drizzle-kit push, because production has
 * known drift from db/schema.ts on other tables and push would try to reconcile
 * those too. Idempotent: safe to run more than once. No grant is needed:
 * `social_graph` was granted to `sweep_runner` at the role split, and a new
 * column on a granted table inherits the table's grants.
 *
 * ## Why a column and not a history row
 *
 * `lib/conflict-resolution.ts` replaces a stored X handle when it reaches
 * nobody on a recent check and an attested source names a live account for the
 * same wallet. Measured on the open queue on 2026-08-22: 1,602 of 2,914
 * conflicts are that shape, and in 1,598 of them the source also supplies the
 * numeric id of the live account, which matches.
 *
 * The old handle is worth keeping on the row, not only in an audit table,
 * because it is still out there. Farcaster records a verified X account as a
 * string captured once, and it goes on offering the dead string to every
 * writer that reads it: the monthly full sweep, and any lookup that reaches
 * the Farcaster API. A writer that finds its incoming handle in this column is
 * looking at the value we already know to be stale, and that comparison only
 * works if the value sits beside the handle it replaced.
 */

import { neon } from '@neondatabase/serverless';

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required (must be the owner role)');
    process.exit(1);
  }

  const sql = neon(databaseUrl);

  await sql`ALTER TABLE social_graph ADD COLUMN IF NOT EXISTS twitter_renamed_from text`;
  console.log('column social_graph.twitter_renamed_from: ok');

  const [cols] = (await sql`
    SELECT count(*)::int AS n
    FROM information_schema.columns
    WHERE table_name = 'social_graph' AND column_name = 'twitter_renamed_from'
  `) as unknown as Array<{ n: number }>;

  if (cols.n !== 1) {
    console.error(`verification failed: column=${cols.n}`);
    process.exit(1);
  }
  console.log('\nverified: column present');
}

main().catch((e) => {
  console.error('migration failed:', e);
  process.exit(1);
});
