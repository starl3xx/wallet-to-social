/**
 * A column for where an account came from, kept away from the one that says
 * how it was created.
 *
 * ## The mistake this migration exists to undo
 *
 * The first version of this stored first-touch attribution in `users.origin`.
 * A query said that column held 139 rows and 139 nulls, which looked like an
 * unused field waiting for exactly this. It is not unused, it is unpopulated,
 * and those are different facts about different things.
 *
 * `users.origin` means **which rail created this account**, and `'x402'` is
 * load bearing: `getBalance` in `lib/credits.ts` reads it to withhold the free
 * allowance from a synthetic onchain account, and `lib/x402-account.ts` writes
 * it on insert. Storing `direct` or `ref:qr-auction` in the same field would
 * have conflated two meanings in one column, and because the attribution value
 * arrives in a request body, a posted `origin: "x402"` would have created a
 * magic-link account that silently never receives its 100 free matches.
 *
 * So attribution gets `users.acquisition`, and `origin` is left alone.
 *
 * ## What this does
 *
 * - `users.acquisition`, nullable. Where the browser that asked for the
 *   sign-in link first arrived from.
 * - `magic_link_tokens.acquisition`, nullable, renamed from the `origin`
 *   column an earlier run of this script created. The rename is guarded so
 *   this is safe to run against a database that has either, neither, or both.
 * - Asserts that `users.origin` still exists and is untouched.
 *
 * The value rides on the token because the two halves of a sign-in happen in
 * different browsers more often than is comfortable: the first touch is in the
 * localStorage of whatever typed the email, and the row is created by whatever
 * opens the mail, which is routinely a webmail preview or a link scanner.
 *
 * Nullable, and staying that way. Every row that exists predates this and
 * cannot be backfilled, and a sign-in from a browser with no stored first touch
 * is a normal event rather than an error.
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

  const has = async (table: string, column: string) => {
    const [row] = (await sql`
      SELECT count(*)::int AS n
      FROM information_schema.columns
      WHERE table_name = ${table} AND column_name = ${column}
    `) as unknown as Array<{ n: number }>;
    return row.n === 1;
  };

  console.log('users.acquisition');
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS acquisition text`;

  /**
   * The rename, guarded on both sides.
   *
   * An earlier run of this script created `magic_link_tokens.origin`. Renaming
   * only when the old column is present and the new one is not keeps this
   * runnable against a database in any of the three states.
   */
  const tokenOrigin = await has('magic_link_tokens', 'origin');
  const tokenAcquisition = await has('magic_link_tokens', 'acquisition');
  if (tokenOrigin && !tokenAcquisition) {
    console.log('magic_link_tokens.origin -> acquisition');
    await sql`ALTER TABLE magic_link_tokens RENAME COLUMN origin TO acquisition`;
  } else if (!tokenAcquisition) {
    console.log('magic_link_tokens.acquisition');
    await sql`ALTER TABLE magic_link_tokens ADD COLUMN IF NOT EXISTS acquisition text`;
  } else {
    console.log('magic_link_tokens.acquisition already present');
  }

  /**
   * `users.origin` is asserted, never created and never dropped.
   *
   * It carries the x402 marker that withholds the free allowance. A migration
   * that silently created it would mean this database disagrees with the one
   * the rail was written against, and that is worth stopping for rather than
   * papering over.
   */
  if (!(await has('users', 'origin'))) {
    console.error(
      'users.origin is missing. It carries the x402 rail marker; expected it to exist.'
    );
    process.exit(1);
  }

  if (!(await has('users', 'acquisition'))) {
    console.error('users.acquisition was not created.');
    process.exit(1);
  }
  if (!(await has('magic_link_tokens', 'acquisition'))) {
    console.error('magic_link_tokens.acquisition was not created.');
    process.exit(1);
  }
  if (await has('magic_link_tokens', 'origin')) {
    console.error(
      'magic_link_tokens.origin still exists. The rename did not happen.'
    );
    process.exit(1);
  }

  console.log(
    'ok: users.acquisition and magic_link_tokens.acquisition present, users.origin untouched'
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
