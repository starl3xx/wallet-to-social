/**
 * One-time repair: lowercase X handles that were stored as a source wrote them.
 *
 * Usage: npx tsx --env-file=.env.local scripts/repair-handle-casing.ts [--apply]
 *
 * Reverse lookup compares a lowercased query with `eq`, so a mixed-case row is
 * present, correct and unfindable by handle search. Two adapters skipped
 * `cleanTwitterHandle` and stored 3,566 rows that way. Normalisation now happens
 * in `lib/attested-links.ts`, where no adapter can forget it.
 *
 * Not scoped to those two sources on purpose: the defect is "reverse lookup
 * cannot find this row", and it does not care which source wrote it.
 */
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL!);

async function main() {
  const dry = !process.argv.includes('--apply');

  const [before] = (await sql`
    SELECT count(*)::int AS mixed FROM social_graph
    WHERE twitter_handle IS NOT NULL AND twitter_handle <> lower(twitter_handle)`) as any[];
  console.log(
    `rows with a mixed-case handle: ${before.mixed.toLocaleString()}`
  );

  const bySource = (await sql`
    SELECT unnest(sources) AS source, count(*)::int AS n FROM social_graph
    WHERE twitter_handle IS NOT NULL AND twitter_handle <> lower(twitter_handle)
    GROUP BY 1 ORDER BY n DESC`) as any[];
  for (const r of bySource)
    console.log(`  ${String(r.source).padEnd(18)} ${r.n}`);

  // A collision means two wallets, or the same wallet twice, that only differed
  // by case. Worth knowing before writing, though the primary key is the wallet
  // so lowercasing a handle cannot collide rows.
  if (dry) {
    console.log('\ndry run. pass --apply to write.');
    return;
  }

  await sql`
    UPDATE social_graph
    SET twitter_handle = lower(twitter_handle),
        twitter_url = 'https://x.com/' || lower(twitter_handle)
    WHERE twitter_handle IS NOT NULL AND twitter_handle <> lower(twitter_handle)`;

  const [after] = (await sql`
    SELECT count(*)::int AS mixed FROM social_graph
    WHERE twitter_handle IS NOT NULL AND twitter_handle <> lower(twitter_handle)`) as any[];
  console.log(`\nremaining mixed-case rows: ${after.mixed}`);

  const [u] = (await sql`
    SELECT count(*)::int AS n FROM social_graph
    WHERE twitter_handle IS NOT NULL AND twitter_url <> 'https://x.com/' || twitter_handle`) as any[];
  console.log(`rows whose url disagrees with its handle: ${u.n}`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
