/**
 * lifecycle_emails: record a failed send instead of erasing it.
 *
 * claimAndSend deleted its own claim when a send returned failure, which left
 * the account in exactly the state that made it eligible. Under the daily cron
 * that meant one retry a day. Under `/api/cron/welcome-first`, which runs
 * every five minutes, it is 288 attempts a day, per account, forever, with no
 * backoff and no ceiling, for
 * any failure that does not fix itself: an unverified sending domain, a
 * rotated EMAIL_UNSUBSCRIBE_SECRET, a provider outage.
 *
 * Three columns turn that into a bounded retry:
 *
 * - `attempts`   how many times a send has been tried for this (user, key)
 * - `failed_at`  when the last attempt failed; NULL means in flight or done
 * - `last_error` what the provider said, so the admin pane can show it
 *
 * The row now carries four distinct states, and every reader has to know which
 * one it is looking at:
 *
 *   confirmed_at set                     delivered
 *   failed_at NULL, confirmed_at NULL    claimed, in flight right now
 *   failed_at set, attempts < ceiling    failed, retry after the backoff
 *   failed_at set, attempts >= ceiling   dead, needs a person
 *
 * DATABASE_URL: the owner role, and the direct endpoint rather than the pooler.
 * No new table, so no migrate-grant-readonly entry: columns inherit the grants
 * already held on lifecycle_emails.
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

  await sql`ALTER TABLE lifecycle_emails ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE lifecycle_emails ADD COLUMN IF NOT EXISTS failed_at timestamp`;
  await sql`ALTER TABLE lifecycle_emails ADD COLUMN IF NOT EXISTS last_error text`;
  console.log('columns attempts, failed_at, last_error: ok');

  /**
   * Every existing row is a delivery: they were written after a successful
   * send, by the old order or by the confirmed backfill. One attempt each, and
   * none of them failed.
   */
  const backfilled = (await sql`
    UPDATE lifecycle_emails
    SET attempts = 1
    WHERE attempts = 0 AND confirmed_at IS NOT NULL
    RETURNING id
  `) as unknown as Array<{ id: string }>;
  console.log(`backfilled attempts=1 on ${backfilled.length} delivered row(s)`);

  /** The selection reads failed rows by key and age on every five-minute tick. */
  await sql`
    CREATE INDEX IF NOT EXISTS lifecycle_emails_retry_idx
    ON lifecycle_emails (email_key, failed_at)
    WHERE confirmed_at IS NULL
  `;
  console.log('index lifecycle_emails_retry_idx: ok');

  const [cols] = (await sql`
    SELECT count(*)::int AS n FROM information_schema.columns
    WHERE table_name = 'lifecycle_emails'
      AND column_name IN ('attempts', 'failed_at', 'last_error')
  `) as unknown as Array<{ n: number }>;
  const [bad] = (await sql`
    SELECT count(*)::int AS n FROM lifecycle_emails
    WHERE confirmed_at IS NOT NULL AND attempts = 0
  `) as unknown as Array<{ n: number }>;
  const [idx] = (await sql`
    SELECT count(*)::int AS n FROM pg_indexes
    WHERE tablename = 'lifecycle_emails'
      AND indexname = 'lifecycle_emails_retry_idx'
  `) as unknown as Array<{ n: number }>;

  if (cols.n !== 3 || idx.n !== 1 || bad.n !== 0) {
    console.error(
      `verification failed: columns=${cols.n} index=${idx.n} delivered-without-attempt=${bad.n} (expected 3, 1, 0)`
    );
    process.exit(1);
  }
  console.log('\nverified: three columns, one index, every delivered row counted');
}

main().catch((e) => {
  console.error('migration failed:', e);
  process.exit(1);
});
