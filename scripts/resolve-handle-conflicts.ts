/**
 * Resolve the handle conflicts where our handle reaches nobody and theirs is live.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/resolve-handle-conflicts.ts [--dry-run] [--limit N] [--credit-cap N] [--recheck-days N]
 *
 * The daily cron (`/api/cron/resolve-conflicts`) does the same thing on a
 * schedule. This entry exists for the first run, which is the big one: on
 * 2026-08-22 the open queue held 1,602 conflicts of this shape, and every
 * reachability check behind them was five days old, so a run before 2026-08-24
 * accepts them without spending a credit. After that the checks age past the
 * seven-day window and each row costs two lookups to re-qualify, at a cap of
 * about fourteen lookups a day.
 *
 * `--dry-run` reads, re-qualifies, prints the counts and a sample of twenty,
 * and writes nothing, which includes the rechecks: a recheck is a write to
 * `x_accounts`, so a dry run reports how many it would make instead.
 */
import {
  resolveUnreachableConflicts,
  DEFAULT_RECHECK_CREDITS,
  RECHECK_DAYS,
} from '../lib/conflict-resolution';
import { isConfigured, resolverKey } from '../lib/x-resolver';

const arg = (name: string, fallback: number): number => {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
};

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const dryRun = process.argv.includes('--dry-run');
  const limitArg = arg('limit', -1);
  const limit = limitArg >= 0 ? limitArg : undefined;
  const creditCap = arg(
    'credit-cap',
    Number(process.env.CONFLICT_RECHECK_CREDITS ?? DEFAULT_RECHECK_CREDITS)
  );
  const recheckDays = arg('recheck-days', RECHECK_DAYS);

  const key = isConfigured() ? resolverKey() : '';
  if (!key) {
    console.log(
      'resolver not configured: stale or unchecked sides will not be re-checked'
    );
  }
  console.log(
    `${dryRun ? '[DRY RUN] ' : ''}recheck window ${recheckDays}d, credit cap ${creditCap.toLocaleString()}` +
      (limit !== undefined ? `, limit ${limit.toLocaleString()}` : '')
  );

  const started = Date.now();
  const out = await resolveUnreachableConflicts({
    key,
    creditCap,
    recheckDays,
    dryRun,
    limit,
  });
  const seconds = (Date.now() - started) / 1000;

  console.log(`\n${'─'.repeat(64)}`);
  console.log(
    `candidates      ${out.candidates.toLocaleString()}  (open, ours not known live)`
  );
  console.log(
    `eligible        ${out.eligible.toLocaleString()}  (qualify now)`
  );
  for (const [reason, n] of Object.entries(out.blocked)) {
    if (n > 0) console.log(`  ${reason.padEnd(18)} ${n.toLocaleString()}`);
  }
  console.log(
    `re-check        wanted ${out.recheck.wanted.toLocaleString()}, ` +
      `${dryRun ? 'would send' : 'sent'} ${out.recheck.requested.toLocaleString()}` +
      (out.recheck.skipped ? `  (${out.recheck.skipped})` : '')
  );
  if (out.recheck.progress) {
    const p = out.recheck.progress;
    console.log(
      `  checked ${p.checked}  live ${p.live}  gone ${p.notFound}  unavailable ${p.unavailable}  ` +
        `failed ${p.failed}  credits ${p.creditsSpent.toLocaleString()}`
    );
  }
  if (dryRun) {
    console.log(
      `would accept    ${(limit !== undefined ? Math.min(limit, out.eligible) : out.eligible).toLocaleString()}  (nothing written)`
    );
  } else {
    console.log(
      `accepted        ${out.accepted.toLocaleString()} conflicts on ${out.walletsUpdated.toLocaleString()} wallets`
    );
    console.log(`cache rows gone ${out.cacheRowsDeleted.toLocaleString()}`);
    console.log(
      `closed inert    ${out.closedBothDead.toLocaleString()} (neither handle reachable)`
    );
    if (out.reopenedBothDead > 0) {
      console.log(
        `reopened        ${out.reopenedBothDead.toLocaleString()} (a side is live again)`
      );
    }
  }
  console.log(`took            ${seconds.toFixed(1)}s`);

  if (out.sample.length > 0) {
    console.log(`\nsample of ${out.sample.length}:`);
    console.log(
      `  ${'wallet'.padEnd(42)} ${'ours'.padEnd(18)} ${'status'.padEnd(12)} ${'theirs'.padEnd(18)} source`
    );
    for (const s of out.sample) {
      console.log(
        `  ${s.wallet.padEnd(42)} ${s.ours.padEnd(18)} ${s.status.padEnd(12)} ${s.theirs.padEnd(18)} ${s.source}`
      );
    }
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
