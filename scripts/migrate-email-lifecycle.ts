/**
 * Migration: lifecycle email plumbing (opt-out flag and send ledger).
 *
 * Usage: npx tsx --env-file=.env.local scripts/migrate-email-lifecycle.ts
 *
 * Applied by hand rather than with drizzle-kit push, because production has
 * known drift from db/schema.ts on other tables and push would try to
 * reconcile those too. Idempotent: safe to run more than once.
 *
 * **Run this BEFORE deploying code that declares these in db/schema.ts.**
 * Drizzle selects every declared column, so a deploy ahead of the migration
 * fails every users read with `column email_opt_out does not exist` (the
 * twitter_renamed_from lesson, CHANGELOG 2026-08-22).
 *
 * After running, also run `scripts/migrate-grant-readonly.ts` with the owner
 * DATABASE_URL: lifecycle_emails is a new table, and a table created after
 * the role split inherits nothing, so CI's sweep_runner role cannot read it
 * until granted.
 */

import { neon } from '@neondatabase/serverless';

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required (must be the owner role)');
    process.exit(1);
  }

  const sql = neon(databaseUrl);

  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_opt_out boolean NOT NULL DEFAULT false`;
  console.log('column users.email_opt_out: ok');

  await sql`
    CREATE TABLE IF NOT EXISTS lifecycle_emails (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      email_key text NOT NULL,
      sent_at timestamp NOT NULL DEFAULT now()
    )`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS lifecycle_emails_user_key_idx ON lifecycle_emails (user_id, email_key)`;
  console.log('table lifecycle_emails: ok');

  const [col] = (await sql`
    SELECT count(*)::int AS n FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'email_opt_out'
  `) as unknown as Array<{ n: number }>;
  const [tbl] = (await sql`
    SELECT count(*)::int AS n FROM information_schema.tables
    WHERE table_name = 'lifecycle_emails'
  `) as unknown as Array<{ n: number }>;

  if (col.n !== 1 || tbl.n !== 1) {
    console.error(`verification failed: column=${col.n} table=${tbl.n}`);
    process.exit(1);
  }
  console.log('\nverified: column and table present');
  console.log('next: npx tsx --env-file=.env.local scripts/migrate-grant-readonly.ts');
}

main().catch((e) => {
  console.error('migration failed:', e);
  process.exit(1);
});
