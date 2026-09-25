/**
 * Sanctions screening for the USDC rail (Linear STA-41): two tables, two
 * columns on `users`, and the first copy of the list.
 *
 * - `sanctioned_addresses`: the EVM addresses on OFAC's SDN list, lowercased,
 *   one row each. Replaced whole by the six-hourly refresh
 *   (`/api/cron/sanctions-refresh`, lib/sanctions.ts). Its metadata (OFAC's
 *   publish date, the last successful refresh) is the `sanctions_list` row of
 *   `ingest_state`, which already exists.
 * - `sanctions_screenings`: the screening record, kept five years (the daily
 *   cleanup deletes older rows): a `clear` row per verified payment, and a
 *   refusal row per payer, verdict and hour with an attempt counter.
 * - `users.frozen_at`, `users.frozen_reason`: set when a wallet that already
 *   bought is later listed. Both nullable with no default, which Postgres adds
 *   as a catalog change without rewriting the table.
 *
 * ## Order: run BEFORE the code merges
 *
 * The code reads all of it on hot paths. `lookupActiveKey` joins `users` for
 * `frozen_at` on every API call, and Drizzle's INSERT into `users` names every
 * column in `db/schema.ts`, so without the columns every API call and every
 * signup fails. Without the tables every USDC buy answers 503, by design.
 * Nothing here changes behavior for the code running now: it reads none of it.
 *
 * Then seed: the script downloads SDN.XML once and puts the list in force
 * through the same `refreshSanctionsList` the cron runs, so the rail sells
 * from the moment the code deploys instead of answering 503 until the first
 * scheduled refresh. Rerunning the script refreshes again, idempotently.
 *
 * ## After it
 *
 * `sanctions_screenings` is a compliance record, so it is in `BACKUP_TABLES`
 * in scripts/migrate-grant-readonly.ts and in the dump list of
 * .github/workflows/db-backup.yml. Run migrate-grant-readonly.ts with the
 * owner URL right after this, BEFORE merge: the nightly dump fails on a table
 * its role cannot read. `sanctioned_addresses` is rebuildable from OFAC and is
 * in neither list.
 *
 * ## Rollback
 *
 * Revert the code first, then:
 *   DROP TABLE sanctions_screenings; DROP TABLE sanctioned_addresses;
 *   DELETE FROM ingest_state WHERE name = 'sanctions_list';
 *   ALTER TABLE users DROP COLUMN frozen_at, DROP COLUMN frozen_reason;
 * Only if no account was frozen; a freeze is a record the lawyer may need.
 *
 * DATABASE_URL: the owner role, and the direct endpoint rather than the pooler.
 *
 *   npx tsx --env-file=.env.local scripts/migrate-sanctions-screening.ts
 */

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { refreshSanctionsList } from '../lib/sanctions';

