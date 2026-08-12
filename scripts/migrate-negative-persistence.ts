/**
 * Migration: add last_checked_at to social_graph for negative-result persistence.
 *
 * Usage: npx tsx --env-file=.env.local scripts/migrate-negative-persistence.ts
 *
 * Applied by hand instead of drizzle-kit push because the production database
 * has known drift from db/schema.ts on other tables — push would try to
 * reconcile those too. Idempotent: safe to run more than once.
 *
 * Backfill sets last_checked_at = last_updated_at for existing rows, which are
 * all positives written at resolution time, so their last update is when they
 * were last checked.
 */

import { neon } from '@neondatabase/serverless';

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const sql = neon(databaseUrl);

  await sql`ALTER TABLE social_graph ADD COLUMN IF NOT EXISTS last_checked_at timestamp`;
  console.log('column last_checked_at: ok');

  const backfilled = await sql`
    UPDATE social_graph SET last_checked_at = last_updated_at WHERE last_checked_at IS NULL
  `;
  console.log('backfilled rows:', backfilled.length ?? '(count unavailable)');

  await sql`
    CREATE INDEX IF NOT EXISTS social_graph_last_checked_idx
    ON social_graph (last_checked_at)
  `;
  console.log('index social_graph_last_checked_idx: ok');

  const [check] = await sql`
    SELECT count(*)::int AS total,
           count(last_checked_at)::int AS with_checked
    FROM social_graph
  `;
  console.log('verify:', JSON.stringify(check));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
