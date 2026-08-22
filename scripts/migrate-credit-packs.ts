/**
 * Create the credit ledger tables.
 *
 * Usage: npx tsx --env-file=.env.local scripts/migrate-credit-packs.ts
 *
 * Hand-written rather than generated, because the schema has drift and
 * `drizzle-kit push` would offer to reconcile it. Everything here is
 * `IF NOT EXISTS`, so it is safe to run twice.
 *
 * ## After this runs
 *
 * Add `credit_lots` and `credit_ledger` to `READ_ONLY_TABLES` in
 * `scripts/migrate-grant-readonly.ts` and run that with the OWNER
 * `DATABASE_URL`. A table created after the role split inherits nothing, and
 * nothing fails at creation time: it fails later, in CI, as "permission denied
 * for table credit_lots" on a run that passed locally.
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
    CREATE TABLE IF NOT EXISTS credit_lots (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      granted integer NOT NULL,
      consumed integer NOT NULL DEFAULT 0,
      pack text NOT NULL,
      amount_cents integer NOT NULL DEFAULT 0,
      stripe_payment_id text,
      created_at timestamp NOT NULL DEFAULT now(),
      expires_at timestamp NOT NULL,
      note text
    )
  `;
  console.log('credit_lots: ok');

  await sql`CREATE INDEX IF NOT EXISTS credit_lots_user_idx ON credit_lots (user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS credit_lots_user_expiry_idx ON credit_lots (user_id, expires_at)`;
  /**
   * Partial, on purpose. A hand-issued grant has no Stripe payment, and several
   * of them would collide on a plain unique index over a nullable column in any
   * engine that treats NULLs as equal. Postgres does not, but the intent is
   * worth stating: this index exists to stop a retried webhook granting twice,
   * and it should apply only to rows that came from a webhook.
   */
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS credit_lots_stripe_payment_idx
    ON credit_lots (stripe_payment_id) WHERE stripe_payment_id IS NOT NULL
  `;
  console.log('credit_lots indexes: ok');

  await sql`
    CREATE TABLE IF NOT EXISTS credit_ledger (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      matches integer NOT NULL,
      wallets_submitted integer NOT NULL DEFAULT 0,
      paid_from text NOT NULL,
      job_id uuid,
      created_at timestamp NOT NULL DEFAULT now()
    )
  `;
  console.log('credit_ledger: ok');

  await sql`CREATE INDEX IF NOT EXISTS credit_ledger_user_idx ON credit_ledger (user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS credit_ledger_user_created_idx ON credit_ledger (user_id, created_at)`;
  // Same reasoning as above: idempotency for a resumed job, and a hand-written
  // adjustment has no job to point at.
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_job_idx
    ON credit_ledger (job_id) WHERE job_id IS NOT NULL
  `;
  console.log('credit_ledger indexes: ok');

  const [lots] =
    (await sql`SELECT count(*)::int AS n FROM credit_lots`) as unknown as Array<{
      n: number;
    }>;
  const [ledger] =
    (await sql`SELECT count(*)::int AS n FROM credit_ledger`) as unknown as Array<{
      n: number;
    }>;
  console.log(
    `\nverified: credit_lots has ${lots.n} rows, credit_ledger has ${ledger.n}`
  );
  console.log(
    'Next: add both tables to READ_ONLY_TABLES in scripts/migrate-grant-readonly.ts'
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
