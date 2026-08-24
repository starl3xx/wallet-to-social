/**
 * Resolve X handles to accounts, in resumable chunks.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/sweep-x-accounts.ts [--limit N] [--credit-cap N] [--dry]
 *
 * Resumable by construction: it asks for handles that have never been checked or
 * were checked longer ago than the stale window, oldest first, so an interrupted
 * run continues rather than restarting. Safe to run repeatedly.
 *
 * A full first pass is 446,043 handles at 18 credits each, about 8.03M credits.
 * The account holds 10.5M a month, so the pass fits with roughly 2.5M to spare,
 * and every pass after it is cheaper: once a handle has resolved we hold its id,
 * and by-id lookups batch at 10 credits.
 */
import {
  pendingHandles,
  sweepHandles,
  remainingCredits,
  CREDITS_PER_LOOKUP,
} from '../lib/x-accounts';
import { isConfigured, resolverKey } from '../lib/x-resolver';

const arg = (name: string, fallback: number): number => {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

async function main() {
  const key = resolverKey();
  if (!isConfigured()) {
    console.error(
      'X_RESOLVER_API_BASE and X_RESOLVER_API_KEY are both required'
    );
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const limit = arg('limit', 5000);
  const dry = process.argv.includes('--dry');

  const balance = await remainingCredits(key);
  console.log(
    `credits available: ${balance === null ? 'unknown' : balance.toLocaleString()}`
  );

  /**
   * Never spend more than nine tenths of what is there.
   *
   * The holder index was hard-blocked by its provider mid-afternoon because a
   * guard that was supposed to stop that had silently never recorded anything.
   * The lesson was not "add a guard", it was "a guard you cannot see working is
   * not a guard", so this one prints what it will allow before it starts.
   */
  const defaultCap =
    balance === null ? limit * CREDITS_PER_LOOKUP : Math.floor(balance * 0.9);
  const creditCap = arg('credit-cap', defaultCap);

  const handles = await pendingHandles(limit);
  console.log(
    `handles to resolve this run: ${handles.length.toLocaleString()}`
  );
  console.log(
    `credit cap: ${creditCap.toLocaleString()} ` +
      `(this run would spend at most ${(handles.length * CREDITS_PER_LOOKUP).toLocaleString()})`
  );

  if (handles.length === 0) {
    console.log(
      '\nnothing pending. every handle has been checked inside the stale window.'
    );
    return;
  }
  if (dry) {
    console.log('\ndry run. first 10:', handles.slice(0, 10).join(', '));
    return;
  }

  const started = Date.now();
  const progress = await sweepHandles(handles, key, {
    creditCap,
    onProgress: (p) => {
      const rate = p.checked / ((Date.now() - started) / 1000);
      console.log(
        `  ${p.checked.toLocaleString()}/${handles.length.toLocaleString()}  ` +
          `live ${p.live.toLocaleString()}  gone ${p.notFound.toLocaleString()}  ` +
          `unavailable ${p.unavailable}  failed ${p.failed}  ` +
          `${rate.toFixed(0)}/s  controls ok`
      );
    },
  });

  const seconds = (Date.now() - started) / 1000;
  const answered = progress.live + progress.notFound + progress.unavailable;
  console.log(`\n${'─'.repeat(64)}`);
  console.log(
    `checked        ${progress.checked.toLocaleString()} in ${seconds.toFixed(0)}s`
  );
  console.log(`  live         ${progress.live.toLocaleString()}`);
  console.log(
    `  not found    ${progress.notFound.toLocaleString()}` +
      (answered
        ? `  (${((progress.notFound / answered) * 100).toFixed(2)}%)`
        : '')
  );
  console.log(`  unavailable  ${progress.unavailable.toLocaleString()}`);
  console.log(
    `  failed       ${progress.failed.toLocaleString()}  (not recorded, will retry)`
  );
  console.log(`credits spent  ${progress.creditsSpent.toLocaleString()}`);
  const after = await remainingCredits(key);
  if (after !== null) console.log(`credits left   ${after.toLocaleString()}`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
