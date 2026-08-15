import { ethers } from 'ethers';
import { CHAIN_IDS, CHAIN_LABELS, SUPPORTED_CHAINS, type SupportedChain } from './chains';

// Re-exported so existing server-side importers keep working unchanged.
// Client components must import these from '@/lib/chains' instead — importing
// them from here would pull ethers into the browser bundle.
export { CHAIN_IDS, CHAIN_LABELS, SUPPORTED_CHAINS };
export type { SupportedChain };

// Types
export type ContractType = 'ERC-20' | 'ERC-721' | 'ERC-1155';

export interface HolderResult {
  wallets: string[];
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
];

// RPC endpoints for different chains
const RPC_ENDPOINTS: Record<SupportedChain, string[]> = {
  ethereum: [
    'https://eth.llamarpc.com',
    'https://rpc.ankr.com/eth',
    'https://ethereum.publicnode.com',
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
  arbitrum: ['https://arb1.arbitrum.io/rpc', 'https://arbitrum-one-rpc.publicnode.com'],
  // polygon-rpc.com now returns 401 ('tenant disabled'); these were probed live
  polygon: ['https://polygon-bor-rpc.publicnode.com', 'https://polygon.drpc.org'],
  optimism: ['https://mainnet.optimism.io', 'https://optimism-rpc.publicnode.com'],
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
const MORALIS_CHAIN_IDS: Partial<Record<SupportedChain, string>> = {
  ethereum: '0x1',
  base: '0x2105',
  arbitrum: '0xa4b1',
  polygon: '0x89',
  optimism: '0xa',
  bsc: '0x38',
};


/**
 * Wraps a promise with a timeout
 */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]);
}

/**
 * Get a provider for the specified chain
 * Uses Alchemy for Ethereum, public RPCs for Base (unless Alchemy Base is configured)
 */
function getProvider(chain: SupportedChain): ethers.JsonRpcProvider {
  const alchemyKey = process.env.ALCHEMY_KEY;

  // For Ethereum, prefer Alchemy if available
  if (chain === 'ethereum' && alchemyKey) {
    return new ethers.JsonRpcProvider(`https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}`);
  }

  // For every other chain, use public RPCs by default (Alchemy requires per-network
  // enablement per app). This avoids the "<NETWORK>_MAINNET is not enabled" error.
  // Pin the network so ethers skips auto-detection, which matters on newer chains.
  const endpoints = RPC_ENDPOINTS[chain];
  if (!endpoints?.length) {
    throw new Error('UNSUPPORTED_CHAIN');
  }

  return new ethers.JsonRpcProvider(endpoints[0], CHAIN_IDS[chain], {
    staticNetwork: true,
  });
}


/**
 * Detect the contract type (ERC-20, ERC-721, or ERC-1155)
 */
export async function detectContractType(
  address: string,
  chain: SupportedChain
): Promise<ContractType> {
  const provider = getProvider(chain);

  // Verify it's a contract (not an EOA)
  const code = await withTimeout(
    provider.getCode(address),
    RPC_TIMEOUT_MS,
    'Contract code check timed out'
  );

  if (code === '0x') {
    throw new Error('NOT_A_CONTRACT');
  }

  // Try ERC-165 interface detection
  const contract = new ethers.Contract(address, ERC165_ABI, provider);

  try {
    // Check ERC-721
    const isERC721 = await withTimeout(
      contract.supportsInterface(ERC721_INTERFACE_ID),
      RPC_TIMEOUT_MS,
      'ERC-721 check timed out'
    );
    if (isERC721) return 'ERC-721';

    // Check ERC-1155
    const isERC1155 = await withTimeout(
      contract.supportsInterface(ERC1155_INTERFACE_ID),
      RPC_TIMEOUT_MS,
      'ERC-1155 check timed out'
    );
    if (isERC1155) return 'ERC-1155';
  } catch {
    // Contract doesn't support ERC-165 - default to ERC-20
  }

  return 'ERC-20';
}

/**
 * Get token metadata (name and symbol)
 */
async function getTokenInfo(
  address: string,
  chain: SupportedChain
): Promise<{ name: string; symbol: string }> {
  const provider = getProvider(chain);
  const contract = new ethers.Contract(address, TOKEN_INFO_ABI, provider);

  let name = 'Unknown Token';
  let symbol = 'UNKNOWN';

  try {
    const [nameResult, symbolResult] = await Promise.allSettled([
      withTimeout(contract.name(), RPC_TIMEOUT_MS, 'name() timed out'),
      withTimeout(contract.symbol(), RPC_TIMEOUT_MS, 'symbol() timed out'),
    ]);

    if (nameResult.status === 'fulfilled') name = nameResult.value;
    if (symbolResult.status === 'fulfilled') symbol = symbolResult.value;
  } catch {
    // Use defaults if token info unavailable
  }

  return { name, symbol };
}

