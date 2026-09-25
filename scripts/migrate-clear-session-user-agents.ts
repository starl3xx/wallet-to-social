/**
 * Migration: empty auth_sessions.user_agent (STA-45).
 *
 * Usage, with the owner connection:
 *   npx tsx --env-file=.env.local scripts/migrate-clear-session-user-agents.ts           # dry run
 *   npx tsx --env-file=.env.local scripts/migrate-clear-session-user-agents.ts --commit
 *
 * Run AFTER the deploy that stops writing the column (`createSession` in
 * lib/auth.ts no longer takes a user agent). Run before it, and every sign-in
 * between this script and the deploy writes a fresh value that nothing then
 * clears.
 *
 * Data only: the column stays, so no DDL touches a live auth table. Sets the
 * value to NULL in batches and changes nothing else on the row, so every
 * session stays signed in. Idempotent: a second run finds nothing to clear
 * and says so.
 *
 * Needs a role that can UPDATE auth_sessions (the owner URL in .env.local).
 * Without --commit it only counts.
 */

import { neon } from '@neondatabase/serverless';

const BATCH = 1000;

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required (must be the owner role)');
    process.exit(1);
  }

  const commit = process.argv.includes('--commit');
  const sql = neon(databaseUrl);

  const [before] = (await sql`
    SELECT count(*)::int AS n FROM auth_sessions WHERE user_agent IS NOT NULL
  `) as unknown as Array<{ n: number }>;
  console.log(`sessions holding a user agent: ${before.n}`);
  if (!commit) {
    console.log(
      'dry run: nothing written. Re-run with --commit to clear them.'
    );
    return;
  }

  let cleared = 0;
  for (;;) {
    const rows = (await sql`
      WITH held AS (
        SELECT id FROM auth_sessions
        WHERE user_agent IS NOT NULL
        LIMIT ${BATCH}
      )
      UPDATE auth_sessions s
      SET user_agent = NULL
      FROM held
      WHERE s.id = held.id
      RETURNING s.id
    `) as unknown as unknown[];
    cleared += rows.length;
    if (rows.length < BATCH) break;
  }
  console.log(`cleared: ${cleared}`);

  const [after] = (await sql`
    SELECT count(*)::int AS n FROM auth_sessions WHERE user_agent IS NOT NULL
  `) as unknown as Array<{ n: number }>;
  if (after.n !== 0) {
    console.error(
      `verification failed: ${after.n} sessions still hold a user agent. Is the deploy that stops the writes live?`
    );
    process.exit(1);
  }
  console.log('verified: no session holds a user agent');
}

main().catch((e) => {
  console.error('migration failed:', e);
  process.exit(1);
});
