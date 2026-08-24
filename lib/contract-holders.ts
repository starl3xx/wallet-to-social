import { ethers } from 'ethers';
import {
  CHAIN_IDS,
  CHAIN_LABELS,
  SUPPORTED_CHAINS,
  type SupportedChain,
} from './chains';
import { recordHolderIndexSpend } from './holder-index-budget';

// Re-exported so existing server-side importers keep working unchanged.
// Client components must import these from '@/lib/chains' instead — importing
// them from here would pull ethers into the browser bundle.
export { CHAIN_IDS, CHAIN_LABELS, SUPPORTED_CHAINS };
export type { SupportedChain };

// Types
export type ContractType = 'ERC-20' | 'ERC-721' | 'ERC-1155';

export interface HolderResult {
  wallets: string[];
  /**
   * How much of this contract each wallet holds, keyed by lowercased address.
   *
   * The Bag: an ERC-20 balance in whole units, or the count of items held for
   * an NFT contract. Every holder source already returns this beside the
   * address and the parsers used to read the address and drop it.
   *
   * Optional, and sparse when present. A wallet absent from this map is one we
   * could not measure, not one holding nothing, so callers must not zero-fill:
   * the column is hidden entirely rather than showing a confident 0.
   */
  balances?: Record<string, number>;
  /** The per-lookup cap actually applied, so callers can report it accurately. */
  appliedLimit: number;
  tokenName: string;
  tokenSymbol: string;
  contractType: ContractType;
  totalHolders: number;
  truncated: boolean;
  chain: SupportedChain;
}

// Constants
const HOLDER_LIMIT = 10000;
const RPC_TIMEOUT_MS = 15000;

/**
 * Wall-clock ceiling for a holder fetch when the caller names no deadline.
 *
 * 45s against the import route's `maxDuration = 60`, leaving room for the two
 * RPC round trips that precede it (contract type and token metadata) and for
 * the response itself. A caller that knows its own ceiling should pass one.
 */
const DEFAULT_HOLDER_BUDGET_MS = 45_000;

/**
 * The slice of that budget the RPC phase may spend before the holder fetch.
 *
 * Contract-type detection and token metadata come first and can fail over
 * across three endpoints. Bounding them here is what stops that failover eating
 * the time the public explorer fallback needs — which would land precisely when
 * the metered index has already failed and the fallback is all that is left.
 *
 * 20s of 45s. Generous against a healthy endpoint, which answers in well under
 * a second, and firm against three dead ones.
 */
const RPC_PHASE_BUDGET_MS = 20_000;

/** Least time in which a retry against a healthy endpoint is worth starting. */
const MIN_RPC_RETRY_MS = 2_000;

export interface HolderFetchOptions {
  /**
   * Absolute epoch-ms ceiling for the whole fetch, shared across every attempt
   * including a fallback. Defaults to `DEFAULT_HOLDER_BUDGET_MS` from now.
   */
  deadlineMs?: number;
  /**
   * May this call fall back to a public block explorer when the metered index
   * cannot serve? Defaults to true, because the customer import path is the
   * reason the fallback exists.
   *
   * **Background work must pass `false`.** The daily allowance reserves 80% of
   * itself for customers, so the provider can be exhausted by customer traffic
   * while the cron's own ceiling still shows room. Without this the cron would
   * meet DAILY_ALLOWANCE_SPENT and quietly redirect its whole day of seeding
   * onto free public infrastructure — the exact spending of somebody else's
   * resources on work nobody asked for that `checkHolderIndexBudget` exists to
   * prevent.
   */
  allowPublicFallback?: boolean;
}

// ERC-165 interface IDs
const ERC721_INTERFACE_ID = '0x80ac58cd';
const ERC1155_INTERFACE_ID = '0xd9b67a26';

// ERC-165 ABI for interface detection
const ERC165_ABI = [
  'function supportsInterface(bytes4 interfaceId) view returns (bool)',
];

// ERC-20/721 basic ABI for token info
const TOKEN_INFO_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  // Turns a raw ERC-20 balance into whole units for the Bag column.
  'function decimals() view returns (uint8)',
];

// RPC endpoints for different chains
const RPC_ENDPOINTS: Record<SupportedChain, string[]> = {
  // Order is by what answers from a datacenter, measured in CI on 2026-08-17,
  // not by reputation. llamarpc serves a Cloudflare interstitial (403 "Just a
  // moment...") to GitHub Actions runners, and Ankr now requires an API key and
  // answers with a JSON-RPC error telling you to get one. publicnode served
  // every request. The two that fail are kept as third and fourth because they
  // fail instantly and cost nothing, and because "blocks a datacenter IP" is a
  // policy that can change back.
  ethereum: [
    'https://ethereum.publicnode.com',
    'https://eth.llamarpc.com',
    'https://rpc.ankr.com/eth',
  ],
  base: [
    'https://mainnet.base.org',
    'https://base.llamarpc.com',
    'https://base.publicnode.com',
  ],
  robinhood: [
    'https://rpc.mainnet.chain.robinhood.com',
    'https://rpc.arrowrpc.com',
  ],
  arbitrum: [
    'https://arb1.arbitrum.io/rpc',
    'https://arbitrum-one-rpc.publicnode.com',
  ],
  // polygon-rpc.com now returns 401 ('tenant disabled'); these were probed live
  polygon: [
    'https://polygon-bor-rpc.publicnode.com',
    'https://polygon.drpc.org',
  ],
  optimism: [
    'https://mainnet.optimism.io',
    'https://optimism-rpc.publicnode.com',
  ],
  bsc: ['https://bsc-dataseed.binance.org', 'https://bsc-rpc.publicnode.com'],
};

// Alchemy endpoints for NFT holder lookups. getOwnersForContract returns the
// entire owner set in ONE request, which is why NFT holders go here rather than
// to Moralis (whose NFT owners endpoint pages 100 at a time and, as of testing,
// rejects its own pagination cursor).
//
// Networks must be enabled per app in the Alchemy dashboard. A chain listed here
// whose network is off returns 403, surfaced as CHAIN_NFT_NOT_ENABLED.
const ALCHEMY_ENDPOINTS: Partial<Record<SupportedChain, string>> = {
  ethereum: 'https://eth-mainnet.g.alchemy.com/nft/v3',
  base: 'https://base-mainnet.g.alchemy.com/nft/v3',
  // Verified against onchain ownerOf enumeration of StonkBrokers (4444 tokens):
  // Alchemy returned exactly the same 618 holders, no gaps in either direction.
  // Requires ROBINHOOD_MAINNET to be enabled for the app in the Alchemy dashboard.
  robinhood: 'https://robinhood-mainnet.g.alchemy.com/nft/v3',
  // Enabled on the app 2026-08-14, verified returning 200.
  arbitrum: 'https://arb-mainnet.g.alchemy.com/nft/v3',
  polygon: 'https://polygon-mainnet.g.alchemy.com/nft/v3',
  optimism: 'https://opt-mainnet.g.alchemy.com/nft/v3',
  bsc: 'https://bnb-mainnet.g.alchemy.com/nft/v3',
};