/**
 * Get NFT (ERC-721/1155) holders using Alchemy API
 */
async function getERC721Holders(
  address: string,
  chain: SupportedChain,
  limit: number = HOLDER_LIMIT
): Promise<{ wallets: string[]; totalHolders: number }> {
  const alchemyKey = process.env.ALCHEMY_KEY;
  const baseUrl = ALCHEMY_ENDPOINTS[chain];

  if (!alchemyKey) throw new Error('ALCHEMY_KEY required for NFT holder lookups');
  if (!baseUrl) throw new Error('CHAIN_NO_NFT_SUPPORT');

  const url = `${baseUrl}/${alchemyKey}/getOwnersForContract?contractAddress=${address}&withTokenBalances=false`;

  const response = await withTimeout(
    fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
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
  const owners: string[] = data.owners || [];

  // Normalize to lowercase and dedupe
  const uniqueOwners = [...new Set(owners.map((w: string) => w.toLowerCase()))];
  const totalHolders = uniqueOwners.length;

  // Apply limit
  const limitedOwners = uniqueOwners.slice(0, limit);

  return {
    wallets: limitedOwners,
    totalHolders,
  };
}

/**
 * Blockscout instances that expose an ERC-20 holder index.
 *
 * Moralis does not index Robinhood Chain, which is why token import used to be
 * NFT-only there. That was a provider gap rather than a property of the chain:
 * the chain's own Blockscout explorer indexes ERC-20 holders and paginates
 * them, so it serves the same purpose. Only chains Moralis cannot serve need an
 * entry here.
 */
const BLOCKSCOUT_BASE_URLS: Partial<Record<SupportedChain, string>> = {
  robinhood: 'https://robinhoodchain.blockscout.com',
};

interface BlockscoutHolderItem {
  address?: { hash?: string } | string;
}

interface BlockscoutHoldersResponse {
  items?: BlockscoutHolderItem[];
  // Opaque cursor. Passed back verbatim as query params for the next page.
  next_page_params?: Record<string, string | number> | null;
}

interface BlockscoutV1Response {
  status?: string;
  result?: Array<{ address?: string }> | string;
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
): Promise<string[] | null> {
  const seen = new Set<string>();
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
      if (res.status === 429) throw new Error('RATE_LIMIT');
      if (!res.ok) throw new Error(`Blockscout v1 ${res.status}`);
      json = (await res.json()) as BlockscoutV1Response;
    } catch (error) {
      if (error instanceof Error && error.message === 'RATE_LIMIT') {
        if (seen.size > 0) return Array.from(seen);
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
      return seen.size > 0 ? Array.from(seen) : null;
    }

    // v1 reports "no records found" as status 0 with a string result
    if (json.status !== '1' || !Array.isArray(json.result)) {
      return seen.size > 0 ? Array.from(seen) : null;
    }

    const rows = json.result;
    for (const row of rows) {
      const a = row.address?.toLowerCase();
      if (a?.startsWith('0x')) seen.add(a);
      if (seen.size >= limit) break;
    }

    // A short page is the last page
    if (rows.length < want) break;
  }

  return Array.from(seen);
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
  limit: number
): Promise<{ wallets: string[]; totalHolders: number }> {
  const base = BLOCKSCOUT_BASE_URLS[chain];
  if (!base) throw new Error('CHAIN_NO_ERC20_SUPPORT');

  const headers = { Accept: 'application/json', 'User-Agent': 'walletlink.social' };
  const seen = new Set<string>();
  let totalHolders = 0;

  // ONE budget for everything this function does, started before the first
  // request. The v1 attempt and the v2 fallback must share it: giving each its
  // own timer let a slow token spend 40s failing over v1 and then a further 40s
  // on v2, for 71s against a route whose ceiling is 60.
  const startedAt = Date.now();
  const BUDGET_MS = 40_000;
  const remainingMs = () => BUDGET_MS - (Date.now() - startedAt);

  // Holder count comes from the token record; the holders list itself does not
  // report a total, and we need it to tell the caller the result was truncated.
  try {
    const metaRes = await withTimeout(
      fetch(`${base}/api/v2/tokens/${address}`, { headers }),
      Math.min(10_000, Math.max(2_000, remainingMs())),
      'Blockscout token lookup timed out'
    );
    if (metaRes.ok) {
      const meta = (await metaRes.json()) as { holders_count?: string; holders?: string };
      totalHolders = parseInt(meta.holders_count ?? meta.holders ?? '0', 10) || 0;
    }
  } catch {
    // Non-fatal: a missing total only costs an accurate `truncated` flag
  }

  const v1 = await fetchHoldersV1(base, address, limit, headers, remainingMs);
  if (v1 && v1.length > 0) {
  // `totalHolders` stays 0 when the source did not tell us the real total.
  // It used to fall back to the number of wallets returned, which made
  // `truncated` (wallets.length < totalHolders) impossible to ever be true: a
  // capped list reported itself complete. USDG imported 5,000 of its holders
  // and told the buyer that was all of them.
    return { wallets: v1.slice(0, limit), totalHolders };
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
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
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
      if (res.status === 429) throw new Error('RATE_LIMIT');
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
      if (hash && hash.startsWith('0x')) seen.add(hash.toLowerCase());
      if (seen.size >= limit) break;
    }

    if (!json.next_page_params) break;
    params = json.next_page_params;
    // Be a good citizen on a public explorer
    await new Promise((r) => setTimeout(r, 120));
  }

  const wallets = Array.from(seen).slice(0, limit);
  // 0 means "the source never reported a total". See the note above.
  return { wallets, totalHolders };
}

