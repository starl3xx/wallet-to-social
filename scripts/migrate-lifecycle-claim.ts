/**
 * lifecycle_emails.confirmed_at: tell a claim apart from a send.
 *
 * claimAndSend takes the row before it sends, so the unique on
 * (user_id, email_key) acts as the lock rather than merely recording that two
 * runners raced. The cost is that a row no longer proves delivery: a process
 * killed between the INSERT and the send (timeout, OOM, a deploy mid-run)
 * leaves a claim nobody will ever redeem, and because every runner reads the
 * row as "already emailed", that person silently never receives the email.
 *
 * confirmed_at is written after the send returns success. A row with a NULL
 * confirmed_at older than the reclaim window is an abandoned claim, and
 * reclaimStaleClaims deletes it so the next run retries.
 *
 * Existing rows are backfilled to their own sent_at. They were written by the
 * old send-then-insert order, so every one of them is a real delivery, and
 * without the backfill the first reclaim would delete all of them and email
 * ~100 people a second time.
 *
 * DATABASE_URL: the owner role, and the direct endpoint rather than the
 * pooler. No new table, so no migrate-grant-readonly entry is needed: a column
 * inherits the grants already held on lifecycle_emails.
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
      'Refusing to run DDL through the pooler. Drop "-pooler" from the host.'
    );
    process.exit(1);
  }

  const sql = neon(databaseUrl);

  await sql`ALTER TABLE lifecycle_emails ADD COLUMN IF NOT EXISTS confirmed_at timestamp`;
  console.log('column lifecycle_emails.confirmed_at: ok');

  const backfilled = (await sql`
    UPDATE lifecycle_emails
    SET confirmed_at = sent_at
    WHERE confirmed_at IS NULL
    RETURNING id
  `) as unknown as Array<{ id: string }>;
  console.log(`backfilled confirmed_at on ${backfilled.length} existing row(s)`);

  await sql`
    CREATE INDEX IF NOT EXISTS lifecycle_emails_unconfirmed_idx
    ON lifecycle_emails (sent_at)
    WHERE confirmed_at IS NULL
  `;
  console.log('partial index lifecycle_emails_unconfirmed_idx: ok');

  const [col] = (await sql`
    SELECT count(*)::int AS n FROM information_schema.columns
    WHERE table_name = 'lifecycle_emails' AND column_name = 'confirmed_at'
  `) as unknown as Array<{ n: number }>;
  const [unconfirmed] = (await sql`
    SELECT count(*)::int AS n FROM lifecycle_emails WHERE confirmed_at IS NULL
  `) as unknown as Array<{ n: number }>;
  const [idx] = (await sql`
    SELECT count(*)::int AS n FROM pg_indexes
    WHERE tablename = 'lifecycle_emails'
      AND indexname = 'lifecycle_emails_unconfirmed_idx'
  `) as unknown as Array<{ n: number }>;

  if (col.n !== 1 || idx.n !== 1 || unconfirmed.n !== 0) {
    console.error(
      `verification failed: column=${col.n} index=${idx.n} unconfirmed=${unconfirmed.n} (expected 1, 1, 0)`
    );
    process.exit(1);
  }
  console.log('\nverified: column and index present, no row left unconfirmed');
}

main().catch((e) => {
  console.error('migration failed:', e);
  process.exit(1);
});
