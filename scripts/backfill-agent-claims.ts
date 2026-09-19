/**
 * Withdraw the agent claim from graph rows whose owner said otherwise.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/backfill-agent-claims.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/backfill-agent-claims.ts
 *
 * `lib/agent-claim.ts` stops NEW rows carrying a false agent label. This is the
 * rows already written: `social_graph.is_agent` was set from `known_agents` on
 * every lookup that ever touched one of these wallets, and a stored row is
 * served from the graph and the cache without re-deriving anything.
 *
 * ## What it changes, and what it deliberately does not
 *
 * It clears the agent columns on `social_graph` rows where the wallet carries
 * an owner-attested identity that is NOT the agent's own. It does not touch
 * `known_agents`, which is an L0 fact with provenance and is the pipeline's to
 * write; the claim is still true of the agent, it is just not true of this
 * address. It does not set `is_agent = false` either, on the absent-is-not-
 * false rule: false is a claim that we looked and it is not an agent, and what
 * happened is that we decline to say.
 *
 * Saved lookups in `lookup_history` are left alone. They are a record of what a
 * customer was shown on a date, the same reasoning that keeps the per-removal
 * amend narrow, and rewriting them would make an old export disagree with the
 * file the customer already downloaded.
 */
import { neon } from '@neondatabase/serverless';

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const sql = neon(databaseUrl);

  /**
   * The predicate, stated once and used for both the count and the update.
   *
   * `a.twitter_handle IS DISTINCT FROM` rather than `<>`: the common case is
   * the agent record having NO handle of its own (403 of 536 measured), and
   * inequality against NULL yields NULL, which would quietly exclude exactly
   * the rows this exists for.
   */
  const affected = await sql`
    SELECT count(*)::int AS n
    FROM social_graph g
    JOIN known_agents a ON a.wallet = g.wallet
    WHERE g.is_agent IS TRUE
      AND (g.twitter_verified IS TRUE OR g.farcaster_verified IS TRUE)
      AND (a.twitter_handle IS NULL
           OR (lower(a.twitter_handle) IS DISTINCT FROM lower(g.twitter_handle)
               AND lower(a.twitter_handle) IS DISTINCT FROM lower(g.farcaster)))
  `;
  const n = affected[0]?.n ?? 0;
  console.log(`rows whose owner attested a different identity: ${n}`);

  const kept = await sql`
    SELECT count(*)::int AS n
    FROM social_graph g
    JOIN known_agents a ON a.wallet = g.wallet
    WHERE g.is_agent IS TRUE
      AND (g.twitter_verified IS TRUE OR g.farcaster_verified IS TRUE)
      AND (lower(a.twitter_handle) = lower(g.twitter_handle)
           OR lower(a.twitter_handle) = lower(g.farcaster))
  `;
  console.log(`agent rows whose own account IS the attested one, kept: ${kept[0]?.n ?? 0}`);

  if (DRY_RUN) {
    const sample = await sql`
      SELECT g.wallet, a.name AS agent, a.twitter_handle AS agent_handle,
             g.twitter_handle AS owner_handle, g.farcaster AS owner_farcaster
      FROM social_graph g
      JOIN known_agents a ON a.wallet = g.wallet
      WHERE g.is_agent IS TRUE
        AND (g.twitter_verified IS TRUE OR g.farcaster_verified IS TRUE)
        AND (a.twitter_handle IS NULL
             OR (lower(a.twitter_handle) IS DISTINCT FROM lower(g.twitter_handle)
                 AND lower(a.twitter_handle) IS DISTINCT FROM lower(g.farcaster)))
      LIMIT 8
    `;
    console.log('\nsample:');
    for (const r of sample) console.log(' ', r);
    console.log('\nDry run. Re-run without --dry-run to apply.');
    return;
  }

  const updated = await sql`
    UPDATE social_graph g
    SET is_agent           = NULL,
        agent_name         = NULL,
        agent_framework    = NULL,
        agent_type         = NULL,
        agent_token_symbol = NULL,
        agent_verified     = NULL
    FROM known_agents a
    WHERE a.wallet = g.wallet
      AND g.is_agent IS TRUE
      AND (g.twitter_verified IS TRUE OR g.farcaster_verified IS TRUE)
      AND (a.twitter_handle IS NULL
           OR (lower(a.twitter_handle) IS DISTINCT FROM lower(g.twitter_handle)
               AND lower(a.twitter_handle) IS DISTINCT FROM lower(g.farcaster)))
    RETURNING g.wallet
  `;
  console.log(`\ncleared ${updated.length} row(s).`);

  const remaining = await sql`
    SELECT count(*)::int AS n
    FROM social_graph g
    JOIN known_agents a ON a.wallet = g.wallet
    WHERE g.is_agent IS TRUE
      AND (g.twitter_verified IS TRUE OR g.farcaster_verified IS TRUE)
      AND (a.twitter_handle IS NULL
           OR (lower(a.twitter_handle) IS DISTINCT FROM lower(g.twitter_handle)
               AND lower(a.twitter_handle) IS DISTINCT FROM lower(g.farcaster)))
  `;
  if ((remaining[0]?.n ?? 0) !== 0) {
    console.error(`\nStill ${remaining[0].n} left. The update did not fully apply.`);
    process.exit(1);
  }
  console.log('verified: none remain.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
