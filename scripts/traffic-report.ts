/**
 * Read-only traffic analysis script.
 *
 * Usage: npx tsx --env-file=.env.local scripts/traffic-report.ts
 *
 * Answers: who is actually creating lookup jobs, whether the public "Recent
 * activity" cards are real user traffic or the daily refresh-stale cron, and
 * what genuine user activity looks like underneath.
 *
 * Written against the LIVE schema (see scripts/db-introspect.ts) — note that
 * lookup_jobs keeps inputSource/tier inside the `options` JSONB rather than in
 * dedicated columns. Runs SELECT statements only.
 */

import { neon } from '@neondatabase/serverless';

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const sql = neon(databaseUrl);

  const section = (title: string) => {
    console.log(`\n${'='.repeat(72)}\n${title}\n${'='.repeat(72)}`);
  };

  section('1. RECENT COMPLETED JOBS — exactly what /api/wins renders');
  const recent = await sql`
    SELECT to_char(completed_at, 'MM-DD HH24:MI') AS completed,
           options->>'inputSource' AS source,
           options->>'tier' AS tier,
           options->>'saveToHistory' AS saves,
           user_id,
           jsonb_array_length(wallets) AS wallets,
           twitter_found AS tw, farcaster_found AS fc, any_social_found AS any,
           round(100.0 * any_social_found / NULLIF(jsonb_array_length(wallets), 0)) AS rate,
           hidden
    FROM lookup_jobs
    WHERE status = 'completed' AND completed_at > now() - interval '8 days'
    ORDER BY completed_at DESC
    LIMIT 20
  `;
  console.table(recent);

  section('2. LIFETIME JOBS BY SOURCE + TIER');
  const bySource = await sql`
    SELECT COALESCE(options->>'inputSource', '(null)') AS source,
           COALESCE(options->>'tier', '(null)') AS tier,
           status,
           count(*) AS jobs,
           sum(jsonb_array_length(wallets)) AS wallets,
           to_char(min(created_at), 'YYYY-MM-DD') AS first_seen,
           to_char(max(created_at), 'YYYY-MM-DD') AS last_seen
    FROM lookup_jobs
    GROUP BY 1, 2, 3
    ORDER BY jobs DESC
  `;
  console.table(bySource);

  section('3. JOBS PER DAY, LAST 21 DAYS');
  const perDay = await sql`
    SELECT to_char(created_at, 'YYYY-MM-DD') AS day,
           count(*) AS jobs,
           count(*) FILTER (WHERE options->>'inputSource' = 'api'
                            AND jsonb_array_length(wallets) = 100) AS cron_shaped,
           count(*) FILTER (WHERE options->>'inputSource' IN ('file_upload','text_input')) AS user_uploads,
           count(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL) AS distinct_users
    FROM lookup_jobs
    WHERE created_at > now() - interval '21 days'
    GROUP BY 1
    ORDER BY 1 DESC
  `;
  console.table(perDay);

  section(
    '4. GENUINE USER-INITIATED LOOKUPS (file_upload / text_input), LAST 60 DAYS'
  );
  const userJobs = await sql`
    SELECT to_char(created_at, 'MM-DD HH24:MI') AS created,
           options->>'inputSource' AS source,
           options->>'tier' AS tier,
           status, user_id,
           jsonb_array_length(wallets) AS wallets,
           any_social_found AS any
    FROM lookup_jobs
    WHERE options->>'inputSource' IN ('file_upload', 'text_input')
      AND created_at > now() - interval '60 days'
    ORDER BY created_at DESC
    LIMIT 40
  `;
  console.table(userJobs);

  section(
    '5. SAVED LOOKUP HISTORY — strongest signal of a real returning user'
  );
  const history = await sql`
    SELECT to_char(created_at, 'YYYY-MM-DD HH24:MI') AS created,
           user_id, input_source, wallet_count, twitter_found AS tw, farcaster_found AS fc,
           to_char(last_viewed_at, 'YYYY-MM-DD') AS last_viewed
    FROM lookup_history
    ORDER BY created_at DESC
    LIMIT 30
  `;
  console.table(history);

  section('6. USERS / TIERS');
  const users = await sql`
    SELECT tier, count(*) AS users,
           count(*) FILTER (WHERE paid_at IS NOT NULL) AS paid,
           sum(wallets_used) AS wallets_used,
           to_char(max(created_at), 'YYYY-MM-DD') AS newest
    FROM users
    GROUP BY 1
    ORDER BY users DESC
  `;
  console.table(users);

  section('7. SOCIAL GRAPH + STALE BACKLOG (what the cron chews through)');
  const graph = await sql`
    SELECT count(*) FILTER (WHERE twitter_handle IS NOT NULL OR farcaster IS NOT NULL
                            OR ens_name IS NOT NULL OR lens IS NOT NULL OR github IS NOT NULL) AS positives,
           count(*) FILTER (WHERE twitter_handle IS NULL AND farcaster IS NULL
                            AND ens_name IS NULL AND lens IS NULL AND github IS NULL) AS negatives,
           count(*) FILTER (WHERE twitter_handle IS NOT NULL) AS with_tw,
           count(*) FILTER (WHERE farcaster IS NOT NULL) AS with_fc,
           count(*) FILTER (WHERE stale_at < now() AND (twitter_handle IS NOT NULL OR farcaster IS NOT NULL
                            OR ens_name IS NOT NULL OR lens IS NOT NULL OR github IS NOT NULL)) AS stale_now,
           count(*) FILTER (WHERE stale_at < now() AND lookup_count > 5
                            AND (twitter_handle IS NOT NULL OR farcaster IS NOT NULL
                                 OR ens_name IS NOT NULL OR lens IS NOT NULL OR github IS NOT NULL)) AS stale_eligible,
           count(*) FILTER (WHERE lookup_count > 5) AS hot_wallets
    FROM social_graph
  `;
  console.table(graph);

  section('8. ANALYTICS EVENTS, LAST 14 DAYS — real browser traffic');
  const events = await sql`
    SELECT event_type, count(*) AS n,
           count(DISTINCT session_id) AS sessions,
           to_char(max(created_at), 'MM-DD HH24:MI') AS last_seen
    FROM analytics_events
    WHERE created_at > now() - interval '14 days'
    GROUP BY 1
    ORDER BY n DESC
    LIMIT 25
  `;
  console.table(events);

  section(
    '9. DISTINCT SESSIONS PER DAY, LAST 14 DAYS — the real traffic curve'
  );
  const sessions = await sql`
    SELECT to_char(created_at, 'YYYY-MM-DD') AS day,
           count(DISTINCT session_id) AS sessions,
           count(*) AS events
    FROM analytics_events
    WHERE created_at > now() - interval '14 days'
    GROUP BY 1
    ORDER BY 1 DESC
  `;
  console.table(sessions);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
