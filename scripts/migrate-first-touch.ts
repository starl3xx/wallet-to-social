/**
 * One nullable column on `magic_link_tokens`, so an account can remember where
 * its owner came from.
 *
 * ## Why the column is here and not on `users`
 *
 * `users.origin` already exists. What is missing is a way to get a value into
 * it, because of when the two halves of a sign-in happen in different places.
 *
 * The browser that knows the first touch is the one that filled in the email
 * box: the value is in its `localStorage`. The browser that creates the user
 * row is whichever one opens the link in the mail, and that is routinely a
 * different browser, a webmail preview, or a link scanner. Reading the first
 * touch at `/api/auth/verify` would therefore attribute a share of accounts to
 * whatever opened the email, which is worse than null because it looks like
 * data.
 *
 * So the origin travels with the token: recorded when the link is requested, by
 * the browser that has it, and read when the link is spent.
 *
 * ## Nullable, and staying that way
 *
 * Every row that exists predates this and cannot be backfilled, and a sign-in
 * from a browser with no stored first touch is a normal event rather than an
 * error. `NOT NULL` here would mean inventing a value for both.
 *
 * `magic_link_tokens` already carries an email address and is already covered
 * by the sign-in retention sweep in `/api/cron/cleanup`, so this adds a field
 * to a row that is already deleted on a schedule rather than creating a new
 * place where anything lives forever.
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

  console.log('magic_link_tokens.origin');
  await sql`
    ALTER TABLE magic_link_tokens
    ADD COLUMN IF NOT EXISTS origin text
  `;

  // users.origin has existed since the table did. Asserted rather than created,
  // because a migration that silently creates a column it expected to find is
  // how two environments drift into disagreeing about what the schema is.
  const [{ present }] = (await sql`
    SELECT count(*)::int AS present
    FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'origin'
  `) as unknown as Array<{ present: number }>;
  if (present !== 1) {
    console.error('users.origin is missing. Expected it to already exist.');
    process.exit(1);
  }

  const [{ ok }] = (await sql`
    SELECT count(*)::int AS ok
    FROM information_schema.columns
    WHERE table_name = 'magic_link_tokens' AND column_name = 'origin'
  `) as unknown as Array<{ ok: number }>;
  if (ok !== 1) {
    console.error('magic_link_tokens.origin was not created.');
    process.exit(1);
  }

  console.log('ok: magic_link_tokens.origin present, users.origin present');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
