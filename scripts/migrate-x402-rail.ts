/**
 * The columns an onchain payment rail needs, and nothing more.
 *
 * ## `credit_lots.settlement_id` and `credit_lots.rail`
 *
 * A lot must be traceable to the payment that bought it, and a payment must be
 * grantable exactly once. `stripe_payment_id` already does both for Stripe,
 * through a unique index, and it must NOT be reused for onchain settlements:
 * `scripts/relaunch-report.ts` and `lib/analytics.ts` both read that column as
 * "this was a Stripe sale", and an x402 reference written into it would be
 * counted as card revenue by every query that looks.
 *
 * The settlement id is NOT the transaction hash. On a facilitator timeout the
 * hash is unknown, and a `settlement_pending` response can carry a hash for a
 * transaction that was broadcast and never mined. The key is the EIP-3009
 * authorization the payer signed, `<network>:<from>:<nonce>`, which is known
 * before settlement is attempted and which USDC itself refuses to honour twice
 * (`_authorizationStates[from][nonce]`). Replaying a payload therefore cannot
 * mint a second lot, and a retry after an indeterminate settle grants the same
 * lot rather than a second one.
 *
 * `rail` is left NULL on every existing row rather than backfilled. Every row
 * today is Stripe or a hand grant, and guessing which would be inventing data
 * in the one table that has to stay auditable. NULL means "predates the
 * column".
 *
 * ## `users.wallet` and `users.origin`
 *
 * Credits hang off `users.id` through five NOT NULL foreign keys, so a wallet
 * that pays needs a row. `wallet` is the identity (lowercased, unique) and
 * `origin` marks how the row came to exist, which several queries need to
 * exclude it: it is not a signup, it is not churn, and it must never be mailed.
 *
 * `email` stays NOT NULL and UNIQUE, so the row carries a synthetic address
 * under a reserved TLD that can never be delivered to. See lib/x402-account.ts.
 *
 * DATABASE_URL: the owner role, and the direct endpoint rather than the pooler.
 * No new table, so no migrate-grant-readonly entry: columns inherit the grants
 * already held on users and credit_lots.
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
      'Refusing to run against the pooler. Drop "-pooler" from the host: a bare SET on a pooled connection outlives this script on a shared backend.'
    );
    process.exit(1);
  }

  const sql = neon(databaseUrl);

  console.log('credit_lots: settlement_id, rail');
  await sql`ALTER TABLE credit_lots ADD COLUMN IF NOT EXISTS settlement_id text`;
  await sql`ALTER TABLE credit_lots ADD COLUMN IF NOT EXISTS rail text`;

  // Refuse rather than fail obscurely. A duplicate settlement_id means one
  // payment already minted two lots, which is a question to answer before a
  // schema change hides it behind a constraint error.
  const dupes = await sql`
    SELECT settlement_id, count(*) AS n
    FROM credit_lots
    WHERE settlement_id IS NOT NULL
    GROUP BY settlement_id
    HAVING count(*) > 1
  `;
  if (dupes.length > 0) {
    console.error(
      `Refusing to add the unique index: ${dupes.length} settlement_id value(s) already appear on more than one lot.`
    );
    for (const d of dupes) console.error(`  ${d.settlement_id} x${d.n}`);
    process.exit(1);
  }

  /**
   * Partial, so the column stays free for every Stripe and hand-issued lot.
   * A plain unique index would work too, since Postgres treats NULLs as
   * distinct, but saying WHERE NOT NULL states the intent rather than relying
   * on the reader knowing that rule.
   *
   * lock_timeout because CREATE UNIQUE INDEX takes ACCESS EXCLUSIVE, and a
   * migration that blocks on it blocks checkout. If the lock is unavailable the
   * statement aborts and nothing changed.
   */
  console.log('credit_lots: unique index on settlement_id');
  await sql`
    DO $$
    BEGIN
      SET LOCAL lock_timeout = '3s';
      CREATE UNIQUE INDEX IF NOT EXISTS credit_lots_settlement_idx
        ON credit_lots (settlement_id)
        WHERE settlement_id IS NOT NULL;
    END $$;
  `;

  console.log('users: wallet, origin');
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet text`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS origin text`;
  await sql`
    DO $$
    BEGIN
      SET LOCAL lock_timeout = '3s';
      CREATE UNIQUE INDEX IF NOT EXISTS users_wallet_idx
        ON users (wallet)
        WHERE wallet IS NOT NULL;
    END $$;
  `;

  // Verification. Exits non-zero if anything above did not take, because a
  // migration that reports success it cannot demonstrate is worse than one
  // that fails.
  const cols = await sql`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE (table_name = 'credit_lots' AND column_name IN ('settlement_id', 'rail'))
       OR (table_name = 'users' AND column_name IN ('wallet', 'origin'))
  `;
  const idx = await sql`
    SELECT indexname FROM pg_indexes
    WHERE indexname IN ('credit_lots_settlement_idx', 'users_wallet_idx')
  `;

  const wantCols = 4;
  const wantIdx = 2;
  console.log(`\ncolumns present: ${cols.length}/${wantCols}`);
  for (const c of cols) console.log(`  ${c.table_name}.${c.column_name}`);
  console.log(`indexes present: ${idx.length}/${wantIdx}`);
  for (const i of idx) console.log(`  ${i.indexname}`);

  if (cols.length !== wantCols || idx.length !== wantIdx) {
    console.error('\nMigration did not fully apply.');
    process.exit(1);
  }
  console.log('\nOK.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
