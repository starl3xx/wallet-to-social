/**
 * The public block explorers behind the metered holder index, checked live.
 *
 * Usage: npx tsx --env-file=.env.local scripts/check-holder-fallback.ts
 *
 * ## Why this exists
 *
 * `BLOCKSCOUT_BASE_URLS` promises that a customer whose ERC-20 import meets a
 * spent allowance gets their holders anyway, from that chain's public explorer.
 * Every one of those URLs belongs to somebody else. They move, they retire an
 * API version, they go behind a key, and none of that arrives as a commit in
 * this repository. The promise can therefore become false with no diff, no PR
 * and nothing to review, which is the same shape as the published-figures drift
 * and needs the same answer: a check on a timer.
 *
 * It is deliberately a *fallback* check. Nothing here runs in the customer path
 * and a failure is not an outage. It means the safety net under one chain has a
 * hole in it, and the time to find that out is now, not on the day the
 * allowance runs out.
 *
 * ## What it actually exercises
 *
 * The real code path, not a re-implementation. `MORALIS_API_KEY` is removed
 * from the environment before `lib/contract-holders` is imported, so the
 * metered index throws MORALIS_NOT_CONFIGURED, and the fallback that catches it
 * is the same one a spent allowance would reach. A probe that called the
 * explorer directly would prove the explorer works and prove nothing about
 * whether we can reach it.
 *
 * ## On the tokens
 *
 * Each is a real ERC-20 with 60k–75k holders, taken off that explorer's own
 * token list on 2026-08-17 so no address was guessed, and verified by symbol.
 * Customer-sized on purpose: USDC has 12.7M holders on Base and 4.2M on
 * Polygon and times out on both at every page size, which reads as a dead
 * explorer and is not one.
 *
 * A token is only ever wrong here in a way that shows up as a failure, never as
 * a false pass: if one is delisted or renamed the check reports it and the fix
 * is to pick another off the same list.
 */
import {
  CHAIN_LABELS,
  hasPublicHolderFallback,
  SUPPORTED_CHAINS,
  type SupportedChain,
} from '../lib/contract-holders';

/**
 * Removed BEFORE the dynamic import below, which is what makes this a test of
 * the fallback rather than of the metered index. `lib/contract-holders` reads
 * the key at call time, so the order that matters is env-then-call, but the
 * import is dynamic anyway so a future module-load-time read cannot quietly
 * turn this check into a no-op.
 */
delete process.env.MORALIS_API_KEY;

interface Probe {
  chain: SupportedChain;
  token: string;
  symbol: string;
}

const PROBES: Probe[] = [
  { chain: 'ethereum', token: '0x163f8c2467924be0ae7b5347228cabf260318753', symbol: 'WLD' },
  { chain: 'base', token: '0x236aa50979d5f3de3bd1eeb40e81137f22ab794b', symbol: 'TBTC' },
  { chain: 'arbitrum', token: '0x0c880f6761f1af8d9aa9c466984b80dab9a8c9e8', symbol: 'PENDLE' },
  { chain: 'polygon', token: '0x53e0bca35ec356bd5dddfebbd1fc0fd03fabad39', symbol: 'LINK' },
  { chain: 'optimism', token: '0x93919784c523f39cacaa98ee0a9d96c3f32b593e', symbol: 'UNIBTC' },
];

/**
 * Ask for far fewer holders than a customer would.
 *
 * The check is "can we reach this explorer and read holders from it", which one
 * page answers. Pulling 5,000 rows off five free explorers every week to learn
 * the same thing would be rude, and on Base it would take most of a minute.
 */
const PROBE_LIMIT = 200;

