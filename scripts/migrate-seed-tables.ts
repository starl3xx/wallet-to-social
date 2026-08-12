/**
 * Migration: tables for the daily collection/token seed cron.
 *
 *  - seeded_contracts: which contracts we've imported holders from and when,
 *    so selection prefers novel contracts over re-seeding the same top-10
 *  - wallet_holdings: wallet ↔ contract edges observed at seed time. This is
 *    the audience-graph data ("holders of X who also hold Y") that per-wallet
 *    social resolution alone can't provide.
 *
 * Usage: npx tsx --env-file=.env.local scripts/migrate-seed-tables.ts
 * Hand-applied (known schema drift; never drizzle-kit push). Idempotent.
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
    CREATE TABLE IF NOT EXISTS seeded_contracts (
      address text NOT NULL,
      chain text NOT NULL,
      contract_type text,
      name text,
      symbol text,
      holders_imported integer NOT NULL DEFAULT 0,
      total_holders integer,
      first_seeded_at timestamp NOT NULL DEFAULT now(),
      last_seeded_at timestamp NOT NULL DEFAULT now(),
      PRIMARY KEY (address, chain)
    )
  `;
  console.log('table seeded_contracts: ok');

  await sql`
    CREATE TABLE IF NOT EXISTS wallet_holdings (
      wallet text NOT NULL,
      contract text NOT NULL,
      chain text NOT NULL,
      contract_type text,
      first_seen_at timestamp NOT NULL DEFAULT now(),
      last_seen_at timestamp NOT NULL DEFAULT now(),
      PRIMARY KEY (wallet, contract, chain)
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS wallet_holdings_contract_idx
    ON wallet_holdings (contract, chain)
  `;
  console.log('table wallet_holdings + index: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
