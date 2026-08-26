/**
 * One nullable column on `lookup_jobs`, so a lookup can be joined to the visit
 * that started it.
 *
 * ## Why the funnel could not be read
 *
 * `analytics_events.session_id` is populated on everything the browser emits
 * and null on everything the server does. Every `lookup_started` and
 * `lookup_completed` row in the table, 1,597 of them, has no session: they are
 * written by `/api/jobs` and by the job processor, neither of which was ever
 * told which visit it was serving.
 *
 * That is the join the funnel needs. Without it "how many of the people who
 * arrived actually ran a lookup" is unanswerable, and it is the single most
 * useful question about this product.
 *
 * ## Why it lands on the job rather than being passed through
 *
 * `lookup_started` is emitted by the request handler, which has the session id
 * in its body and could simply use it. `lookup_completed` is emitted minutes
 * later by a worker that has only the job row. Threading the value through the
 * queue means storing it, and the job is the thing that is already stored.
 *
 * Nullable, and staying that way. Every job that already exists predates this,
 * a job created by the seed cron has no browser behind it at all, and an API
 * caller has no session either. A null here means "not from a visit", which is
 * a real answer rather than a gap.
 *
 * `lookup_jobs` rows carry wallet lists and are already covered by the
 * retention sweep, so this adds a field to a row that is already deleted on a
 * schedule rather than creating somewhere new for anything to live forever.
 *
 * DATABASE_URL: the owner role, and the direct endpoint rather than the pooler.
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

  console.log('lookup_jobs.session_id');
  await sql`ALTER TABLE lookup_jobs ADD COLUMN IF NOT EXISTS session_id text`;

  const [{ n }] = (await sql`
    SELECT count(*)::int AS n
    FROM information_schema.columns
    WHERE table_name = 'lookup_jobs' AND column_name = 'session_id'
  `) as unknown as Array<{ n: number }>;
  if (n !== 1) {
    console.error('lookup_jobs.session_id was not created.');
    process.exit(1);
  }

  console.log('ok: lookup_jobs.session_id present');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
