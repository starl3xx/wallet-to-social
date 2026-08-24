/**
 * Read-only funnel analysis.
 *
 * Usage: npx tsx --env-file=.env.local scripts/funnel-report.ts
 *
 * Answers where the product loses people: arrival, signup, first lookup,
 * repeat use, payment. Written against the LIVE schema (see db-introspect.ts) —
 * lookup_jobs keeps inputSource/tier inside the `options` JSONB.
 */

import { neon } from '@neondatabase/serverless';

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const sql = neon(databaseUrl);
  const section = (t: string) =>
    console.log(`\n${'='.repeat(74)}\n${t}\n${'='.repeat(74)}`);

  section('1. SIGNUPS OVER TIME — are people still arriving?');
  console.table(
    await sql`
    SELECT to_char(created_at, 'YYYY-MM') AS month,
           count(*) AS signups,
           count(*) FILTER (WHERE paid_at IS NOT NULL) AS paid,
           sum(wallets_used) AS wallets_used
    FROM users GROUP BY 1 ORDER BY 1
  `
  );

  section('2. DID SIGNED-UP USERS EVER RUN ANYTHING?');
  console.table(
    await sql`
    SELECT count(*) AS total_users,
           count(*) FILTER (WHERE wallets_used > 0) AS ever_used_wallets,
           count(*) FILTER (WHERE tier <> 'free') AS non_free_tier
    FROM users
  `
  );

  section('3. ANONYMOUS LOOKUP ACTIVITY BY MONTH (the real usage signal)');
  console.table(
    await sql`
    SELECT to_char(created_at, 'YYYY-MM') AS month,
           count(*) AS lookups,
           count(DISTINCT user_id) AS distinct_visitors,
           sum(wallet_count) AS wallets,
           round(avg(wallet_count)) AS avg_size
    FROM lookup_history GROUP BY 1 ORDER BY 1
  `
  );

  section('4. REPEAT USE — how many visitors ran more than one lookup?');
  console.table(
    await sql`
    SELECT lookups_run, count(*) AS visitors FROM (
      SELECT user_id, count(*) AS lookups_run
      FROM lookup_history WHERE user_id IS NOT NULL GROUP BY 1
    ) t GROUP BY 1 ORDER BY 1
  `
  );

  section('5. LOOKUP SIZE DISTRIBUTION — tyre-kicks vs real lists');
  console.table(
    await sql`
    SELECT CASE
             WHEN wallet_count = 1 THEN 'a. 1 wallet (poke)'
             WHEN wallet_count <= 10 THEN 'b. 2-10'
             WHEN wallet_count <= 100 THEN 'c. 11-100'
             WHEN wallet_count <= 1000 THEN 'd. 101-1000'
             ELSE 'e. 1000+ (real list)'
           END AS bucket,
           count(*) AS lookups
    FROM lookup_history GROUP BY 1 ORDER BY 1
  `
  );

  section('6. ALL ANALYTICS EVENTS EVER — the funnel as instrumented');
  console.table(
    await sql`
    SELECT event_type, count(*) AS n,
           count(DISTINCT session_id) AS sessions,
           to_char(min(created_at), 'YYYY-MM-DD') AS first,
           to_char(max(created_at), 'YYYY-MM-DD') AS last
    FROM analytics_events GROUP BY 1 ORDER BY n DESC
  `
  );

  section('7. DID ANYONE EVER HIT CHECKOUT?');
  console.table(
    await sql`
    SELECT event_type, count(*) AS n, to_char(max(created_at),'YYYY-MM-DD') AS last_seen
    FROM analytics_events
    WHERE event_type ILIKE '%checkout%' OR event_type ILIKE '%upgrade%'
       OR event_type ILIKE '%paid%' OR event_type ILIKE '%block%'
       OR event_type ILIKE '%limit%'
    GROUP BY 1 ORDER BY n DESC
  `
  );

  section('8. FREE-TIER CEILING — did anyone bump the 1,000-wallet limit?');
  console.table(
    await sql`
    SELECT count(*) AS lookups_at_or_over_1000
    FROM lookup_history WHERE wallet_count >= 1000
  `
  );

  section('9. API KEYS / DEVELOPER INTEREST');
  console.table(
    await sql`
    SELECT (SELECT count(*) FROM api_keys) AS api_keys,
           (SELECT count(*) FROM api_usage) AS api_calls,
           (SELECT count(*) FROM whitelist) AS whitelisted
  `
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
