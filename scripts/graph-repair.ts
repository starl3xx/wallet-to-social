/**
 * Apply the safe `social_graph` repairs, or report what they would do.
 *
 *   npx tsx --env-file=.env.local scripts/graph-repair.ts          # dry run
 *   npx tsx --env-file=.env.local scripts/graph-repair.ts --apply  # writes
 *
 * The repairs, their ceilings and the reasoning behind each are in
 * `lib/graph-repair.ts`. This file is only a way to run them by hand; the
 * weekly cron calls the same functions, so the two cannot drift.
 *
 * Run `scripts/graph-audit.ts` first if you want the full picture. This prints
 * only what it can fix, plus what it deliberately will not.
 */

import { REPAIRS, runGraphRepairs, findUnrepairable } from '../lib/graph-repair';

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const apply = process.argv.includes('--apply');
  console.log(apply ? '\nAPPLYING repairs\n' : '\nDRY RUN — nothing will be written\n');

  const run = await runGraphRepairs(apply);

  const byId = new Map(REPAIRS.map((r) => [r.id, r]));
  for (const r of run.results) {
    const spec = byId.get(r.id);
    if (r.refused) {
      console.log(`REFUSED  ${r.id}`);
      console.log(`         ${r.refused}\n`);
      continue;
    }
    if (r.found === 0) {
      console.log(`ok       ${r.id}`);
      continue;
    }
    console.log(`${apply ? 'fixed   ' : 'would   '} ${r.id}: ${r.found.toLocaleString()} rows`);
    if (spec) console.log(`         ${spec.describes}`);
  }

  console.log(
    `\n${run.totalFound.toLocaleString()} rows found, ` +
      `${run.totalChanged.toLocaleString()} changed, ${run.refusals} repairs refused.`
  );

  const blocked = await findUnrepairable();
  const real = blocked.filter((b) => b.count > 0);
  if (real.length > 0) {
    console.log('\nNot repairable here — each needs an answer from outside the row:');
    for (const b of real) {
      console.log(`  ${String(b.count).padStart(6)}  ${b.id}`);
      console.log(`          needs ${b.needs}`);
    }
  }

  if (!apply && run.totalFound > 0) {
    console.log('\nRe-run with --apply to write these.');
  }
  console.log();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