// Moralis chain IDs (hex form), the ERC-20 holder index. Verified live on the
// free plan for every chain listed here. Robinhood is absent because Moralis
// does not index it; it uses BLOCKSCOUT_BASE_URLS instead.
/**
 * Whether a chain's ERC-20 holder list is served by the metered index.
 *
 * Exported so callers can ask instead of assuming every ERC-20 import spends
 * the daily allowance. Robinhood Chain does not: it resolves through its own
 * explorer, which has no part in that budget, so throttling it when the
 * allowance is tight refuses work that could not have helped.
 */
export function usesMeteredHolderIndex(chain: SupportedChain): boolean {
  return chain in MORALIS_CHAIN_IDS;
}

/**
 * Does a spent metered allowance still have somewhere to go on this chain?
 *
 * Exported so the import route can tell the customer something true. Reaching
 * DAILY_ALLOWANCE_SPENT means one thing on BNB Chain, which has no public
 * explorer and really is finished until the allowance resets, and something
 * else on the five chains that do: there, the fallback was tried and failed
 * too, which is far more likely to be a bad minute than a bad day. Telling the
 * second group to come back tomorrow would send them away from a feature that
 * probably works again in a moment.
 */
export function hasPublicHolderFallback(chain: SupportedChain): boolean {
  return chain in MORALIS_CHAIN_IDS && chain in BLOCKSCOUT_BASE_URLS;
}

const MORALIS_CHAIN_IDS: Partial<Record<SupportedChain, string>> = {
  ethereum: '0x1',
  base: '0x2105',
  arbitrum: '0xa4b1',
  polygon: '0x89',
  optimism: '0xa',
  bsc: '0x38',
};

/**
 * A call that ran out of time, as opposed to one that came back with an answer.
 *
 * Its own type because `detectContractType` has to tell those apart and a
 * message match is not a contract. The message is unchanged, so the route's
 * `includes('timed out')` mapping to 504 still behaves as it did.
 */
class RpcTimeoutError extends Error {}

/**
 * Wraps a promise with a timeout
 */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new RpcTimeoutError(errorMessage)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]);
}

/**
 * Every RPC worth trying for a chain, best first.
 *
 * Alchemy goes first on Ethereum when a key is configured. The rest is
 * `RPC_ENDPOINTS`, which lists two or three per chain and, until this was
 * written, only ever had its first entry used — `getProvider` returned
 * `endpoints[0]` and nothing ever reached the others. Three endpoints listed
 * and one called is a promise the code does not keep: when llamarpc started
 * refusing this repository's CI runners, contract type detection failed outright
 * on Ethereum with two healthy endpoints sitting unused directly beneath it.
 */
function providerUrls(chain: SupportedChain): string[] {
  const alchemyKey = process.env.ALCHEMY_KEY;
  const urls: string[] = [];

  // For Ethereum, prefer Alchemy if available
  if (chain === 'ethereum' && alchemyKey) {
    urls.push(`https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}`);
  }

  // For every other chain, use public RPCs by default (Alchemy requires per-network
  // enablement per app). This avoids the "<NETWORK>_MAINNET is not enabled" error.
  urls.push(...(RPC_ENDPOINTS[chain] ?? []));

  if (urls.length === 0) {
    throw new Error('UNSUPPORTED_CHAIN');
  }
  return urls;
}

// Pin the network so ethers skips auto-detection, which matters on newer chains.
function makeProvider(
  url: string,
  chain: SupportedChain
): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(url, CHAIN_IDS[chain], {
    staticNetwork: true,
  });
}

/**
 * Run an RPC operation against each endpoint in turn until one answers.
 *
 * Bounded by the same deadline everything else in this module shares, and
 * deliberately so. Failover multiplies wall clock: three endpoints times the
 * three calls `detectContractType` makes, each with its own 15s ceiling, is
 * over two minutes against a route that has 60 seconds. An unbounded retry loop
 * turns one dead provider into a timeout for the whole import, which is a worse
 * failure than the one it set out to fix.
 *
 * ## Why the gate does not try to predict what one attempt costs
 *
 * It did, for one commit, and that was a mistake worth recording. The concern
 * is real: `detectContractType` makes three sequential timed calls, so gating a
 * retry on a single `RPC_TIMEOUT_MS` lets one start with 15s left and spend 45.
 * The obvious fix — require the worst case, three timeouts — made the gate
 * impossible to satisfy, because three timeouts *is* the whole holder budget.
 * Failover switched itself off silently, and CI failed on Ethereum reporting
 * the first endpoint's error with two healthy endpoints never tried.
 *
 * The requirement was never "can this attempt finish". It is "will the public
 * explorer fallback still have time afterwards", and that is answered by
 * bounding the phase rather than forecasting it: callers pass an RPC-phase
 * deadline that is a slice of the holder budget (see RPC_PHASE_BUDGET_MS), and
 * every call inside clamps its own timeout to what is left of it. Failover then
 * cannot overrun, whatever `fn` happens to do, and no caller has to describe
 * its own cost correctly for the guard to hold.
 *
 * A caller that passes no deadline gets one attempt per endpoint with no extra
 * gate, which is the old behaviour plus the retries.
 */
async function withProvider<T>(
  chain: SupportedChain,
  fn: (provider: ethers.JsonRpcProvider) => Promise<T>,
  deadlineMs?: number
): Promise<T> {
  const urls = providerUrls(chain);
  let lastError: unknown;

  for (let i = 0; i < urls.length; i++) {
    // Only the *retries* are gated. The first attempt always runs, so a caller
    // arriving with no budget left still gets a real error from a real call
    // rather than a confusing one about time.
    //
    // A healthy endpoint answers these calls in well under a second, so a
    // couple of seconds is enough for a retry to be worth starting; anything
    // slower than that was not going to rescue this import anyway.
    if (
      i > 0 &&
      deadlineMs !== undefined &&
      deadlineMs - Date.now() < MIN_RPC_RETRY_MS
    ) {
      break;
    }
    try {
      return await fn(makeProvider(urls[i], chain));
    } catch (error) {
      lastError = error;
      if (i < urls.length - 1) {
        console.warn(
          `RPC ${new URL(urls[i]).host} failed on ${chain}, trying the next endpoint:`,
          error instanceof Error ? error.message : error
        );
      }
    }
  }

  throw lastError;
}

