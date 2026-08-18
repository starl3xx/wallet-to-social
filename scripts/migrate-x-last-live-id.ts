/**
 * Keep the numeric X account id after a handle stops resolving.
 *
 * Usage: npx tsx --env-file=.env.local scripts/migrate-x-last-live-id.ts
 *
 * ## The problem this closes
 *
 * `persist()` sets `user_id = EXCLUDED.user_id` on every upsert. A suspended or
 * vacated handle resolves with **no id at all**, so a recheck of a row that used
 * to be live overwrites its id with NULL, permanently.
 *
 * It has cost nothing yet, because there has been exactly one full pass:
 * measured on 2026-08-18, all 291,031 live rows carry an id and all 126,967
 * suspended or unclaimed rows carry none, since those never had one to lose.
 * The erosion starts when rechecks begin on 2026-10-01.
 *
 * ## Why a second column rather than a coalesce on the first
 *
 * `user_id` means "the id this handle resolves to **now**", and that is the
 * meaning the rename detection depends on: where a handle resolves to a
 * different id than the one a source attested alongside the wallet, the handle
 * has moved and the row points at the wrong person. Coalescing would quietly
 * change it to "the last id we ever saw", so a vacated handle would keep
 * claiming to resolve to somebody.
 *
 * `last_live_user_id` says the other thing, and says it separately: the id this
 * handle pointed at the last time it pointed anywhere. That is what the cheaper
 * batched-by-id route needs, and it is the only durable identifier left once a
 * handle is gone.
 */
import { neon } from '@neondatabase/serverless';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required (must be the owner role)');
    process.exit(1);
  }
  const sql = neon(url);

  await sql`ALTER TABLE x_accounts ADD COLUMN IF NOT EXISTS last_live_user_id text`;
  console.log('column x_accounts.last_live_user_id: ok');

  const before = (await sql`
    SELECT count(*)::int AS n FROM x_accounts WHERE last_live_user_id IS NOT NULL
  `) as unknown as Array<{ n: number }>;

  // Seed from what we hold now. Idempotent: only fills where it is empty.
  await sql`
    UPDATE x_accounts SET last_live_user_id = user_id
    WHERE last_live_user_id IS NULL AND user_id IS NOT NULL
  `;

  const after = (await sql`
    SELECT count(*)::int AS n FROM x_accounts WHERE last_live_user_id IS NOT NULL
  `) as unknown as Array<{ n: number }>;
  console.log(`backfilled ${(after[0].n - before[0].n).toLocaleString()} rows (now ${after[0].n.toLocaleString()} carry one)`);

  await sql`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS x_accounts_last_live_user_id_idx
    ON x_accounts (last_live_user_id) WHERE last_live_user_id IS NOT NULL
  `;
  console.log('index x_accounts_last_live_user_id_idx: ok');
  console.log('\nx_handle_attempts and x_accounts are already granted to sweep_runner.');
}

main().catch((e) => {
  console.error('migration failed:', e);
  process.exit(1);
});
