/**
 * One row per redeemed recovery challenge, so a challenge is single-use.
 *
 * The challenge itself is a stateless HMAC and needs no storage to verify. What
 * needs storage is the fact that it has been spent.
 *
 * Without this, a signed challenge works for its whole five-minute window and
 * anyone who sees the redeem request can replay it from their own connection
 * and receive their own key in their own response. They never need to read the
 * victim's reply, which is what the first version of this feature assumed they
 * would have to do. With the three-key cap and no revoke path for a wallet
 * account, a replayer can also fill the cap and lock the buyer out of the
 * recovery they were trying to use.
 *
 * The token hash rather than the token: this table is in the nightly dump, and
 * a dump that carries live credentials is a credential store nobody meant to
 * build. The hash is enough to recognise a replay.
 *
 * Rows are written only after a signature has already verified, so an
 * unauthenticated caller cannot grow this table.
 *
 * DATABASE_URL: the owner role, and the direct endpoint rather than the pooler.
 * New table, so it also needs an entry in scripts/migrate-grant-readonly.ts,
 * which this migration does not do for you.
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

  console.log('x402_recovery_redemptions');
  await sql`
    CREATE TABLE IF NOT EXISTS x402_recovery_redemptions (
      token_hash text PRIMARY KEY,
      wallet text NOT NULL,
      redeemed_at timestamp NOT NULL DEFAULT now(),
      expires_at timestamp NOT NULL
    )
  `;
  // The sweep that keeps it small. A redemption is only interesting until the
  // challenge it spent would have expired anyway.
  await sql`
    CREATE INDEX IF NOT EXISTS x402_recovery_redemptions_expires_idx
      ON x402_recovery_redemptions (expires_at)
  `;

  const cols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'x402_recovery_redemptions'
  `;
  const idx = await sql`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'x402_recovery_redemptions'
  `;

  console.log(`\ncolumns: ${cols.length}/4`);
  for (const c of cols) console.log(`  ${c.column_name}`);
  console.log(`indexes: ${idx.length}/2`);
  for (const i of idx) console.log(`  ${i.indexname}`);

  if (cols.length !== 4 || idx.length !== 2) {
    console.error('\nMigration did not fully apply.');
    process.exit(1);
  }
  console.log('\nOK. Now add x402_recovery_redemptions to READ_ONLY_TABLES in');
  console.log(
    'scripts/migrate-grant-readonly.ts and run it with the owner role.'
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
