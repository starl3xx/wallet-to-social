/**
 * The relaunch campaign's scoreboard. Read-only.
 *
 * One question, answered in stages: of the accounts we granted a Trial pack
 * and emailed (scripts/relaunch-trial-grant.ts), how many came back, how
 * many spent the grant, and how many went on to pay?
 *
 * - sent / opted out ....... lifecycle_emails + users.email_opt_out
 * - arrived via the email .. page_view events tagged ref=relaunch-2026-08
 *                            (browser-level, no sign-in required, so this can
 *                            exceed or miss the redeemed count; the two
 *                            measure different steps)
 * - redeemed ............... campaign lots with consumed > 0; matches spent
 * - purchased after ........ a real (non-grant) credit lot created after the
 *                            account's send timestamp
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/relaunch-report.ts
 */

import { neon } from '@neondatabase/serverless';

const EMAIL_KEY = 'relaunch-trial-2026-08';
const GRANT_ID_PREFIX = 'grant-relaunch-2026-08:';
const REF_TAG = 'relaunch-2026-08';

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const sql = neon(process.env.DATABASE_URL);

  const [sent] = await sql`
    SELECT count(*)::int AS n, min(sent_at) AS first, max(sent_at) AS last
    FROM lifecycle_emails WHERE email_key = ${EMAIL_KEY}`;

  const [optedOut] = await sql`
    SELECT count(*)::int AS n
    FROM lifecycle_emails le
    JOIN users u ON u.id = le.user_id
    WHERE le.email_key = ${EMAIL_KEY} AND u.email_opt_out = true`;

  const [visits] = await sql`
    SELECT count(*)::int AS events,
           count(DISTINCT session_id)::int AS sessions
    FROM analytics_events
    WHERE event_type = 'page_view' AND metadata->>'ref' = ${REF_TAG}`;

  const [grants] = await sql`
    SELECT count(*)::int AS granted,
           count(*) FILTER (WHERE consumed > 0)::int AS redeemed,
           coalesce(sum(consumed), 0)::int AS matches_spent,
           coalesce(sum(granted), 0)::int AS matches_granted
    FROM credit_lots
    WHERE stripe_payment_id LIKE ${GRANT_ID_PREFIX + '%'}`;

  const [purchases] = await sql`
    SELECT count(DISTINCT cl.user_id)::int AS buyers,
           count(*)::int AS lots
    FROM credit_lots cl
    JOIN lifecycle_emails le
      ON le.user_id = cl.user_id AND le.email_key = ${EMAIL_KEY}
    -- A purchase is a lot somebody paid for: a Stripe id that is not a
    -- grant marker, and a positive amount, the same predicate the revenue
    -- dashboard uses. A NULL payment id is a hand-issued support grant,
    -- which must not inflate this row.
    WHERE cl.stripe_payment_id IS NOT NULL
      AND cl.stripe_payment_id NOT LIKE 'grant-%'
      AND cl.amount_cents > 0
      AND cl.created_at > le.sent_at`;

  const pct = (n: number, d: number) =>
    d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(1)}%`;

  console.log(`Relaunch campaign (${EMAIL_KEY})\n`);
  console.log(
    `  sent            ${sent.n}` +
      (sent.first
        ? `  (${new Date(sent.first).toISOString().slice(0, 10)} → ${new Date(sent.last).toISOString().slice(0, 10)})`
        : '')
  );
  console.log(`  opted out       ${optedOut.n}  (${pct(optedOut.n, sent.n)})`);
  console.log(
    `  tagged arrivals ${visits.sessions} sessions, ${visits.events} page views`
  );
  console.log(
    `  grants          ${grants.granted} lots, ${grants.matches_granted.toLocaleString()} matches`
  );
  console.log(
    `  redeemed        ${grants.redeemed}  (${pct(grants.redeemed, grants.granted)} of grants), ` +
      `${grants.matches_spent.toLocaleString()} matches spent`
  );
  console.log(
    `  bought after    ${purchases.buyers} accounts, ${purchases.lots} paid lots`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