const EXPECTED_COLUMNS: Record<string, string[]> = {
  sanctioned_addresses: [
    'address',
    'sdn_uid',
    'entity',
    'tickers',
    'first_seen_at',
  ],
  sanctions_screenings: [
    'id',
    'address',
    'list_publish_date',
    'verdict',
    'verify_reached',
    'attempts',
    'screened_hour',
    'screened_at',
    'last_screened_at',
  ],
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
   * One transaction, so the tables and the columns land together. The ALTER
   * takes a brief exclusive lock on `users`, which every sign-in reads;
   * `lock_timeout` makes it give up rather than queue them, and SET LOCAL
   * cannot outlive the transaction.
   */
  console.log('sanctioned_addresses, sanctions_screenings, users.frozen_*');
  await sql.transaction([
    sql`SET LOCAL lock_timeout = '3s'`,
    sql`
      CREATE TABLE IF NOT EXISTS sanctioned_addresses (
        address text PRIMARY KEY CHECK (address ~ '^0x[0-9a-f]{40}$'),
        sdn_uid text NOT NULL,
        entity text NOT NULL,
        tickers text NOT NULL,
        first_seen_at timestamptz NOT NULL DEFAULT now()
      )
    `,
    // A refusal happens before verify and is one row per payer, verdict and
    // UTC hour with a counter; a `clear` row is written after verify, one per
    // payment. The CHECK makes `verify_reached` say which, on every row.
    sql`
      CREATE TABLE IF NOT EXISTS sanctions_screenings (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        address text NOT NULL,
        list_publish_date date,
        verdict text NOT NULL
          CHECK (verdict IN ('clear', 'listed', 'stale', 'missing')),
        verify_reached boolean NOT NULL,
        attempts integer NOT NULL DEFAULT 1 CHECK (attempts >= 1),
        screened_hour timestamptz NOT NULL,
        screened_at timestamptz NOT NULL DEFAULT now(),
        last_screened_at timestamptz NOT NULL DEFAULT now(),
        CHECK (verify_reached = (verdict = 'clear'))
      )
    `,
    // The purge's range scan, and the lookup a runbook does by wallet.
    sql`
      CREATE INDEX IF NOT EXISTS sanctions_screenings_screened_at_idx
        ON sanctions_screenings (screened_at)
    `,
    sql`
      CREATE INDEX IF NOT EXISTS sanctions_screenings_address_idx
        ON sanctions_screenings (address)
    `,
    // The refusal dedupe: the conflict target of the refusal upsert.
    sql`
      CREATE UNIQUE INDEX IF NOT EXISTS sanctions_screenings_refusal_hour_idx
        ON sanctions_screenings (address, verdict, screened_hour)
        WHERE NOT verify_reached
    `,
    sql`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS frozen_at timestamptz,
        ADD COLUMN IF NOT EXISTS frozen_reason text
    `,
  ]);

  let bad = false;

  for (const [table, want] of Object.entries(EXPECTED_COLUMNS)) {
    const cols = (await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = ${table}
    `) as unknown as Array<{ column_name: string }>;
    const have = new Set(cols.map((c) => c.column_name));
    const missing = want.filter((c) => !have.has(c));
    if (missing.length) {
      console.error(`${table} is missing: ${missing.join(', ')}`);
      bad = true;
    } else {
      console.log(`ok: ${table} (${want.length} columns)`);
    }
  }

  const idx = (await sql`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'sanctions_screenings'
      AND indexname IN (
        'sanctions_screenings_screened_at_idx',
        'sanctions_screenings_address_idx',
        'sanctions_screenings_refusal_hour_idx'
      )
  `) as unknown as Array<{ indexname: string }>;
  if (idx.length !== 3) {
    console.error(`sanctions_screenings has ${idx.length}/3 indexes.`);
    bad = true;
  } else {
    console.log('ok: sanctions_screenings indexes (3)');
  }

  // Nullable with no default is the safety argument above: a default here
  // would freeze every account the moment the column appeared.
  const frozen = (await sql`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'users' AND column_name IN ('frozen_at', 'frozen_reason')
  `) as unknown as Array<{
    column_name: string;
    data_type: string;
    is_nullable: string;
    column_default: string | null;
  }>;
  for (const [name, type] of [
    ['frozen_at', 'timestamp with time zone'],
    ['frozen_reason', 'text'],
  ]) {
    const col = frozen.find((c) => c.column_name === name);
    if (
      !col ||
      col.data_type !== type ||
      col.is_nullable !== 'YES' ||
      col.column_default !== null
    ) {
      console.error(`users.${name} is absent or has the wrong shape.`);
      bad = true;
    } else {
      console.log(`ok: users.${name} (${col.data_type})`);
    }
  }
  if (bad) process.exit(1);

  // Counted, not listed: `users` is customer accounts.
  const [pre] = (await sql`
    SELECT count(*) FILTER (WHERE frozen_at IS NOT NULL)::int AS frozen
    FROM users
  `) as unknown as Array<{ frozen: number }>;
  console.log(`${pre.frozen} accounts frozen before the seed.`);

  console.log('\nSeeding the list from SDN.XML (one download, about 29 MB)');
  const outcome = await refreshSanctionsList({ db: drizzle(sql) });
  console.log(
    JSON.stringify(
      {
        ok: outcome.ok,
        refused: outcome.refused,
        error: outcome.error,
        publishDate: outcome.publishDate,
        parsed: outcome.parsed,
        previous: outcome.previous,
        added: outcome.added,
        removed: outcome.removed,
        freeze: outcome.freeze,
      },
      null,
      2
    )
  );
  if (!outcome.ok) {
    console.error(
      '\nThe schema is in place but the list is not seeded. Rerun this script, or let the cron fill it; USDC buys answer 503 until then.'
    );
    process.exit(1);
  }

  console.log('\nOK. Now run scripts/migrate-grant-readonly.ts with the owner');
  console.log(
    'role, so the nightly dump can read sanctions_screenings, and then merge.'
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
