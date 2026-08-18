/**
 * Migration: a table for what an X handle currently resolves to.
 *
 * Usage: npx tsx --env-file=.env.local scripts/migrate-x-accounts.ts
 *
 * NOTE: a new table also needs a grant. CI connects as `sweep_runner`,
 * which was granted when the role split was made and inherits nothing
 * afterwards, so `scripts/migrate-grant-readonly.ts` must list any table a
 * check reads. This was found when the published-figures check failed with
 * "permission denied for table x_accounts" while passing locally.
 *
 * Applied by hand rather than with drizzle-kit push, because production has
 * known drift from db/schema.ts on other tables. Idempotent.
 *
 * Keyed by handle, not by wallet. 1,143,547 rows carry a handle but there are
 * only 446,043 distinct handles, so a per-row design would pay 2.58 times over
 * for the same answer, and "does this string reach anyone" is a fact about the
 * string rather than about a wallet.
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
    CREATE TABLE IF NOT EXISTS x_accounts (
      handle              text        PRIMARY KEY,
      user_id             text,
      display_name        text,
      followers           integer,
      -- 'live' | 'not_found' | 'unavailable'. Kept apart on purpose: a freed
      -- handle may already belong to somebody else, while a suspended account
      -- still belongs to the same person and may return.
      status              text        NOT NULL,
      unavailable_reason  text,
      checked_at          timestamp   NOT NULL DEFAULT now()
    )
  `;
  console.log('table x_accounts: ok');

  // The sweep's own resume query orders by this.
  await sql`CREATE INDEX IF NOT EXISTS x_accounts_checked_at_idx ON x_accounts (checked_at)`;
  console.log('index x_accounts_checked_at_idx: ok');

  // Partial: the interesting rows are the minority, and reads always filter.
  await sql`
    CREATE INDEX IF NOT EXISTS x_accounts_unreachable_idx
    ON x_accounts (status) WHERE status <> 'live'
  `;
  console.log('index x_accounts_unreachable_idx: ok');

  // The rename detector joins on this: an attested id that no longer matches
  // the id the handle now resolves to.
  await sql`
    CREATE INDEX IF NOT EXISTS x_accounts_user_id_idx
    ON x_accounts (user_id) WHERE user_id IS NOT NULL
  `;
  console.log('index x_accounts_user_id_idx: ok');

  const [t] = (await sql`
    SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = 'x_accounts'
  `) as unknown as Array<{ n: number }>;
  if (t.n !== 1) {
    console.error('verification failed: table missing');
    process.exit(1);
  }

  const [work] = (await sql`
    SELECT count(DISTINCT lower(twitter_handle))::int AS handles
    FROM social_graph WHERE twitter_handle IS NOT NULL
  `) as unknown as Array<{ handles: number }>;
  console.log(
    `\nverified. ${work.handles.toLocaleString()} distinct handles to resolve ` +
      `(${(work.handles * 18).toLocaleString()} credits at the by-name price)`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
