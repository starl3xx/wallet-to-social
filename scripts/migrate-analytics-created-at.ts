/**
 * An index on `analytics_events.created_at` alone.
 *
 * ## Why
 *
 * The table carries three indexes: `(event_type, created_at)`, `(user_id)`
 * and `(session_id)`. Every funnel query that does not lead with an event
 * type filters by `created_at` range alone — `getSessionFunnel`,
 * `getGateMetrics`, `getFeatureAdoption`, and now the acquisition-source and
 * previous-window readers — and none of the three indexes serves a bare
 * range, so each of those is a sequential scan of the whole table on every
 * admin pane load. Retention is 400 days (`ANALYTICS_RETENTION_DAYS`), so the
 * scan grows with a year of total traffic rather than with the window asked
 * for, and the funnel pane now runs the session grouping twice per load (the
 * window and the window before it).
 *
 * ## What this does
 *
 * - `analytics_events_created_at_idx` on `created_at`, if absent.
 * - Verifies the index exists, and exits non-zero if it does not.
 *
 * Plain CREATE INDEX, following every other migration here: the build takes
 * a share lock on writes for its duration, so run it at a quiet moment. The
 * declaration lives in `db/schema.ts` beside the other three so the schema
 * file stays the map of what production holds once this has run.
 *
 * DATABASE_URL: the owner role, and the direct endpoint rather than the
 * pooler.
 */

import { neon } from '@neondatabase/serverless';

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

  await sql`
    CREATE INDEX IF NOT EXISTS analytics_events_created_at_idx
    ON analytics_events (created_at)
  `;

  const [{ n }] = (await sql`
    SELECT count(*)::int AS n
    FROM pg_indexes
    WHERE tablename = 'analytics_events'
      AND indexname = 'analytics_events_created_at_idx'
  `) as unknown as Array<{ n: number }>;
  if (n !== 1) {
    console.error('analytics_events_created_at_idx was not created.');
    process.exit(1);
  }

  console.log('ok: analytics_events_created_at_idx present');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
