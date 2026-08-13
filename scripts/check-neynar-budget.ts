/** Print the current Neynar credit position and what background work it allows. */
import {
  getPeriodSpend,
  checkBackgroundBudget,
  BACKGROUND_CEILING,
  MONTHLY_CREDIT_LIMIT,
} from '../lib/neynar-budget';

async function main() {
  const spent = await getPeriodSpend();
  console.log(`plan limit:         ${MONTHLY_CREDIT_LIMIT.toLocaleString()}`);
  console.log(`background ceiling: ${BACKGROUND_CEILING.toLocaleString()}`);
  console.log(`spent this period:  ${spent.toLocaleString()}`);
  console.log(`reserved for users: ${(MONTHLY_CREDIT_LIMIT - BACKGROUND_CEILING).toLocaleString()}\n`);

  for (const [label, n] of [
    ['daily incremental sweep (30k FIDs)', 30_000],
    ['daily seed run (~6k)', 6_000],
    ['refresh-stale run (100)', 100],
    ['full sweep resume (~900k)', 900_000],
  ] as Array<[string, number]>) {
    const c = await checkBackgroundBudget(n);
    console.log(`  ${c.allowed ? 'ALLOWED' : 'BLOCKED'}  ${label}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
