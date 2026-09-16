/**
 * Three views the growth report reads, and the grants that let CI read them.
 *
 * Run manually with the OWNER `DATABASE_URL`, against the DIRECT endpoint
 * (drop `-pooler` from the host; CLAUDE.md explains the shared-backend SET
 * hazard):
 *
 *   npx tsx --env-file=.env.local scripts/migrate-growth-views.ts
 *
 * ## Why views rather than a grant on the tables
 *
 * The weekly report runs in `.github/workflows/growth-report.yml` as
 * `sweep_runner`, and that role is granted per table. The obvious move is to
 * add `analytics_events` and `users` to `scripts/migrate-grant-readonly.ts` and
 * be done. Both carry identifiers we have a standing rule about: `users.email`
 * is an address and `analytics_events.user_id` holds "localStorage ID or
 * email", by its own schema comment. This repository is public, so its Actions
 * logs are public, and the grant would be the thing standing between a future
 * one-line debugging `SELECT *` and a customer's address in a public log.
 *
 * The report needs five columns out of one table and four out of the other, so
 * the narrower grant costs nothing. `growth_page_events` keeps the event type,
 * the session, the timestamp and the two metadata keys the rollups read, and
 * drops `user_id` and the rest of the metadata. `growth_accounts` keeps the
 * signup timestamp, the acquisition summary and the rail, resolves "did this
 * account ever buy" into a boolean here, and therefore exposes no account id at
 * all. `growth_purchases` carries a lot's timestamp and amount with the rail
 * that produced it, so the report can tell a human purchase from an agent
 * settlement without reading `users` itself.
 *
 * The first two are plain views over one table each, so Postgres inlines them
 * and the planner still reaches `analytics_events_created_at_idx`. Measured on
 * 2026-09-16: the channel rollup plans identically through the view and the
 * table.
 *
 * ## Idempotent
 *
 * `CREATE OR REPLACE VIEW` cannot change a view's column list, so a later
 * revision that adds a column has to `DROP VIEW` first. The drops below are
 * unconditional and `IF EXISTS`, which is safe because nothing writes through
 * these and no data lives in them.
 */
import { neon } from '@neondatabase/serverless';

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }
  if (databaseUrl.includes('-pooler')) {
    console.error(
      'DATABASE_URL points at the pooler. Run DDL against the direct endpoint (drop -pooler from the host).'
    );
    process.exit(1);
  }

  const sql = neon(databaseUrl);

  await sql`DROP VIEW IF EXISTS growth_page_events`;
  await sql`
    CREATE VIEW growth_page_events AS
    SELECT
      event_type,
      session_id,
      created_at,
      metadata->>'origin' AS origin,
      metadata->>'path' AS path
    FROM analytics_events
  `;
  console.log('growth_page_events: ok');

  await sql`DROP VIEW IF EXISTS growth_accounts`;
  await sql`
    CREATE VIEW growth_accounts AS
    SELECT
      u.created_at,
      u.acquisition,
      -- Renamed from origin, which means the rail that minted the account and
      -- is a different thing from acquisition, which means where the browser
      -- came from. A query that filters one and groups by the other while both
      -- are called origin is how the two get confused. (No backticks anywhere
      -- in here: this SQL lives in a template literal and one would end it.)
      u.origin AS rail,
      EXISTS (
        SELECT 1 FROM credit_lots l
        WHERE l.user_id = u.id AND l.amount_cents > 0
      ) AS bought
    FROM users u
  `;
  console.log('growth_accounts: ok');

  /**
   * Purchases with the rail attached.
   *
   * The totals used to read `credit_lots` directly, which counted an x402
   * settlement as a purchase while the signup side already excluded the x402
   * rail. An agent paying onchain then appeared as a human buyer and could
   * silence the watchlist line that exists to notice zero conversion. The rail
   * has to travel with the lot for the report to tell the two funnels apart,
   * and that means a join, and a join here rather than in the report is what
   * keeps `users` out of the query.
   *
   * LEFT JOIN, not INNER: a lot whose account has since been erased is still a
   * payment that happened, and dropping it would quietly reduce revenue.
   */
  await sql`DROP VIEW IF EXISTS growth_purchases`;
  await sql`
    CREATE VIEW growth_purchases AS
    SELECT
      l.created_at,
      l.amount_cents,
      u.origin AS rail
    FROM credit_lots l
    LEFT JOIN users u ON u.id = l.user_id
  `;
  console.log('growth_purchases: ok');

  /**
   * Granted here rather than in `migrate-grant-readonly.ts`, because that
   * script's list is tables and its loop would have to learn the difference.
   * A view's grant is also inseparable from the view: recreating one above
   * drops its grants with it, so the two belong in the same run or the next
   * revision silently locks CI out.
   */
  // Written out rather than looped over a list of names. An identifier cannot
  // be a bound parameter, so a loop would have to build the statement by
  // interpolation, and the tagged-template driver would either refuse it or
  // send the name as a value. Two statements is the honest shape.
  await sql`GRANT SELECT ON growth_page_events TO sweep_runner`;
  console.log('grant growth_page_events to sweep_runner: ok');
  await sql`GRANT SELECT ON growth_accounts TO sweep_runner`;
  console.log('grant growth_accounts to sweep_runner: ok');
  await sql`GRANT SELECT ON growth_purchases TO sweep_runner`;
  console.log('grant growth_purchases to sweep_runner: ok');

  const verify = (await sql`
    SELECT
      c.relname AS name,
      has_table_privilege('sweep_runner', c.oid, 'SELECT') AS readable
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN (
        'growth_page_events', 'growth_accounts', 'growth_purchases'
      )
      AND c.relkind = 'v'
    ORDER BY c.relname
  `) as unknown as Array<{ name: string; readable: boolean }>;

  console.table(verify);
  if (verify.length !== 3 || verify.some((v) => !v.readable)) {
    console.error(
      'All three views must exist and be readable by sweep_runner. They are not.'
    );
    process.exit(1);
  }

  // Proves the views answer, not merely that they exist: a view over a renamed
  // column creates fine and fails on first read.
  const [events] = (await sql`
    SELECT count(*)::int AS n FROM growth_page_events WHERE event_type = 'page_view'
  `) as unknown as Array<{ n: number }>;
  const [accounts] = (await sql`
    SELECT count(*)::int AS n FROM growth_accounts
  `) as unknown as Array<{ n: number }>;
  const [purchases] = (await sql`
    SELECT count(*)::int AS n FROM growth_purchases WHERE amount_cents > 0
  `) as unknown as Array<{ n: number }>;
  console.log(
    `readback: ${events.n} page views, ${accounts.n} accounts, ${purchases.n} paid lots`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
