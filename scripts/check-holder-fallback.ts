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
/**
 * Type-only, and every value comes from the dynamic import inside `main`.
 *
 * **Do not add a value import from `lib/contract-holders` here.** A static one
 * evaluates that module before the `delete` below runs, and the later
 * `import()` then returns the already-evaluated copy from the module cache. The
 * env change would arrive too late for anything read at module scope, and the
 * protection described below would be a comment rather than a fact. `import
 * type` is erased at compile time and evaluates nothing, so it is safe.
 */
import type { SupportedChain } from '../lib/contract-holders';

/**
 * Removed BEFORE `lib/contract-holders` is ever evaluated, which is what makes
 * this a test of the fallback rather than of the metered index.
 *
 * Today that module reads the key at call time, so plain ordering would do. The
 * dynamic import is for tomorrow: if anyone adds a module-scope
 * `const KEY = process.env.MORALIS_API_KEY`, this check must keep exercising
 * the fallback instead of quietly passing through the metered index and
 * reporting green for coverage it never tested.
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
  // Every value this script needs, loaded after the env change above. See the
  // note on the type-only import at the top before moving any of these out.
  const { getContractHolders, CHAIN_LABELS, hasPublicHolderFallback, SUPPORTED_CHAINS } =
    await import('../lib/contract-holders');

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

  /**
   * One attempt against one chain. `null` means it worked.
   *
   * `busy` is separated from `failed` because the two deserve opposite
   * treatment: a throttled explorer is alive and answering, which is the
   * opposite of what this check exists to detect.
   */
  type Attempt = null | { busy: true } | { busy: false; detail: string };

  async function probeOnce(probe: Probe, label: string): Promise<Attempt> {
    const startedAt = Date.now();
    try {
      const result = await getContractHolders(probe.token, probe.chain, PROBE_LIMIT);
      const ms = Date.now() - startedAt;

      /**
       * A holder list whose rows are not addresses is worse than an empty one,
       * because everything downstream treats it as a real import. Cheap to
       * check and it catches an explorer that changed its response shape, which
       * is the most likely way one of these breaks without going offline.
       *
       * An *empty* list needs no branch here: `getContractHolders` raises
       * NO_HOLDERS before returning one, and that is handled below.
       */
      const malformed = result.wallets.filter((w) => !/^0x[0-9a-f]{40}$/.test(w));
      if (malformed.length > 0) {
        return {
          busy: false,
          detail:
            `${malformed.length} of ${result.wallets.length} rows are not wallet ` +
            `addresses (first: ${malformed[0]})`,
        };
      }

      console.log(
        `  ok   ${label.padEnd(15)} ${String(result.wallets.length).padStart(4)} holders ` +
          `of ${probe.symbol} in ${(ms / 1000).toFixed(1)}s` +
          (result.totalHolders > 0 ? ` (of ${result.totalHolders.toLocaleString()} total)` : '')
      );
      return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const cause = error instanceof Error ? error.cause : undefined;
      const causeMessage =
        cause instanceof Error ? cause.message : cause ? String(cause) : null;

      /**
       * NO_HOLDERS means the fallback ran and came back empty.
       *
       * It is raised by `getContractHolders` *after* the fallback has already
       * succeeded, so it must be read before the "never reached the fallback"
       * branch below — which would otherwise blame the chain's RPC for a result
       * the explorer produced.
       */
      if (message === 'NO_HOLDERS') {
        return {
          busy: false,
          detail: `the fallback ran and returned no holders at all for ${probe.symbol}`,
        };
      }

      /**
       * Anything else that is not the rethrown metered error never reached the
       * fallback, and its own message is the diagnosis.
       *
       * This branch is here because the first version assumed `message` was
       * always MORALIS_NOT_CONFIGURED and replaced it with an invented
       * explanation. CI then failed with "the fallback never engaged" for
       * Ethereum when the truth was that a public RPC had refused the runner
       * three steps earlier, and the real error had been thrown away by the
       * code whose job was to report it. Report what came back.
       */
      if (message !== 'MORALIS_NOT_CONFIGURED') {
        return {
          busy: false,
          detail:
            `could not get as far as the fallback — ${message} ` +
            `(this is the chain's RPC or the contract, not the explorer)`,
        };
      }

      if (causeMessage === 'RATE_LIMIT') return { busy: true };

      return {
        busy: false,
        detail:
          causeMessage === null
            ? 'the fallback never engaged — the metered error was rethrown with no cause attached'
            : causeMessage,
      };
    }
  }

  for (const probe of PROBES) {
    if (!claimed.includes(probe.chain)) continue;
    const label = CHAIN_LABELS[probe.chain];

    /**
     * Two attempts before calling it broken.
     *
     * Not flake-hiding, which would be reporting a pass on a failure. These are
     * free public services under load from everybody, and Base in particular
     * answers 500 or times out on a minority of requests while working fine on
     * the rest — measured across a dozen calls while building this. One attempt
     * therefore samples the service's bad minute as readily as its real state,
     * and a weekly alarm that fires on a coin flip is one nobody reads by the
     * time it is right.
     *
     * A second failure is reported in full, and a retry that had to be used is
     * printed, so an explorer degrading toward useless is visible long before
     * it fails outright.
     */
    let attempt = await probeOnce(probe, label);
    if (attempt !== null && attempt.busy === false) {
      console.log(`  ...  ${label.padEnd(15)} first attempt failed, retrying once`);
      await new Promise((r) => setTimeout(r, 3_000));
      attempt = await probeOnce(probe, label);
    }

    if (attempt === null) continue;
    if (attempt.busy) {
      console.log(
        `  busy ${label.padEnd(15)} explorer reachable but throttling us — not a failure`
      );
      continue;
    }
    failures.push(`${label}: ${attempt.detail} (failed twice)`);
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
