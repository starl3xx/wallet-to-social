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
  | 'bsc'
  | 'hyperevm';

// EVM chain IDs, used to pin ethers to a static network so it skips auto-detection
export const CHAIN_IDS: Record<SupportedChain, number> = {
  ethereum: 1,
  base: 8453,
  robinhood: 4663,
  arbitrum: 42161,
  polygon: 137,
  optimism: 10,
  bsc: 56,
  hyperevm: 999,
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
  hyperevm: 'HyperEVM',
};

/**
 * Labels for a control that cannot grow to fit them.
 *
 * The network picker in the contract importer is a grid of `h-control` tiles,
 * 34px, three across inside a modal. That leaves roughly 103px of text per
 * tile, and "Robinhood Chain" needs a little more, so it wrapped to two lines
 * and broke out of the one height every control in this product shares.
 *
 * Only the tile is shortened. `CHAIN_LABELS` stays the full name everywhere it
 * has room, including the importer's own result panel two hundred lines below
 * the picker, which already carries a comment about not rendering the raw
 * `robinhood` value. Inside a group whose legend reads "Network", beside
 * Arbitrum and Optimism, the shorter name loses nothing: it is the same width
 * class as its neighbours, which is why they fit and it did not.
 */
export const SUPPORTED_CHAINS = Object.keys(CHAIN_IDS) as SupportedChain[];

/**
 * Chains where ERC-20 (token) holder lookups are available.
 *
 * ERC-20 holder lists always need an index, since balances are a mapping with
 * no enumerable owner list: six chains come from a metered index, and Robinhood
 * Chain from its own Blockscout explorer, which that index does not cover. Five
 * of the six metered chains additionally have a public explorer standing behind
 * them, so an import survives a spent allowance; BNB Chain has no public
 * instance and does not.
 *
 * **HyperEVM is the first supported chain absent from this list**, which is why
 * it and SUPPORTED_CHAINS no longer agree. They were always separate for this
 * reason, stated here before it happened: a chain arrives on the RPC path
 * before it arrives on an index. Nothing indexes HyperEVM balances that we can
 * reach (checked 2026-08-31: the metered index rejects the chain outright, and
 * it has no public Blockscout instance), so token import there is not slow or
 * throttled, it is absent. The UI uses this list to warn before a lookup that
 * would fail server-side, and the HyperEVM row is the first time that warning
 * has ever rendered.
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
