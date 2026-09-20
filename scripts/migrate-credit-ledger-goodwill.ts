/**
 * `credit_ledger.goodwill_matches`: what a job was shown but not charged for.
 *
 * Usage: npx tsx scripts/migrate-credit-ledger-goodwill.ts
 * (DATABASE_URL must be the owner role, on the direct endpoint, not the
 * pooler. Run BEFORE deploying anything that writes this column.)
 *
 * ## What it is for
 *
 * Both meters now bill what the balance holds and deliver a small margin past
 * it, because a match rate cannot be known before a job runs and locking the
 * 251st match on a 250-match pack would punish somebody for arithmetic they
 * could not have done. This column is what that margin costs, per job.
 *
 * ## Why it has to exist rather than be inferred
 *
 * It was previously inferable from nothing at all. A pack job billed the full
 * match count to the ledger, `drawDown` collected what the lots held and
 * dropped the remainder, and the difference existed in no row, no log and no
 * query: `getBalance` floors at zero and the draw clamps each take with
 * `LEAST`, so the shortfall was invisible by construction. `SUM(ledger.matches)`
 * simply exceeded `SUM(lots.consumed)` for that account, permanently, with
 * nothing comparing them.
 *
 * With the debit now capped at the balance, those two sums agree again and
 * the amount given away is a column instead of a discrepancy.
 *
 * ## Backfill is deliberately zero
 *
 * Rows written before this column cannot have their goodwill reconstructed:
 * the number that would be needed is exactly the one nothing recorded. Zero
 * is the honest value for "we do not know", and it is also what the DEFAULT
 * gives every historical row. Anyone measuring give-away over time should
 * start the series at this migration rather than treat the history as clean.
 *
 * ## No new grant
 *
 * A column added to an existing table inherits that table's privileges in
 * Postgres, so `sweep_runner`'s SELECT on `credit_ledger` already covers it.
 * A NEW TABLE would have needed `scripts/migrate-grant-readonly.ts`; this
 * does not, and the verification below checks the column rather than assuming
 * the grant.
 */
import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
if (url.includes('-pooler')) {
  console.error(
    'Refusing to run DDL through the pooler. Drop "-pooler" from the host: ' +
      'a bare SET can outlive the connection on a shared backend.'
  );
  process.exit(1);
}

const sql = neon(url);

async function main() {
  console.log('Adding credit_ledger.goodwill_matches…');

  await sql`
    ALTER TABLE credit_ledger
    ADD COLUMN IF NOT EXISTS goodwill_matches integer NOT NULL DEFAULT 0
  `;

  const column = (await sql`
    SELECT data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'credit_ledger'
      AND column_name = 'goodwill_matches'
  `) as unknown as Array<{
    data_type: string;
    is_nullable: string;
    column_default: string | null;
  }>;

  const found = column[0];
  if (!found) {
    console.error('FAILED: credit_ledger.goodwill_matches was not created');
    process.exit(1);
  }
  if (found.is_nullable !== 'NO') {
    console.error('FAILED: goodwill_matches is nullable; it must be NOT NULL');
    process.exit(1);
  }
  if (!found.column_default?.startsWith('0')) {
    console.error(
      `FAILED: goodwill_matches default is ${found.column_default}, expected 0`
    );
    process.exit(1);
  }

  console.log(`  verified: ${found.data_type}, NOT NULL, default 0`);
  console.log('');
  console.log(
    'No grant step: a new COLUMN inherits the table privileges that ' +
      'scripts/migrate-grant-readonly.ts already gave credit_ledger.'
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
