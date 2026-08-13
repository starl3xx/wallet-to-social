/**
 * Seed the Neynar credit counter with usage that predates the counter.
 *
 * lib/neynar-budget.ts only knows about spend it has observed. The account had
 * already consumed 11,557,744 credits in 2026-08 before the counter existed
 * (Neynar's own overage alert is the source), so without seeding, the guard
 * would believe August was untouched and happily let background jobs spend
 * another 7.5M on top of an account that is already over its limit.
 *
 * Neynar exposes no usage endpoint, so the starting figure has to come from
 * their alert email or dashboard and be entered by hand.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/seed-neynar-usage.ts <credits> [YYYY-MM]
 */
import { neon } from '@neondatabase/serverless';

async function main() {
  const credits = Number(process.argv[2]);
  if (!Number.isFinite(credits) || credits < 0) {
    console.error('Usage: seed-neynar-usage.ts <credits> [YYYY-MM]');
    process.exit(1);
  }
  const now = new Date();
  const period =
    process.argv[3] ??
    `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

  const q = neon(process.env.DATABASE_URL!);

  const before = await q.query(
    `select value from ingest_state where name = 'neynar_credit_usage'`
  );
  console.log('before:', before[0]?.value ?? '(no row)');

  // Set rather than add: this is a correction to a known-true total, not an
  // increment on top of whatever the counter happened to hold.
  await q.query(
    `insert into ingest_state (name, value, updated_at)
     values ('neynar_credit_usage', jsonb_build_object('period', $1::text, 'credits', $2::bigint), now())
     on conflict (name) do update set value = excluded.value, updated_at = now()`,
    [period, Math.round(credits)]
  );

  const after = await q.query(
    `select value from ingest_state where name = 'neynar_credit_usage'`
  );
  console.log('after: ', after[0]?.value);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