/**
 * Detect the contract type (ERC-20, ERC-721, or ERC-1155)
 */
export async function detectContractType(
  address: string,
  chain: SupportedChain,
  deadlineMs?: number
): Promise<ContractType> {
  /**
   * "Not a contract" is returned, not thrown.
   *
   * It is a definitive answer from an RPC that worked, so it must not travel
   * out through `withProvider`'s catch: that would read it as an endpoint
   * failure and ask two more endpoints the same question, each of which would
   * agree, at the cost of two round trips before the customer sees the error
   * the first call already had.
   */
  const detected = await withProvider(
    chain,
    async (provider) => {
      /**
       * Each call takes what is left of the phase, not a flat 15s.
       *
       * This is what makes the retry gate safe without predicting anything:
       * three sequential calls cannot add up past the phase deadline, because
       * the third one cannot start a 15s wait when 3s remain. Without the
       * clamp the guard would depend on every call site describing its own
       * worst case correctly, which is exactly the assumption that broke.
       */
      const budget = () =>
        deadlineMs === undefined
          ? RPC_TIMEOUT_MS
          : Math.max(1_000, Math.min(RPC_TIMEOUT_MS, deadlineMs - Date.now()));

      // Verify it's a contract (not an EOA)
      const code = await withTimeout(
        provider.getCode(address),
        budget(),
        'Contract code check timed out'
      );

      if (code === '0x') {
        return 'NOT_A_CONTRACT' as const;
      }

      // Try ERC-165 interface detection
      const contract = new ethers.Contract(address, ERC165_ABI, provider);

      try {
        // Check ERC-721
        const isERC721 = await withTimeout(
          contract.supportsInterface(ERC721_INTERFACE_ID),
          budget(),
          'ERC-721 check timed out'
        );
        if (isERC721) return 'ERC-721' as ContractType;

        // Check ERC-1155
        const isERC1155 = await withTimeout(
          contract.supportsInterface(ERC1155_INTERFACE_ID),
          budget(),
          'ERC-1155 check timed out'
        );
        if (isERC1155) return 'ERC-1155' as ContractType;
      } catch (error) {
        /**
         * "It answered, and the answer was not ERC-165" is the only thing that
         * may fall through to ERC-20. "It never answered" must not.
         *
         * This `catch` exists because a contract without ERC-165 makes
         * `supportsInterface` revert, and treating that as ERC-20 is correct.
         * It also swallowed timeouts, which was survivable while every call had
         * a flat 15s and became a real defect once the phase clamp could cut one
         * to a second: a slow first endpoint would misreport an NFT collection
         * as a token, and because the error never left this block, `withProvider`
         * saw success and never tried the healthy endpoint underneath. The
         * import then took the ERC-20 path for a contract that has no ERC-20
         * holders.
         *
         * Rethrowing is the safe direction. Worst case the import fails with a
         * timeout the route already maps to a clear 504, instead of quietly
         * fetching the wrong kind of holder list.
         */
        if (error instanceof RpcTimeoutError) throw error;
        // Contract doesn't support ERC-165 - default to ERC-20
      }

      return 'ERC-20' as ContractType;
    },
    deadlineMs
  );

  if (detected === 'NOT_A_CONTRACT') {
    throw new Error('NOT_A_CONTRACT');
  }
  return detected;
}

/**
 * Get token metadata (name and symbol)
 */
async function getTokenInfo(
  address: string,
  chain: SupportedChain,
  deadlineMs?: number
): Promise<{ name: string; symbol: string; decimals: number }> {
  try {
    return await withProvider(
      chain,
      async (provider) => {
        const contract = new ethers.Contract(address, TOKEN_INFO_ABI, provider);

        // Clamped to the phase for the same reason as in detectContractType.
        const budget =
          deadlineMs === undefined
            ? RPC_TIMEOUT_MS
            : Math.max(
                1_000,
                Math.min(RPC_TIMEOUT_MS, deadlineMs - Date.now())
              );

        const [nameResult, symbolResult, decimalsResult] =
          await Promise.allSettled([
            withTimeout(contract.name(), budget, 'name() timed out'),
            withTimeout(contract.symbol(), budget, 'symbol() timed out'),
            withTimeout(contract.decimals(), budget, 'decimals() timed out'),
          ]);

        /**
         * Both failing is thrown so the next endpoint gets a turn.
         *
         * `allSettled` never rejects, so the old shape could not fail over even
         * once it had somewhere to fail over to: a dead endpoint returned
         * "Unknown Token / UNKNOWN" and the customer saw that name on their
         * import while two healthy endpoints sat unused. One of the two
         * succeeding is treated as good enough, since a token legitimately may
         * implement only one of the pair.
         */
        if (
          nameResult.status === 'rejected' &&
          symbolResult.status === 'rejected'
        ) {
          throw nameResult.reason;
        }

        return {
          name:
            nameResult.status === 'fulfilled'
              ? nameResult.value
              : 'Unknown Token',
          symbol:
            symbolResult.status === 'fulfilled'
              ? symbolResult.value
              : 'UNKNOWN',
          /**
           * 18 is the ERC-20 default and the safe guess, but a wrong guess
           * misstates every Bag by orders of magnitude, so `getContractHolders`
           * suppresses balances entirely when this call did not succeed rather
           * than publishing a number it cannot stand behind. -1 is that signal.
           */
          decimals:
            decimalsResult.status === 'fulfilled'
              ? Number(decimalsResult.value)
              : -1,
        };
      },
      deadlineMs
    );
  } catch {
    // Every endpoint failed. The name is cosmetic and the holder list is not,
    // so this stays non-fatal and the import continues without it.
    return { name: 'Unknown Token', symbol: 'UNKNOWN', decimals: -1 };
  }
}

/**
 * Get NFT (ERC-721/1155) holders using Alchemy API
 */
