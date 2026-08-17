/**
 * Migration: an X account id on social_graph, and a table for handle conflicts.
 *
 * Usage: npx tsx --env-file=.env.local scripts/migrate-ethos.ts
 *
 * Applied by hand rather than with drizzle-kit push, because production has
 * known drift from db/schema.ts on other tables and push would try to reconcile
 * those too. Idempotent: safe to run more than once.
 *
 * ## Why an account id is worth a column
 *
 * Every X handle in the graph is a string captured at one moment. Farcaster,
 * which is where 1,039,550 of our 1,070,680 handles come from, stores the same
 * string and no id, so when a person renames on X, nothing anywhere notices.
 * A random sample of 300 swept handles on 2026-08-16 found 23 that no longer
 * resolve to any account at all, which is 7.7%.
 *
 * An id does not rot. This column is the first place in the pipeline that can
 * tell a rename from a dead account, and it is only ever written next to a
 * handle proven to belong to it.
 *
 * ## Why conflicts get a table instead of a resolution rule
 *
 * When two attested sources disagree about a wallet's handle, the disagreement
 * is evidence, not noise to be settled by whichever source wrote last. Measured
 * on 250 real conflicts: 54% of the time our handle no longer resolves, and of
 * the cases where both handles are live, 90% of the time ours belongs to a
 * different person who does not claim the wallet. A silent overwrite would
 * throw that signal away, and a silent keep would go on serving it.
 */

import { neon } from '@neondatabase/serverless';

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const sql = neon(databaseUrl);

  await sql`ALTER TABLE social_graph ADD COLUMN IF NOT EXISTS twitter_user_id text`;
  console.log('column social_graph.twitter_user_id: ok');

  // Partial: the column is null on almost every row today, and an index over
  // four million nulls is pure cost.
  await sql`
    CREATE INDEX IF NOT EXISTS social_graph_twitter_user_id_idx
    ON social_graph (twitter_user_id) WHERE twitter_user_id IS NOT NULL
  `;
  console.log('index social_graph_twitter_user_id_idx: ok');

  await sql`
    CREATE TABLE IF NOT EXISTS handle_conflicts (
      wallet          text        NOT NULL,
      platform        text        NOT NULL DEFAULT 'twitter',
      ours            text        NOT NULL,
      our_sources     text[],
      theirs          text        NOT NULL,
      their_source    text        NOT NULL,
      their_user_id   text,
      first_seen_at   timestamp   NOT NULL DEFAULT now(),
      last_seen_at    timestamp   NOT NULL DEFAULT now(),
      resolved_at     timestamp,
      resolution      text,
      PRIMARY KEY (wallet, platform, their_source)
    )
  `;
  console.log('table handle_conflicts: ok');

  // The open queue is what anyone actually reads.
  await sql`
    CREATE INDEX IF NOT EXISTS handle_conflicts_unresolved_idx
    ON handle_conflicts (last_seen_at DESC) WHERE resolved_at IS NULL
  `;
  console.log('index handle_conflicts_unresolved_idx: ok');

  const [cols] = (await sql`
    SELECT count(*)::int AS n
    FROM information_schema.columns
    WHERE table_name = 'social_graph' AND column_name = 'twitter_user_id'
  `) as unknown as Array<{ n: number }>;
  const [tbl] = (await sql`
    SELECT count(*)::int AS n
    FROM information_schema.tables WHERE table_name = 'handle_conflicts'
  `) as unknown as Array<{ n: number }>;

  if (cols.n !== 1 || tbl.n !== 1) {
    console.error(`verification failed: column=${cols.n} table=${tbl.n}`);
    process.exit(1);
  }
  console.log('\nverified: column and table both present');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