/**
 * Get ERC-20 token holders using Moralis API
 */
async function getERC20Holders(
  address: string,
  chain: SupportedChain,
  limit: number = HOLDER_LIMIT
): Promise<{ wallets: string[]; totalHolders: number }> {
  // Chain coverage is checked before the API key: on a chain Moralis does not index
  // at all, "no support for this chain" is the accurate error, and configuring a key
  // would not help. Checking the key first would mask that with a config error.
  const chainId = MORALIS_CHAIN_IDS[chain];
  if (!chainId) {
    // ERC-20 holders cannot be derived from RPC state the way NFT owners can
    // (balances are a mapping with no enumerable owner list), so they always
    // need an index. Where Moralis has none, fall back to the chain's own
    // Blockscout explorer, which does.
    if (BLOCKSCOUT_BASE_URLS[chain]) {
      return getERC20HoldersBlockscout(address, chain, limit);
    }
    throw new Error('CHAIN_NO_ERC20_SUPPORT');
  }

  const moralisKey = process.env.MORALIS_API_KEY;
  if (!moralisKey) {
    throw new Error('MORALIS_NOT_CONFIGURED');
  }

  const wallets: string[] = [];
  let cursor: string | null = null;
  let totalHolders = 0;

  // Paginate through results (Moralis returns max 100 per page)
  do {
    const url = new URL(`https://deep-index.moralis.io/api/v2.2/erc20/${address}/owners`);
    url.searchParams.set('chain', chainId);
    url.searchParams.set('limit', '100');
    if (cursor) url.searchParams.set('cursor', cursor);

    const response = await withTimeout(
      fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'X-API-Key': moralisKey,
        },
      }),
      30000,
      'Moralis getTokenHolders timed out'
    );

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error('RATE_LIMIT');
      }
      const errorText = await response.text();
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

    // Extract wallet addresses
    const pageWallets = (data.result || []).map((h: { owner_address: string }) =>
      h.owner_address.toLowerCase()
    );
    wallets.push(...pageWallets);

    cursor = data.cursor || null;

    // Stop if we've reached our limit
    if (wallets.length >= limit) {
      break;
    }

    // Small delay between pages to avoid rate limits
    if (cursor) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  } while (cursor && wallets.length < limit);

  // Dedupe and limit
  const uniqueWallets = [...new Set(wallets)].slice(0, limit);

  return {
    wallets: uniqueWallets,
    // 0 means "the source never reported a total". See the note above.
    totalHolders,
  };
}

/**
 * Main entry point: Get all holders for a contract
 */
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
  limit: number = HOLDER_LIMIT
): Promise<HolderResult> {
  // Validate address format
  if (!ethers.isAddress(address)) {
    throw new Error('INVALID_ADDRESS');
  }

  // Normalize address
  const normalizedAddress = ethers.getAddress(address);

  // Never exceed the hard ceiling, even if a caller asks for more
  const effectiveLimit = Math.min(limit, HOLDER_LIMIT);

  // Detect contract type
  const contractType = await detectContractType(normalizedAddress, chain);

  // Get token info
  const { name: tokenName, symbol: tokenSymbol } = await getTokenInfo(normalizedAddress, chain);

  // Fetch holders based on contract type
  let holdersResult: { wallets: string[]; totalHolders: number };

  if (contractType === 'ERC-721' || contractType === 'ERC-1155') {
    holdersResult = await getERC721Holders(normalizedAddress, chain, effectiveLimit);
  } else {
    holdersResult = await getERC20Holders(normalizedAddress, chain, effectiveLimit);
  }

  if (holdersResult.wallets.length === 0) {
    throw new Error('NO_HOLDERS');
  }

  return {
    wallets: holdersResult.wallets,
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