async function main() {
  const { getContractHolders } = await import('../lib/contract-holders');

  /**
   * Every chain that claims a fallback must be probed.
   *
   * Derived from `hasPublicHolderFallback` rather than from PROBES, so adding a
   * chain to `BLOCKSCOUT_BASE_URLS` and forgetting to add it here fails the
   * check instead of silently narrowing it. A guard that only checks what it
   * was told about reports success for coverage it does not have.
   */
  const claimed = SUPPORTED_CHAINS.filter(hasPublicHolderFallback);
  const probed = new Set(PROBES.map((p) => p.chain));
  const unprobed = claimed.filter((c) => !probed.has(c));
  const stale = PROBES.filter((p) => !claimed.includes(p.chain));

  const failures: string[] = [];

  for (const chain of unprobed) {
    failures.push(
      `${CHAIN_LABELS[chain]}: declares a public fallback but has no probe token in this script`
    );
  }
  for (const p of stale) {
    failures.push(
      `${CHAIN_LABELS[p.chain]}: probed here but no longer declares a public fallback — remove it`
    );
  }

  for (const probe of PROBES) {
    if (!claimed.includes(probe.chain)) continue;
    const label = CHAIN_LABELS[probe.chain];
    const startedAt = Date.now();

    try {
      const result = await getContractHolders(probe.token, probe.chain, PROBE_LIMIT);
      const ms = Date.now() - startedAt;

      if (result.wallets.length === 0) {
        failures.push(`${label}: explorer reachable but returned no holders for ${probe.symbol}`);
        continue;
      }

      /**
       * A holder list whose rows are not addresses is worse than an empty one,
       * because everything downstream treats it as a real import. Cheap to
       * check and it catches an explorer that changed its response shape, which
       * is the most likely way one of these breaks without going offline.
       */
      const malformed = result.wallets.filter((w) => !/^0x[0-9a-f]{40}$/.test(w));
      if (malformed.length > 0) {
        failures.push(
          `${label}: ${malformed.length} of ${result.wallets.length} rows are not wallet addresses ` +
            `(first: ${malformed[0]})`
        );
        continue;
      }

      console.log(
        `  ok   ${label.padEnd(15)} ${String(result.wallets.length).padStart(4)} holders ` +
          `of ${probe.symbol} in ${(ms / 1000).toFixed(1)}s` +
          (result.totalHolders > 0 ? ` (of ${result.totalHolders.toLocaleString()} total)` : '')
      );
    } catch (error) {
      /**
       * The metered error is rethrown on purpose, so `message` here is always
       * MORALIS_NOT_CONFIGURED and says nothing about the fallback. `cause`
       * carries the fallback's own error and is the only thing that separates
       * "the net failed" from "the net was never wired up".
       */
      const cause = error instanceof Error ? error.cause : undefined;
      const causeMessage =
        cause instanceof Error ? cause.message : cause ? String(cause) : null;

      /**
       * A 429 is not rot, and must not fail this check.
       *
       * It means the explorer is alive, answering, and busy — which is the
       * opposite of the thing this check exists to detect. Failing on it would
       * make a weekly alarm that fires when a free service has a popular
       * minute, and an alarm that cries wolf gets ignored on the week it is
       * right. Reported and passed.
       */
      if (causeMessage === 'RATE_LIMIT') {
        console.log(
          `  busy ${label.padEnd(15)} explorer reachable but throttling us — not a failure`
        );
        continue;
      }

      const detail =
        causeMessage === null
          ? 'the fallback never engaged — the metered error was rethrown with no cause attached'
          : causeMessage;
      failures.push(`${label}: ${detail}`);
    }
  }

  console.log('');
  if (failures.length > 0) {
    console.error(`Holder fallback check FAILED (${failures.length}):\n`);
    for (const f of failures) console.error(`  - ${f}`);
    console.error(
      '\nA failure here is a hole in the safety net, not an outage. ERC-20 import still\n' +
        'works while the metered allowance holds; it just has nothing behind it on that\n' +
        'chain. Fix the URL in BLOCKSCOUT_BASE_URLS, or drop the chain from it so the\n' +
        'code stops promising a fallback it does not have.'
    );
    process.exit(1);
  }

  console.log(`Holder fallback intact on all ${claimed.length} chains that claim one.`);
}

main().catch((error) => {
  console.error('check-holder-fallback crashed:', error);
  process.exit(1);
});
