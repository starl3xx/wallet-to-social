/**
 * The KYC-attested wallet set: one row per wallet carrying a live
 * verified-account attestation from the exchange's onchain attester on Base.
 *
 * Its own table rather than a social_graph column, deliberately. The set is
 * 722k wallets and mostly does not intersect the graph; a column would go
 * stale for wallets that enter the graph after their attestation was swept,
 * while a table the sweep fully resyncs each week is never stale by more
 * than a cadence. Readers join; nothing here is an identity link, so none of
 * the attested-links machinery applies.
 *
 * Run with the OWNER DATABASE_URL against the DIRECT endpoint (drop
 * `-pooler` from the host), per the schema-changes rule in CLAUDE.md:
 *
 *   DATABASE_URL=postgres://...direct... npx tsx scripts/migrate-add-cb-verified.ts
 */
import { neon } from '@neondatabase/serverless';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  if (url.includes('-pooler')) {
    console.error(
      'Refusing to run DDL through the pooler; use the direct endpoint.'
    );
    process.exit(1);
  }
  const sql = neon(url);

  await sql`
    CREATE TABLE IF NOT EXISTS cb_verified_wallets (
      wallet      text PRIMARY KEY,
      uid         text NOT NULL,
      attested_at timestamptz NOT NULL,
      swept_at    timestamptz NOT NULL
    )
  `;
  // The weekly resync deletes rows whose attestation disappeared, keyed on
  // swept_at, so the sweep role needs the full write set.
  await sql`GRANT SELECT, INSERT, UPDATE, DELETE ON cb_verified_wallets TO sweep_runner`;

  const check = await sql`
    SELECT count(*)::int AS cols FROM information_schema.columns
    WHERE table_name = 'cb_verified_wallets'
  `;
  if (Number(check[0]?.cols) !== 4) {
    console.error(
      'Verification failed: cb_verified_wallets does not have 4 columns.'
    );
    process.exit(1);
  }
  console.log('cb_verified_wallets exists with 4 columns; grants applied.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
