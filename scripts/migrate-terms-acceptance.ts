/**
 * Two columns on `credit_lots`, so a purchase records which terms of service
 * its buyer agreed to, and when.
 *
 * ## Why
 *
 * Decided 2026-09-25 (Linear STA-47): an explicit "I agree to the Terms of
 * Service" at card checkout, and a disclosure in the x402 challenge where the
 * payment is the acceptance. The terms page says the version and the time are
 * recorded with the purchase, and the lot is the purchase record:
 *
 * - `terms_version`: `TERMS_VERSION` from lib/terms.ts, an ISO date. For a
 *   card purchase, the version the buyer's page showed beside the box; for an
 *   onchain one, the version in force when the payment settled.
 * - `terms_accepted_at`: when the ticked box reached the checkout route, or
 *   when the onchain payment settled. `timestamptz`, unlike the older columns
 *   on this table, because it is a record somebody may one day have to read
 *   without guessing the zone.
 *
 * Both are nullable and written together by `termsColumns`. NULL means no
 * agreement was captured: a hand grant, a loyalty bonus, the lots bought
 * before this shipped, and a checkout opened before the checkbox deployed.
 * Nothing is backfilled. On 2026-09-25 no lot had been bought onchain, and no
 * buyer of any existing lot ticked a box; a version written onto them now
 * would be invented.
 *
 * ## Why columns and not a table
 *
 * One acceptance per purchase, written in the same INSERT as the lot it
 * belongs to, and read wherever the lot is read. A separate table would need
 * its own write in the grant, which is the step that must not half-happen
 * after money has moved.
 *
 * ## Order
 *
 * Run BEFORE the code that writes them deploys. Drizzle's INSERT names every
 * column in `db/schema.ts` (it sends `default` for the ones a call leaves
 * out), so without these columns every insert into `credit_lots` fails:
 * every pack grant, every hand grant, every onchain settlement. Both are
 * nullable with no default, which Postgres adds as a catalog change without
 * rewriting the table, so the code running now ignores them and adding them
 * first is safe.
 *
 * ## Rollback
 *
 * ALTER TABLE credit_lots
 *   DROP COLUMN terms_version, DROP COLUMN terms_accepted_at;
 *
 * Only after the code that writes them is reverted, for the reason above.
 *
 * DATABASE_URL: the owner role, and the direct endpoint rather than the pooler.
 * No new table, so no migrate-grant-readonly entry: columns inherit the grants
 * already held on credit_lots.
 *
 *   npx tsx --env-file=.env.local scripts/migrate-terms-acceptance.ts
 */

import { neon } from '@neondatabase/serverless';

const EXPECTED: Record<string, { dataType: string }> = {
  terms_version: { dataType: 'text' },
  terms_accepted_at: { dataType: 'timestamp with time zone' },
};

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

  /**
   * A catalog change, but it still needs a brief exclusive lock on the table
   * every purchase writes. `lock_timeout` makes the ALTER give up rather than
   * queue a checkout behind it, and SET LOCAL inside the transaction means the
   * setting cannot outlive it. One statement, so both land or neither does.
   */
  console.log('credit_lots.terms_version, terms_accepted_at');
  await sql.transaction([
    sql`SET LOCAL lock_timeout = '3s'`,
    sql`ALTER TABLE credit_lots
          ADD COLUMN IF NOT EXISTS terms_version text,
          ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz`,
  ]);

  const cols = (await sql`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'credit_lots'
      AND column_name IN ('terms_version', 'terms_accepted_at')
  `) as unknown as Array<{
    column_name: string;
    data_type: string;
    is_nullable: string;
    column_default: string | null;
  }>;

  let bad = false;
  for (const [name, want] of Object.entries(EXPECTED)) {
    const col = cols.find((c) => c.column_name === name);
    if (!col) {
      console.error(`credit_lots.${name} was not created.`);
      bad = true;
      continue;
    }
    // Nullable with no default is the whole safety argument above: a NOT
    // NULL or a default here would mean an existing lot claims an agreement.
    if (
      col.data_type !== want.dataType ||
      col.is_nullable !== 'YES' ||
      col.column_default !== null
    ) {
      console.error(
        `credit_lots.${name} exists with the wrong shape: ${col.data_type}, nullable ${col.is_nullable}, default ${col.column_default}.`
      );
      bad = true;
      continue;
    }
    console.log(`ok: credit_lots.${name} (${col.data_type})`);
  }
  if (bad) process.exit(1);

  // Nothing is backfilled, so nothing should carry a version yet. Counted,
  // not listed: this table is customer purchases.
  const [pre] = (await sql`
    SELECT count(*)::int AS lots,
           count(terms_version)::int AS with_terms
    FROM credit_lots
  `) as unknown as Array<{ lots: number; with_terms: number }>;
  console.log(
    `${pre.lots} lots, ${pre.with_terms} carrying a terms version (new purchases only).`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
