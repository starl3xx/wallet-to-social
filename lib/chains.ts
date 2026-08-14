/**
 * Chain constants shared between server and client.
 *
 * This module deliberately has no dependencies. `lib/contract-holders.ts` imports
 * `ethers`, so client components must not import values from it — doing so pulls
 * the whole ethers bundle into the browser. Anything the UI needs about chains
 * (labels, the selectable list) lives here instead.
 */

export type SupportedChain =
  | 'ethereum'
  | 'base'
  | 'robinhood'
  | 'arbitrum'
  | 'polygon'
  | 'optimism'
  | 'bsc';

// EVM chain IDs, used to pin ethers to a static network so it skips auto-detection
export const CHAIN_IDS: Record<SupportedChain, number> = {
  ethereum: 1,
  base: 8453,
  robinhood: 4663,
  arbitrum: 42161,
  polygon: 137,
  optimism: 10,
  bsc: 56,
};

// Human-readable chain labels for error messages and UI
export const CHAIN_LABELS: Record<SupportedChain, string> = {
  ethereum: 'Ethereum',
  base: 'Base',
  robinhood: 'Robinhood Chain',
  arbitrum: 'Arbitrum',
  polygon: 'Polygon',
  optimism: 'Optimism',
  bsc: 'BNB Chain',
};

export const SUPPORTED_CHAINS = Object.keys(CHAIN_IDS) as SupportedChain[];

/**
 * Chains where ERC-20 (token) holder lookups are available.
 *
 * NFT holder lookups work on every supported chain via Alchemy. ERC-20 holder
 * lists always need an index, since balances are a mapping with no enumerable
 * owner list: Ethereum and Base come from Moralis, and Robinhood Chain from its
 * own Blockscout explorer, which Moralis does not cover. The UI uses this to
 * warn before a lookup that would fail server-side.
 *
 * Keep in step with MORALIS_CHAIN_IDS and BLOCKSCOUT_BASE_URLS in
 * lib/contract-holders.ts: a chain listed here with no backing index would
 * promise an import that fails.
 */
export const ERC20_SUPPORTED_CHAINS: SupportedChain[] = [
  'ethereum',
  'base',
  'robinhood',
  'arbitrum',
  'polygon',
  'optimism',
  'bsc',
];
