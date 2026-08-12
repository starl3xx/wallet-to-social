/**
 * Migration: generic ingest_state table for checkpointed ingest pipelines
 * (first user: the ENS text-record harvest's last-scanned block).
 *
 * Usage: npx tsx --env-file=.env.local scripts/migrate-ingest-state.ts
 *
 * Applied by hand instead of drizzle-kit push because of known schema drift
 * on other tables. Idempotent.
 */

import { neon } from '@neondatabase/serverless';

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const sql = neon(databaseUrl);

  await sql`
    CREATE TABLE IF NOT EXISTS ingest_state (
      name text PRIMARY KEY,
      value jsonb NOT NULL,
      updated_at timestamp NOT NULL DEFAULT now()
    )
  `;
  console.log('table ingest_state: ok');

  const rows = await sql`SELECT name, value, updated_at FROM ingest_state`;
  console.log('current state rows:', JSON.stringify(rows));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
