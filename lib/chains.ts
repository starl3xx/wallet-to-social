/**
 * Chain constants shared between server and client.
 *
 * This module deliberately has no dependencies. `lib/contract-holders.ts` imports
 * `ethers`, so client components must not import values from it — doing so pulls
 * the whole ethers bundle into the browser. Anything the UI needs about chains
 * (labels, the selectable list) lives here instead.
 */

export type SupportedChain = 'ethereum' | 'base' | 'robinhood';

// EVM chain IDs, used to pin ethers to a static network so it skips auto-detection
export const CHAIN_IDS: Record<SupportedChain, number> = {
  ethereum: 1,
  base: 8453,
  robinhood: 4663,
};

// Human-readable chain labels for error messages and UI
export const CHAIN_LABELS: Record<SupportedChain, string> = {
  ethereum: 'Ethereum',
  base: 'Base',
  robinhood: 'Robinhood Chain',
};

export const SUPPORTED_CHAINS = Object.keys(CHAIN_IDS) as SupportedChain[];

/**
 * Chains where ERC-20 (token) holder lookups are available.
 *
 * NFT holder lookups work on every supported chain via Alchemy, but ERC-20 holder
 * lists require a Moralis index, which does not cover every chain. The UI uses this
 * to warn before a lookup that would fail server-side.
 */
export const ERC20_SUPPORTED_CHAINS: SupportedChain[] = ['ethereum', 'base'];