async function getERC721Holders(
  address: string,
  chain: SupportedChain,
  limit: number = HOLDER_LIMIT
): Promise<{
  wallets: string[];
  totalHolders: number;
  balances: Map<string, string>;
}> {
  const alchemyKey = process.env.ALCHEMY_KEY;
  const baseUrl = ALCHEMY_ENDPOINTS[chain];

  if (!alchemyKey)
    throw new Error('ALCHEMY_KEY required for NFT holder lookups');
  if (!baseUrl) throw new Error('CHAIN_NO_NFT_SUPPORT');

  /**
   * `withTokenBalances=true` is what fills the Bag column for NFTs.
   *
   * It changes each owner from a bare address into an address plus one entry
   * per token id held, so the response grows with total supply rather than with
   * holder count. That is the cost: a collection where holders own many items
   * returns a much larger payload for the same owner list. It buys the only
   * number that makes the column meaningful for an NFT contract, and it is the
   * same single request either way.
   */
  const url = `${baseUrl}/${alchemyKey}/getOwnersForContract?contractAddress=${address}&withTokenBalances=true`;

  const response = await withTimeout(
    fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    }),
    30000, // 30s timeout for this potentially slow call
    'Alchemy getOwnersForContract timed out'
  );

  if (!response.ok) {
    const errorText = await response.text();
    // 403 means the network is not enabled for this app in the Alchemy
    // dashboard, which is a config problem with a specific fix, not a dead end.
    //
    // Moralis is deliberately NOT used as a fallback here. Its NFT owners
    // endpoint rejects its own pagination cursor ("cursor is not valid") on
    // every encoding tested, so it can only ever return the first 100 owners.
    // Returning a silent 100-holder slice of a 5,000-holder collection is worse
    // than a clear error, and ERC-20 on these chains is unaffected.
    if (response.status === 403) {
      throw new Error('CHAIN_NFT_NOT_ENABLED');
    }
    console.error('Alchemy API error response:', {
      status: response.status,
      body: errorText,
      url: url.replace(alchemyKey, '***'),
    });
    throw new Error(`Alchemy API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  /**
   * With balances requested, an owner is an object rather than a string. The
   * string form is still handled: the flag is ours to change, and a parser that
   * only understands the shape we asked for today breaks silently the moment
   * somebody flips it back.
   */
  const owners: Array<
    | string
    | { ownerAddress?: string; tokenBalances?: Array<{ balance?: string }> }
  > = data.owners || [];

  const balances = new Map<string, string>();
  const seen: string[] = [];

  for (const entry of owners) {
    const addr = (
      typeof entry === 'string' ? entry : entry.ownerAddress
    )?.toLowerCase();
    if (!addr) continue;
    if (!balances.has(addr)) seen.push(addr);

    if (typeof entry !== 'string' && Array.isArray(entry.tokenBalances)) {
      /**
       * The Bag is the number of items held, summed across token ids.
       *
       * ERC-721 sends one entry of balance "1" per token, so the sum is the
       * count of NFTs owned. ERC-1155 sends a quantity per id, and summing is
       * the reading that matches the column: "how much of this contract do you
       * hold", not "how many distinct ids".
       */
      let total = 0;
      for (const tb of entry.tokenBalances) total += Number(tb.balance ?? 0);
      if (Number.isFinite(total) && total > 0) {
        balances.set(addr, String(total + Number(balances.get(addr) ?? 0)));
      }
    } else if (!balances.has(addr)) {
      balances.set(addr, '');
    }
  }

  const uniqueOwners = [...new Set(seen)];
  const totalHolders = uniqueOwners.length;

  // Apply limit
  const limitedOwners = uniqueOwners.slice(0, limit);

  return {
    wallets: limitedOwners,
    totalHolders,
    balances: new Map(limitedOwners.map((w) => [w, balances.get(w) ?? ''])),
  };
}

/**
 * Blockscout explorers that expose an ERC-20 holder index.
 *
 * Two different jobs, decided by whether the chain also has an entry in
 * `MORALIS_CHAIN_IDS`:
 *
 * - **Robinhood Chain**: the only source there is. The metered index does not
 *   cover the chain at all, which is why token import used to be NFT-only.
 * - **Everywhere else**: a free fallback for when the metered index cannot
 *   serve. Losing the day's allowance used to take ERC-20 import down on every
 *   chain at once, and a customer who had paid for the feature watched it stop
 *   for reasons that were ours, not theirs.
 *
 * ## Measured, not assumed
 *
 * Every URL below was probed on 2026-08-17 against a customer-sized token on
 * that chain (60k–75k holders, taken off each explorer's own token list so no
 * address was guessed), through the two endpoints this module calls. Time for
 * one v1 page:
 *
 * | Chain    | 200 rows | 1,000 rows | 2,000 rows | token meta |
 * |----------|----------|------------|------------|------------|
 * | Ethereum | 0.83s    | 0.78s      | 1.4s       | 0.14s      |
 * | Optimism | 0.75s    | 0.56s      | 1.4s       | 0.13s      |
 * | Arbitrum | 1.1s     | 0.92s      | 1.5s       | 0.14s      |
 * | Polygon  | 7.2s     | 6.7s       | 7.7s       | 0.34s      |
 * | Base     | 11.2s    | 15.3s      | 25.6s      | 0.31s      |
 *
 * **Base has a latency floor near 11s that barely moves with page size.** That
 * is what `PAGE_SIZES` in `fetchHoldersV1` is up against: shrinking the page
 * after a timeout is the right move on a size-limited explorer and pure waste
 * on a latency-limited one, where the retry pays the floor again for fewer
 * rows. Base therefore yields a first page and usually not much more, correctly
 * marked truncated. A thousand real holders beats an error.
 *
 * **Base is also the one that fails outright sometimes.** Across a dozen calls
 * while this was written it returned holders four times, answered 500 twice,
 * and throttled once. It is kept anyway, because the comparison for a fallback
 * is not "reliable or not" but "this or nothing", and nothing is what Base
 * ERC-20 import had on a spent allowance. What its flakiness does change is the
 * check: `scripts/check-holder-fallback.ts` retries once before calling a chain
 * broken, or a weekly alarm fires on Base's bad minute rather than on real rot.
 *
 * Do not re-measure with USDC. It has 12.7M holders on Base and 4.2M on
 * Polygon, and it times out on both at every page size, which reads as a dead
 * explorer and is not one. That reading nearly removed both chains from this
 * table.
 *
 * BNB Chain has no public Blockscout instance: `bsc.blockscout.com` and
 * `bnb.blockscout.com` both answer 404 from the default backend. It is the one
 * metered chain with no fallback, so it is the only one where a spent allowance
 * still stops ERC-20 import.
 */
const BLOCKSCOUT_BASE_URLS: Partial<Record<SupportedChain, string>> = {
  robinhood: 'https://robinhoodchain.blockscout.com',
  ethereum: 'https://eth.blockscout.com',
  base: 'https://base.blockscout.com',
  arbitrum: 'https://arbitrum.blockscout.com',
  polygon: 'https://polygon.blockscout.com',
  // Not optimism.blockscout.com, which 301s here. Following the redirect works
  // but pays an extra round trip on every request of every page.
  optimism: 'https://explorer.optimism.io',
};

/**
 * Explorers that have answered 429, and the moment we may call them again.
 *
 * Observed on 2026-08-17: a few dozen probe requests to the Base explorer over
 * a few minutes was enough for it to start refusing, and it refused in 1.1s
 * rather than hanging. These are free services with no contract behind them,
 * and once one has said stop, the polite reading and the useful reading agree —
 * further calls will not return holders, so they cost a customer a second of
 * waiting to reach the same error, and cost the explorer a request it already
 * declined.
 *
 * Per process, so a serverless deployment holds it only for the life of an
 * instance. That is partial and worth having anyway: the case this protects
 * against is a burst of imports landing on one warm instance after the metered
 * allowance is gone, which is exactly when it is still in memory.
 *
 * Keyed by base URL rather than by chain, because two chains sharing a host
 * share a limit.
 */
const explorerCooldowns = new Map<string, number>();
const EXPLORER_COOLDOWN_MS = 5 * 60_000;

function noteRateLimited(base: string): void {
  explorerCooldowns.set(base, Date.now() + EXPLORER_COOLDOWN_MS);
}

function isCoolingDown(base: string): boolean {
  const until = explorerCooldowns.get(base);
  if (until === undefined) return false;
  if (Date.now() >= until) {
    explorerCooldowns.delete(base);
    return false;
  }
  return true;
}

interface BlockscoutHolderItem {
  address?: { hash?: string } | string;
  /** Raw balance: token units for ERC-20, item count for an NFT contract. */
  value?: string;
}

interface BlockscoutHoldersResponse {
  items?: BlockscoutHolderItem[];
  // Opaque cursor. Passed back verbatim as query params for the next page.
  next_page_params?: Record<string, string | number> | null;
}

interface BlockscoutV1Response {
  status?: string;
  result?: Array<{ address?: string; value?: string }> | string;
}

/**
 * Holders from Blockscout's legacy v1 API, which takes an explicit page/offset
 * instead of the v2 opaque cursor.
 *
 * This is the fast path by a wide margin. v2 caps a page at 50 rows and each
 * page must wait for the previous one's cursor; v1 accepts offset=5000 and
 * returns the whole set in one request. Measured on Robinhood Chain:
 * 5,000 holders in 12.1s here against roughly 288s of v2 paging, and the first
 * 300 addresses came back identical in the same rank order, so this is a
 * cheaper route to the same data rather than a different dataset.
 */
async function fetchHoldersV1(
  base: string,
  address: string,
  limit: number,
  headers: Record<string, string>,
  remainingMs: () => number
): Promise<Map<string, string> | null> {
  // Keyed by wallet so a repeated address cannot double-count, and valued by
  // the raw balance the explorer already sends beside it. Reading the address
  // and discarding the value is what left the Bag column empty for every
  // contract import.
  const seen = new Map<string, string>();
  // Start big and shrink on failure, like multicallAdaptive in the ENS harvest.
  // A 5,000-row request is one round trip on a healthy token but can exceed
  // what a loaded explorer will serve for a very large one, and spending the
  // whole budget failing at 5,000 leaves nothing for a smaller retry.
  const PAGE_SIZES = [5000, 1000, 200];
  let sizeIndex = 0;

  for (let page = 1; seen.size < limit; page++) {
    const budget = remainingMs();
    if (budget <= 0) break;

    const want = Math.min(PAGE_SIZES[sizeIndex], limit - seen.size);
    const url =
      `${base}/api?module=token&action=getTokenHolders` +
      `&contractaddress=${address}&page=${page}&offset=${want}`;

    let json: BlockscoutV1Response;
    try {
      const res = await withTimeout(
        fetch(url, { headers }),
        Math.min(20_000, Math.max(2_000, budget)),
        'Blockscout v1 holders timed out'
      );
      // A rate limit is not a size problem. Shrinking and retrying against a
      // 429 just spends the budget earning more 429s, and the public explorer
      // throttles hard enough that a burst of imports can lock the feature out
      // for everyone. Surface it immediately so the caller can say so.
      if (res.status === 429) {
        noteRateLimited(base);
        throw new Error('RATE_LIMIT');
      }
      if (!res.ok) throw new Error(`Blockscout v1 ${res.status}`);
      json = (await res.json()) as BlockscoutV1Response;
    } catch (error) {
      if (error instanceof Error && error.message === 'RATE_LIMIT') {
        if (seen.size > 0) return seen;
        throw error;
      }
      // Shrink and retry only while nothing has been collected. Page numbering
      // is relative to the page size, so changing it mid-stream would skip or
      // repeat rows; with an empty set there is no stream yet to corrupt.
      if (seen.size === 0 && sizeIndex < PAGE_SIZES.length - 1) {
        sizeIndex++;
        page--;
        continue;
      }
      return seen.size > 0 ? seen : null;
    }

    // v1 reports "no records found" as status 0 with a string result
    if (json.status !== '1' || !Array.isArray(json.result)) {
      return seen.size > 0 ? seen : null;
    }

    const rows = json.result;
    for (const row of rows) {
      const a = row.address?.toLowerCase();
      if (a?.startsWith('0x')) seen.set(a, row.value ?? '');
      if (seen.size >= limit) break;
    }

    // A short page is the last page
    if (rows.length < want) break;
  }

  return seen;
}

/**
 * ERC-20 holders from a Blockscout explorer.
 *
 * Tries the bulk v1 endpoint first and falls back to v2 cursor paging, so a
 * deployment that has retired v1 still works, just slower. Both paths are
 * bounded by a wall-clock budget: a public explorer can be slow, and a partial
 * list returned in time beats an error after the route's own ceiling.
 */
async function getERC20HoldersBlockscout(
  address: string,
  chain: SupportedChain,
  limit: number,
  deadlineMs: number
): Promise<{
  wallets: string[];
  totalHolders: number;
  balances: Map<string, string>;
}> {
  const base = BLOCKSCOUT_BASE_URLS[chain];
  if (!base) throw new Error('CHAIN_NO_ERC20_SUPPORT');

  // Do not call an explorer that has already refused us. See explorerCooldowns.
  if (isCoolingDown(base)) throw new Error('RATE_LIMIT');

  const headers = {
    Accept: 'application/json',
    'User-Agent': 'walletlink.social',
  };
  const seen = new Map<string, string>();
  let totalHolders = 0;

  // ONE budget for everything this function does. The v1 attempt and the v2
  // fallback must share it: giving each its own timer let a slow token spend
  // 40s failing over v1 and then a further 40s on v2, for 71s against a route
  // whose ceiling is 60.
  //
  // It is a deadline passed in rather than a timer started here, because this
  // is now reached two ways. As Robinhood's primary source it runs first and
  // owns nearly the whole request. As a fallback it runs *after* the metered
  // index has already spent some of it, and a fresh 40s counted from this line
  // would measure from the wrong zero and overrun the route.
  const remainingMs = () => deadlineMs - Date.now();

  // Holder count comes from the token record; the holders list itself does not
  // report a total, and we need it to tell the caller the result was truncated.
  try {
    const metaRes = await withTimeout(
      fetch(`${base}/api/v2/tokens/${address}`, { headers }),
      Math.min(10_000, Math.max(2_000, remainingMs())),
      'Blockscout token lookup timed out'
    );
    if (metaRes.ok) {
      const meta = (await metaRes.json()) as {
        holders_count?: string;
        holders?: string;
      };
      totalHolders =
        parseInt(meta.holders_count ?? meta.holders ?? '0', 10) || 0;
    }
  } catch {
    // Non-fatal: a missing total only costs an accurate `truncated` flag
  }

  const v1 = await fetchHoldersV1(base, address, limit, headers, remainingMs);
  if (v1 && v1.size > 0) {
    // `totalHolders` stays 0 when the source did not tell us the real total.
    // It used to fall back to the number of wallets returned, which made
    // `truncated` (wallets.length < totalHolders) impossible to ever be true: a
    // capped list reported itself complete. USDG imported 5,000 of its holders
    // and told the buyer that was all of them.
    const wallets = Array.from(v1.keys()).slice(0, limit);
    return {
      wallets,
      totalHolders,
      balances: new Map(wallets.map((w) => [w, v1.get(w) ?? ''])),
    };
  }

  let params: Record<string, string | number> | null = null;
  const MAX_PAGES = Math.ceil(limit / 50) + 5;

  // Pages are 50 rows and the explorer has been observed at up to ~3s a page,
  // so a 5,000-holder request can want ~100 pages: far beyond the route's 60s
  // maxDuration. Stop at a budget and return what was collected rather than
  // letting the whole import time out and give the caller nothing. The result
  // still reports the true holder count, so it is correctly marked truncated.
  for (let page = 0; page < MAX_PAGES && seen.size < limit; page++) {
    if (remainingMs() <= 0) break;
    const url = new URL(`${base}/api/v2/tokens/${address}/holders`);
    if (params) {
      for (const [k, v] of Object.entries(params))
        url.searchParams.set(k, String(v));
    }

    // Never wait past the budget: a fixed 30s timeout checked only between
    // pages could start a request with 1s of budget left and still block for
    // 30, overrunning the route's own 60s ceiling.
    const pageTimeoutMs = Math.min(15_000, Math.max(2_000, remainingMs()));

    let json: BlockscoutHoldersResponse;
    try {
      const res = await withTimeout(
        fetch(url.toString(), { headers }),
        pageTimeoutMs,
        'Blockscout holders request timed out'
      );
      if (res.status === 429) {
        noteRateLimited(base);
        throw new Error('RATE_LIMIT');
      }
      if (!res.ok) throw new Error(`Blockscout holders ${res.status}`);
      json = (await res.json()) as BlockscoutHoldersResponse;
    } catch (error) {
      // A page that fails after holders are already collected should not lose
      // them. Return the partial list; only a first-page failure is fatal,
      // where there is nothing to return and the real error is worth surfacing.
      if (seen.size > 0) break;
      throw error;
    }

    const items = json.items ?? [];
    if (items.length === 0) break;

    for (const item of items) {
      const hash =
        typeof item.address === 'string' ? item.address : item.address?.hash;
      if (hash && hash.startsWith('0x'))
        seen.set(hash.toLowerCase(), item.value ?? '');
      if (seen.size >= limit) break;
    }

    if (!json.next_page_params) break;
    params = json.next_page_params;
    // Be a good citizen on a public explorer
    await new Promise((r) => setTimeout(r, 120));
  }

  const wallets = Array.from(seen.keys()).slice(0, limit);
  const balances = new Map(wallets.map((w) => [w, seen.get(w) ?? '']));
  // 0 means "the source never reported a total". See the note above.
  return { wallets, totalHolders, balances };
}

/**
 * ERC-20 holders, from the metered index where there is one and the chain's
 * block explorer where there is not, or where the index has stopped answering.
 *
 * ERC-20 holders cannot be derived from RPC state the way NFT owners can:
 * balances are a mapping with no enumerable owner list, so they always need
 * somebody's index. That is the whole reason a spent allowance used to be
 * fatal here, and the reason a second index is worth having.
 */
async function getERC20Holders(
  address: string,
  chain: SupportedChain,
  limit: number = HOLDER_LIMIT,
  options: HolderFetchOptions = {}
): Promise<{
  wallets: string[];
  totalHolders: number;
  balances: Map<string, string>;
}> {
  // Chain coverage is checked before the API key: on a chain Moralis does not index
  // at all, "no support for this chain" is the accurate error, and configuring a key
  // would not help. Checking the key first would mask that with a config error.
  const chainId = MORALIS_CHAIN_IDS[chain];
  const explorer = BLOCKSCOUT_BASE_URLS[chain];
  const deadlineMs =
    options.deadlineMs ?? Date.now() + DEFAULT_HOLDER_BUDGET_MS;

  if (!chainId) {
    if (explorer) {
      return getERC20HoldersBlockscout(address, chain, limit, deadlineMs);
    }
    throw new Error('CHAIN_NO_ERC20_SUPPORT');
  }

  try {
    return await fetchHoldersMetered(address, chainId, limit);
  } catch (error) {
    /**
     * Fall back on **any** failure of the metered index, not a curated list of
     * error codes.
     *
     * By this line the address has already passed `ethers.isAddress` and the
     * chain is known to be indexed, so the failures that remain are all the
     * provider's side of the line: allowance spent, burst limit, missing key,
     * 5xx, timeout. Matching on specific codes would mean a provider that
     * invents a new failure string next month silently loses the fallback, and
     * the cost of being wrong is asymmetric — one wasted explorer request
     * against a paying customer's import failing outright.
     *
     * A successful-but-empty response is deliberately NOT a trigger. It never
     * reaches this catch: it returns normally and `getContractHolders` raises
     * NO_HOLDERS. "The index says nobody holds this" is an answer, and
     * second-guessing every empty result would double the load we put on free
     * public infrastructure for the common case of a genuinely dead token.
     */
    if (!explorer || options.allowPublicFallback === false) throw error;

    const reason = error instanceof Error ? error.message : String(error);
    console.warn(
      `Metered holder index failed on ${chain} (${reason}); falling back to the public explorer.`
    );

    try {
      return await getERC20HoldersBlockscout(address, chain, limit, deadlineMs);
    } catch (fallbackError) {
      /**
       * Report the FIRST failure, not this one.
       *
       * The original names what actually went wrong and maps to copy that tells
       * the customer something true and actionable — DAILY_ALLOWANCE_SPENT
       * becomes "back tomorrow, and an upload works now". The fallback's own
       * error is a second-order detail about a rescue attempt they never asked
       * for, and surfacing it would replace a useful message with a confusing
       * one.
       *
       * The fallback's error is attached as `cause` rather than dropped.
       * Rethrowing the original is right for the customer and it erases the
       * only evidence that a fallback ran at all: "did the safety net fail, or
       * was it never wired up" become the same observation from outside. That
       * cost `check-holder-fallback.ts` an accurate diagnosis the first time it
       * caught a real throttle, and it would cost the same in an incident.
       */
      console.error(
        `Public explorer fallback also failed on ${chain}:`,
        fallbackError instanceof Error ? fallbackError.message : fallbackError
      );
      if (error instanceof Error) error.cause = fallbackError;
      throw error;
    }
  }
}

/**
 * Get ERC-20 token holders using Moralis API
 */
async function fetchHoldersMetered(
  address: string,
  chainId: string,
  limit: number
): Promise<{
  wallets: string[];
  totalHolders: number;
  balances: Map<string, string>;
}> {
  const moralisKey = process.env.MORALIS_API_KEY;
  if (!moralisKey) {
    throw new Error('MORALIS_NOT_CONFIGURED');
  }

  const wallets: string[] = [];
  // Raw balances the index sends beside each address; see the Bag column.
  const balances = new Map<string, string>();
  let cursor: string | null = null;
  let totalHolders = 0;
  // Counted here rather than at the call site, because only this loop knows how
  // many pages a contract actually needed. Reported once at the end, and in the
  // failure paths too: a request that errors has already been billed.
  let requestsMade = 0;

  /**
   * `try`/`finally` around the whole loop, so the count survives every exit.
   *
   * Recording at each `throw` looked equivalent and was not: a timeout, a
   * network failure or a malformed body escapes from between those branches,
   * and it takes with it not just the failed request but every page that
   * already succeeded in the same loop. Those were billed. A guard fed by a
   * counter that silently drops spend is a guard that lets the cron run on a
   * day the allowance is already gone.
   */
  try {
    // Paginate through results (Moralis returns max 100 per page)
    do {
      requestsMade++;
      const url = new URL(
        `https://deep-index.moralis.io/api/v2.2/erc20/${address}/owners`
      );
      url.searchParams.set('chain', chainId);
      url.searchParams.set('limit', '100');
      if (cursor) url.searchParams.set('cursor', cursor);

      const response = await withTimeout(
        fetch(url.toString(), {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            'X-API-Key': moralisKey,
          },
        }),
        30000,
        'Moralis getTokenHolders timed out'
      );

      if (!response.ok) {
        const errorText = await response.text();

        /**
         * A spent daily allowance is not "try again in a moment".
         *
         * The index bills by compute unit against a daily ceiling, and once that
         * is gone it is gone until the ceiling resets. Reporting that as a rate
         * limit told the customer to retry, which they did, which failed, which
         * they did again. Telling them it comes back tomorrow is the difference
         * between a wait and a fault.
         *
         * Matched on the body rather than the status because the status is not
         * reliable for this: exhaustion has been seen as 401 and as 429, and a
         * plain 429 for burst rate is a genuinely different answer. The body is
         * what names the reason.
         */
        const exhausted = /compute unit|daily limit|quota|out of credit/i.test(
          errorText
        );
        if (exhausted) {
          console.error(
            'Holder index allowance spent for the day:',
            errorText.slice(0, 200)
          );
          throw new Error('DAILY_ALLOWANCE_SPENT');
        }

        if (response.status === 429) {
          throw new Error('RATE_LIMIT');
        }
        console.error('Moralis API error response:', {
          status: response.status,
          body: errorText,
          url: url.toString().replace(moralisKey, '***'),
        });
        throw new Error(`Moralis API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();

      // Get total from first response
      if (totalHolders === 0 && data.total) {
        totalHolders = data.total;
      }

      // Extract wallet addresses, and the balance the index already sends with
      // each one. `balance` is the raw integer; `balance_formatted` is a decimal
      // string when Moralis knows the token's decimals. Prefer the raw value so
      // one conversion path serves every source.
      const rows = (data.result || []) as Array<{
        owner_address: string;
        balance?: string;
      }>;
      for (const h of rows) {
        const w = h.owner_address.toLowerCase();
        wallets.push(w);
        if (h.balance !== undefined) balances.set(w, h.balance);
      }

      cursor = data.cursor || null;

      // Stop if we've reached our limit
      if (wallets.length >= limit) {
        break;
      }

      // Small delay between pages to avoid rate limits
      if (cursor) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    } while (cursor && wallets.length < limit);
  } finally {
    /**
     * Awaited. It used to be `void`, on the reasoning that accounting serves
     * the cron and a customer should not wait on a bookkeeping write. That
     * reasoning is sound on a long-lived server and wrong here: this runs in a
     * serverless function, which can be frozen the moment its response is sent,
     * and a promise nobody is waiting on is exactly what gets dropped.
     *
     * The evidence is that `ingest_state` held no `holder_index_usage` row at
     * all, through every import the product has ever run. The counter read zero
     * forever, so the cron's ceiling never engaged, the admin Usage pane
     * reported no spend, and the first sign of a problem was the provider
     * hard-blocking every request for the rest of the day.
     *
     * The cost of awaiting is one indexed upsert against Neon, tens of
     * milliseconds, at the end of an import that just spent several seconds
     * making up to a hundred paged requests. Well under one percent, to know
     * what we spent.
     */
    await recordHolderIndexSpend(requestsMade);
  }

  // Dedupe and limit
  const uniqueWallets = [...new Set(wallets)].slice(0, limit);

  return {
    wallets: uniqueWallets,
    // 0 means "the source never reported a total". See the note above.
    totalHolders,
    balances: new Map(uniqueWallets.map((w) => [w, balances.get(w) ?? ''])),
  };
}

/**
 * Main entry point: Get all holders for a contract
 */
/**
 * Raw holder balances to the number a person reads in the Bag column.
 *
 * ERC-20 balances arrive as integers in the token's smallest unit, so they mean
 * nothing without `decimals`. If `decimals()` did not answer we return nothing
 * rather than assuming the usual 18: a wrong exponent misstates every row by
 * orders of magnitude, and an absent column is honest where a confidently wrong
 * number is not.
 *
 * NFT balances are already counts of items and are used as-is.
 *
 * Returns undefined when there is nothing trustworthy to show, which hides the
 * column rather than filling it with zeros. A wallet we could not measure is
 * not a wallet holding none.
 */
function toBagSizes(
  raw: Map<string, string> | undefined,
  contractType: ContractType,
  decimals: number
): Record<string, number> | undefined {
  if (!raw || raw.size === 0) return undefined;

  const isNft = contractType === 'ERC-721' || contractType === 'ERC-1155';
  if (!isNft && (decimals < 0 || !Number.isFinite(decimals))) return undefined;

  const out: Record<string, number> = {};
  for (const [wallet, value] of raw) {
    if (!value) continue;
    let n: number;
    if (isNft) {
      n = Number(value);
    } else {
      /**
       * BigInt then divide, because these integers routinely exceed what a
       * double holds exactly: a whale balance parsed straight through
       * `Number()` loses precision well before the decimal point. formatUnits
       * returns a decimal string, and the float that comes out of it is only
       * asked to carry a human-sized number.
       */
      try {
        n = Number(ethers.formatUnits(BigInt(value), decimals));
      } catch {
        continue; // Unparseable value: omit the row rather than guess it.
      }
    }
    if (Number.isFinite(n) && n > 0) out[wallet] = n;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export async function getContractHolders(
  address: string,
  chain: SupportedChain,
  /**
   * Cap the returned holders at the caller's per-lookup limit.
   *
   * Without this the import returns up to HOLDER_LIMIT regardless of tier, so a
   * Pro account (5,000 per lookup) could import 8,000 holders and then be blocked
   * by the upgrade wall on the very list the feature just produced.
   */
  limit: number = HOLDER_LIMIT,
  options: HolderFetchOptions = {}
): Promise<HolderResult> {
  /**
   * Started here, before the two RPC round trips below, rather than inside the
   * holder fetch.
   *
   * Contract-type detection and token metadata are three calls to a public RPC
   * and can take several seconds on a slow endpoint. A budget that begins after
   * them measures from the wrong zero: on paper the fetch has its full
   * allowance, in practice the route's 60s has already been eaten into and the
   * function overruns rather than returning the partial list it had.
   */
  const deadlineMs =
    options.deadlineMs ?? Date.now() + DEFAULT_HOLDER_BUDGET_MS;

  // Validate address format
  if (!ethers.isAddress(address)) {
    throw new Error('INVALID_ADDRESS');
  }

  // Normalize address
  const normalizedAddress = ethers.getAddress(address);

  // Never exceed the hard ceiling, even if a caller asks for more
  const effectiveLimit = Math.min(limit, HOLDER_LIMIT);

  /**
   * The RPC phase gets a bounded slice, and the holder fetch keeps the rest.
   *
   * Both calls below share one phase deadline computed here, so failover inside
   * either cannot spend the time the holder fetch — and in particular the
   * public explorer fallback — is going to need.
   */
  const rpcDeadlineMs = Math.min(deadlineMs, Date.now() + RPC_PHASE_BUDGET_MS);

  // Detect contract type
  const contractType = await detectContractType(
    normalizedAddress,
    chain,
    rpcDeadlineMs
  );

  // Get token info
  const {
    name: tokenName,
    symbol: tokenSymbol,
    decimals,
  } = await getTokenInfo(normalizedAddress, chain, rpcDeadlineMs);

  // Fetch holders based on contract type
  let holdersResult: {
    wallets: string[];
    totalHolders: number;
    balances?: Map<string, string>;
  };

  if (contractType === 'ERC-721' || contractType === 'ERC-1155') {
    holdersResult = await getERC721Holders(
      normalizedAddress,
      chain,
      effectiveLimit
    );
  } else {
    holdersResult = await getERC20Holders(
      normalizedAddress,
      chain,
      effectiveLimit,
      {
        ...options,
        deadlineMs,
      }
    );
  }

  if (holdersResult.wallets.length === 0) {
    throw new Error('NO_HOLDERS');
  }

  return {
    wallets: holdersResult.wallets,
    balances: toBagSizes(holdersResult.balances, contractType, decimals),
    tokenName,
    tokenSymbol,
    contractType,
    // 0 means the source never reported a total. It is NOT replaced with the
    // number of wallets returned: that is what made a capped 5,000-holder USDG
    // import tell the buyer "5,000 of 5,000 total holders", which reads as a
    // complete list. Every caller must handle 0 as "unknown".
    totalHolders: holdersResult.totalHolders,
    appliedLimit: effectiveLimit,
    /**
     * Two ways a list can be short, and both must set this flag.
     *
     * When the source told us the real total, compare against it. A source that
     * pages slowly can stop on its own time budget below the cap, and comparing
     * the total against the cap alone would call that list complete.
     *
     * When the source reported no total (`totalHolders === 0`), the only
     * evidence is the count itself: a result that exactly fills the limit was
     * almost certainly cut off at the limit. Reporting `false` here is what let
     * a 5,000-holder USDG import tell the buyer it held every holder, because
     * the unknown total was silently replaced by the returned count and the
     * comparison became 5000 < 5000.
     */
    truncated:
      holdersResult.totalHolders > 0
        ? holdersResult.wallets.length < holdersResult.totalHolders
        : holdersResult.wallets.length >= effectiveLimit,
    chain,
  };
}
