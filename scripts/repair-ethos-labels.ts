/**
 * One-time repair: strip 'ethos' from rows where it labelled a handle it never
 * attested.
 *
 * Usage: npx tsx --env-file=.env.local scripts/repair-ethos-labels.ts [--apply]
 *
 * The first version of the sweep appended the source unconditionally. A wallet
 * where the source named a different account kept our handle, correctly, and
 * then took their label anyway, so the public API reported `attested-social`
 * for evidence that names somebody else. 2,479 rows were affected and are
 * fixed; the upsert is now gated on the same agreement test as the account id,
 * so it cannot recur.
 *
 * Kept rather than deleted because it is the record of what happened, and it is
 * idempotent: a second run finds nothing and writes nothing.
 *
 * Scores are RECOMPUTED with the real scorer rather than restored from a
 * remembered value. 129 rows had been raised to 60 by a label they should not
 * have had, and the correct number is whatever `calculateQualityScore` says
 * about the sources that remain.
 */
import { neon } from '@neondatabase/serverless';
import { calculateQualityScore } from '../lib/social-graph';
const sql = neon(process.env.DATABASE_URL!);
async function main() {
  const dry = !process.argv.includes('--apply');

  const [before] = (await sql`
    SELECT count(*)::int AS mislabelled,
           count(*) FILTER (WHERE g.data_quality_score = 60)::int AS score_raised_to_60
    FROM handle_conflicts c JOIN social_graph g ON g.wallet = c.wallet
    WHERE c.resolved_at IS NULL AND 'ethos' = ANY(g.sources)`) as any[];
  console.log(`mislabelled rows: ${before.mislabelled}`);
  console.log(`  of which quality was raised to exactly 60: ${before.score_raised_to_60}`);

  if (dry) { console.log('\ndry run. pass --apply to write.'); return; }

  await sql`
    UPDATE social_graph g
    SET sources = array_remove(g.sources, 'ethos')
    FROM handle_conflicts c
    WHERE c.wallet = g.wallet AND c.resolved_at IS NULL
      AND 'ethos' = ANY(g.sources)
      AND lower(g.twitter_handle) <> lower(c.theirs)`;

  // Recompute, never restore-from-memory: 129 rows had their score raised by a
  // label they should not have had. The correct value is whatever the real
  // scorer says about the sources that remain.
  const stale = (await sql`
    SELECT wallet, sources, twitter_handle, farcaster, data_quality_score
    FROM social_graph
    WHERE wallet IN (SELECT wallet FROM handle_conflicts WHERE resolved_at IS NULL)
      AND data_quality_score = 60`) as any[];
  let rescored = 0;
  for (const r of stale) {
    const correct = calculateQualityScore(r.sources ?? [], !!r.twitter_handle, !!r.farcaster);
    if (correct === r.data_quality_score) continue;
    await sql`UPDATE social_graph SET data_quality_score = ${correct} WHERE wallet = ${r.wallet}`;
    rescored++;
  }
  console.log(`rescored ${rescored} of ${stale.length} rows using the real scorer`);

  const [after] = (await sql`
    SELECT count(*)::int AS n FROM handle_conflicts c JOIN social_graph g ON g.wallet = c.wallet
    WHERE c.resolved_at IS NULL AND 'ethos' = ANY(g.sources)`) as any[];
  console.log(`\nmislabelled rows remaining: ${after.n}`);

  const [sanity] = (await sql`
    SELECT count(*)::int AS n FROM social_graph WHERE 'ethos' = ANY(sources)`) as any[];
  console.log(`rows still legitimately sourced from ethos: ${sanity.n}`);
  const [empty] = (await sql`
    SELECT count(*)::int AS n FROM social_graph
    WHERE sources IS NOT NULL AND array_length(sources,1) IS NULL`) as any[];
  console.log(`rows left with an empty sources array (must be 0): ${empty.n}`);
}
main();
