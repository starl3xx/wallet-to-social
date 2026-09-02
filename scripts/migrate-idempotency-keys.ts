/**
 * One row per Idempotency-Key sent to `POST /v1/batch`, so a retried batch
 * replays its stored response instead of resolving and billing again.
 *
 * Usage: npx tsx scripts/migrate-idempotency-keys.ts
 * (DATABASE_URL must be the owner role, on the direct endpoint. Run BEFORE
 * deploying the batch route that writes this table.)
 *
 * The primary key is (key_id, idem_key): idempotency keys are scoped to the
 * credential that sent them, so no caller can replay another's response.
 * `body_hash` pins the key to the body it arrived with; `response` is NULL
 * when the original response was too large to replay. Rows expire after 24
 * hours (`IDEMPOTENCY_TTL_HOURS` in lib/idempotency.ts) and the cleanup cron
 * deletes them, so the table stays a day's worth of retries, never an archive.
 *
 * NOT a backup table: every row is worthless a day after it is written, and a
 * restore would resurrect replayable responses for keys already retried. It
 * goes in READ_ONLY_TABLES so CI can read it, and nowhere near BACKUP_TABLES.
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

  console.log('idempotency_keys');
  await sql`
    CREATE TABLE IF NOT EXISTS idempotency_keys (
      key_id uuid NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
      idem_key text NOT NULL,
      body_hash text NOT NULL,
      response jsonb,
      status integer NOT NULL,
      created_at timestamp NOT NULL DEFAULT now(),
      PRIMARY KEY (key_id, idem_key)
    )
  `;
  // For the cleanup cron's age sweep.
  await sql`
    CREATE INDEX IF NOT EXISTS idempotency_keys_created_idx
      ON idempotency_keys (created_at)
  `;

  const cols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'idempotency_keys'
  `;
  const idx = await sql`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'idempotency_keys'
  `;

  console.log(`\ncolumns: ${cols.length}/6`);
  for (const c of cols) console.log(`  ${c.column_name}`);
  console.log(`indexes: ${idx.length}/2`);
  for (const i of idx) console.log(`  ${i.indexname}`);

  if (cols.length !== 6 || idx.length !== 2) {
    console.error('\nMigration did not fully apply.');
    process.exit(1);
  }
  console.log('\nOK. Now add idempotency_keys to READ_ONLY_TABLES in');
  console.log(
    'scripts/migrate-grant-readonly.ts and run it with the owner role.'
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
