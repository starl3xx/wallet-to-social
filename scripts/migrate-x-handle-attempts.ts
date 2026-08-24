/**
 * A record of handles we tried to resolve and got nothing back for.
 *
 * Usage: npx tsx --env-file=.env.local scripts/migrate-x-handle-attempts.ts
 *
 * ## Why this table exists
 *
 * `resolve()` returns null on a transport failure or an unrecognised response
 * shape, and the caller then persists nothing. The handle therefore stays
 * "never checked", and `pendingHandles` puts never-checked handles FIRST, so it
 * is served again on the next run, and the run after that, forever.
 *
 * That is not hypothetical. The 2026-08-17 pass targeted 440,700 handles and
 * wrote 417,872, so 22,828 were attempted and produced nothing. Those are most
 * of what is today counted as a 28,172-handle backlog. A scheduled job with a
 * daily credit cap would spend its whole budget re-attempting the same failing
 * handles at the front of the queue and never reach the rest.
 *
 * ## Why a separate table and not a column on x_accounts
 *
 * `x_accounts.status` is NOT NULL, and every published reachability figure
 * counts rows in that table. Writing failures there would change what "417,872
 * resolved" means, and the figure is checked against the database by
 * `scripts/check-published-figures.ts`. A failed attempt is not a resolution
 * and must not be counted as one.
 *
 * **This never invents a state.** `x_accounts` is untouched, the handle stays
 * unchecked, nothing is published about it. Only the retry is deferred.
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
    CREATE TABLE IF NOT EXISTS x_handle_attempts (
      handle          text PRIMARY KEY,
      attempts        integer   NOT NULL DEFAULT 0,
      last_attempt_at timestamp NOT NULL DEFAULT now(),
      last_reason     text
    )
  `;
  console.log('table x_handle_attempts: ok');

  await sql`
    CREATE INDEX IF NOT EXISTS x_handle_attempts_last_attempt_idx
    ON x_handle_attempts (last_attempt_at)
  `;
  console.log('index x_handle_attempts_last_attempt_idx: ok');

  /**
   * `pendingHandles` joins `x_accounts` on `lower(g.twitter_handle)`, and the
   * only index on that column is over the raw value, which cannot serve a
   * `lower()` predicate. The selection query is run every time the cron fires,
   * over 1.1 million rows.
   *
   * CONCURRENTLY so it does not lock the table, which also means it cannot run
   * inside a transaction block.
   */
  await sql`
    CREATE INDEX CONCURRENTLY IF NOT EXISTS social_graph_twitter_lower_idx
    ON social_graph (lower(twitter_handle)) WHERE twitter_handle IS NOT NULL
  `;
  console.log('index social_graph_twitter_lower_idx: ok');

  const rows = (await sql`
    SELECT count(*)::int AS n FROM x_handle_attempts
  `) as unknown as Array<{ n: number }>;
  console.log(`\nx_handle_attempts holds ${rows[0].n} row(s).`);
  console.log(
    'Remember: add x_handle_attempts to scripts/migrate-grant-readonly.ts'
  );
}

main().catch((e) => {
  console.error('migration failed:', e);
  process.exit(1);
});
