/**
 * A record of Clanker account ids the resolver has denied knowing.
 *
 * Usage: npx tsx --env-file=.env.local scripts/migrate-clanker-unresolved.ts
 *
 * ## Why this table exists
 *
 * `sweepClanker` holds its checkpoint below any deploy whose account id it
 * could not resolve, so the range is rescanned rather than the link being lost.
 * That is right for a resolver that is merely down. It is fatal for an id that
 * cannot ever resolve, because `from` is `checkpoint + 1`: the frontier pins to
 * that one block, and once the tip passes `from + MAX_RUN_BLOCKS` the sweep
 * stops seeing new blocks at all while still reporting a run every day.
 *
 * On 2026-08-19 that happened. A deploy wrote the tweet's status id into the
 * `id` field instead of the user id, so the value was 19 digits, passed
 * `isAccountId`, and named a user that has never existed. The frontier froze
 * 37,372 blocks behind the tip and would have gone blind around 2026-08-25.
 *
 * ## Why a separate table and not a column on social_graph
 *
 * A denied id is not a link and must not look like one. `social_graph` holds
 * what we know about a wallet; this holds only that we asked about an id and
 * were told no. Nothing here is ever published.
 *
 * ## Why attempts and not a timestamp
 *
 * The frontier is released on the number of times a REACHABLE resolver denied
 * the id, never on elapsed time or block distance. An outage produces no rows
 * here, so it cannot retire an id that is fine. See `DEAD_AFTER_ATTEMPTS` in
 * `lib/clanker.ts`.
 */
import { neon } from '@neondatabase/serverless';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required (must be the owner role)');
    process.exit(1);
  }
  const sql = neon(url);

  await sql`
    CREATE TABLE IF NOT EXISTS clanker_unresolved_ids (
      identifier      text PRIMARY KEY,
      attempts        integer   NOT NULL DEFAULT 0,
      last_attempt_at timestamp NOT NULL DEFAULT now(),
      last_reason     text
    )
  `;
  console.log('table clanker_unresolved_ids: ok');

  /** The sweep filters on `attempts >= threshold` for a handful of ids a day. */
  await sql`
    CREATE INDEX IF NOT EXISTS clanker_unresolved_ids_attempts_idx
    ON clanker_unresolved_ids (attempts)
  `;
  console.log('index clanker_unresolved_ids_attempts_idx: ok');

  const rows = (await sql`
    SELECT count(*)::int AS n FROM clanker_unresolved_ids
  `) as unknown as Array<{ n: number }>;
  console.log(`\nclanker_unresolved_ids holds ${rows[0].n} row(s).`);
  console.log('Next: run scripts/migrate-grant-readonly.ts with the owner DATABASE_URL.');
}

main().catch((e) => {
  console.error('migration failed:', e);
  process.exit(1);
});
