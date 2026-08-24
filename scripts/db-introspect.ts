/**
 * Read-only schema introspection.
 *
 * Usage: npx tsx --env-file=.env.local scripts/db-introspect.ts
 *
 * Prints the live column list for the tables this project cares about, so
 * scripts can be written against what the database actually has rather than
 * what db/schema.ts declares. Runs SELECT statements only.
 */

import { neon } from '@neondatabase/serverless';

const TABLES = [
  'lookup_jobs',
  'lookup_history',
  'social_graph',
  'users',
  'analytics_events',
  'wallet_cache',
];

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const sql = neon(databaseUrl);

  const allTables = await sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `;
  console.log('TABLES IN DB:', allTables.map((t) => t.table_name).join(', '));

  for (const table of TABLES) {
    const cols = await sql`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${table}
      ORDER BY ordinal_position
    `;
    if (cols.length === 0) {
      console.log(`\n--- ${table}: NOT PRESENT ---`);
      continue;
    }
    console.log(`\n--- ${table} ---`);
    console.log(
      cols.map((c) => `${c.column_name} (${c.data_type})`).join('\n')
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
