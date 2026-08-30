/**
 * Contracts a human would search for by name.
 *
 * The daily seed cron discovers candidates from OpenSea `trending` and
 * GeckoTerminal `trending_pools`, then skips anything seeded in the last
 * NOVELTY_DAYS. Both halves of that are novelty-seeking, so the corpus it
 * built is anti-correlated with search demand by construction: trending ranks
 * what has no search history yet, and the novelty filter then works further
 * down that list. On 2026-08-30 the result was 66 published reports whose
 * titles held one recognisable brand, plus one page called "Unknown Token
 * holders on Base".
 *
 * Search Console for the three months to 2026-08-28 shows what that costs: 4
 * clicks and 379 impressions at average position 50.1. The one non-brand
 * product query in the top ten was `chainlink holders`, 13 impressions, and
 * there was no Chainlink page to answer it.
 *
 * So this list leads the queue. It is not a quality ranking and not a market
 * cap ranking: the only question asked of an entry is whether somebody would
 * type its name into a search box next to a word like "holders", "owners" or
 * "whales". A wrapped asset with a huge market cap fails that. A mid-sized
 * collection with a loud community passes.
 *
 * It is deliberately finite. Once every entry has been seeded, the novelty
 * filter drops them all and discovery falls through to the trending feeds as
 * before; thirty days later the oldest becomes eligible again and its report
 * refreshes. Nothing here needs pruning to keep the cron working.
 *
 * Every address was read from at least two independent sources and then
 * re-read by a second pass against a third, because the failure that matters
 * here is silent: a canonical mainnet address filed under a layer 2 key
 * publishes a page about the wrong asset and nothing in the pipeline
 * disagrees. Do not add an entry from memory. Read the address, twice.
 */

import type { SupportedChain } from './chains';

export interface RecognizedContract {
  address: string;
  chain: SupportedChain;
  kind: 'nft' | 'erc20';
  /** The name a person would search, not the ticker and not the contract name. */
  label: string;
}

/**
 * Verified 2026-08-30. Every address was read from live sources by one pass and
 * then re-read by a second against different ones, in three layers: an onchain
 * `name()` call over an independent RPC, a resolution run in the reverse
 * direction (brand slug to address, which is the direction that catches an
 * impostor contract), and a second index. 63 entries survived; 22 were rejected.
 *
 * Four rejections are worth recording, because each one looks like an obvious
 * addition to anybody who has not checked:
 *
 * - **CryptoPunks.** The address is right and the name is the best-known in the
 *   category, but the contract predates ERC-721: `ownerOf` reverts, there is no
 *   ERC-165, and ownership lives in a non-standard `punkIndexToAddress` mapping.
 *   CoinGecko reports 100 holders against a real figure near 3,900, so seeding it
 *   publishes exactly the broken page this list exists to prevent. It needs a
 *   punks-specific ownership reader in the ingest first. Wrapped Cryptopunks is
 *   not a substitute: its supply is 381 against 10,000 punks.
 * - **Virtuals Protocol on Base** and **Worldcoin on Optimism** are bridge
 *   representations, not native deployments, so they fail the wrapped-asset rule.
 * - **Smol Brains.** Two reputable sources gave different addresses for the same
 *   identity. The rule is to exclude on disagreement rather than pick a side.
 *
 * Chain-name lookalikes were rejected wholesale on recognition (OptiPunks,
 * Optimism Ape Yacht Club, OptiChads and similar): the searches they attract are
 * the halo of the original, and the communities are a few thousand wallets.
 */
export const RECOGNIZED_CONTRACTS: RecognizedContract[] = [
  // Ethereum: 7 tokens, 7 collections
  {
    address: '0x514910771af9ca656af840dff83e8264ecf986ca',
    chain: 'ethereum',
    kind: 'erc20',
    label: 'Chainlink',
  },
  {
    address: '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d',
    chain: 'ethereum',
    kind: 'nft',
    label: 'Bored Ape Yacht Club',
  },
  {
    address: '0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce',
    chain: 'ethereum',
    kind: 'erc20',
    label: 'Shiba Inu',
  },
  {
    address: '0x6982508145454ce325ddbe47a25d4ec3d2311933',
    chain: 'ethereum',
    kind: 'erc20',
    label: 'Pepe',
  },
  {
    address: '0xbd3531da5cf5857e7cfaa92426877b022e612cf8',
    chain: 'ethereum',
    kind: 'nft',
    label: 'Pudgy Penguins',
  },
  {
    address: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984',
    chain: 'ethereum',
    kind: 'erc20',
    label: 'Uniswap',
  },
  {
    address: '0xed5af388653567af2f388e6224dc7c4b3241c544',
    chain: 'ethereum',
    kind: 'nft',
    label: 'Azuki',
  },
  {
    address: '0x4d224452801aced8b2f0aebe155379bb5d594381',
    chain: 'ethereum',
    kind: 'erc20',
    label: 'ApeCoin',
  },
  {
    address: '0x5af0d9827e0c53e4799bb226655a1de152a425a5',
    chain: 'ethereum',
    kind: 'nft',
    label: 'Milady Maker',
  },
  {
    address: '0xc18360217d8f7ab5e7c516566761ea12ce7f9d72',
    chain: 'ethereum',
    kind: 'erc20',
    label: 'Ethereum Name Service',
  },
  {
    address: '0x8a90cab2b38dba80c64b7734e58ee1db38b8992e',
    chain: 'ethereum',
    kind: 'nft',
    label: 'Doodles',
  },
  {
    address: '0x60e4d786628fea6478f785a6d7e704777c86a7c6',
    chain: 'ethereum',
    kind: 'nft',
    label: 'Mutant Ape Yacht Club',
  },
  {
    address: '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9',
    chain: 'ethereum',
    kind: 'erc20',
    label: 'Aave',
  },
  {
    address: '0x79fcdef22feed20eddacbb2587640e45491b757f',
    chain: 'ethereum',
    kind: 'nft',
    label: 'mfers',
  },

  // Base: 9 tokens, 2 collections
  {
    address: '0x4ed4e862860bed51a9570b96d89af5e1b0efefed',
    chain: 'base',
    kind: 'erc20',
    label: 'Degen',
  },
  {
    address: '0x940181a94a35a4569e4529a3cdfb74e38fd98631',
    chain: 'base',
    kind: 'erc20',
    label: 'Aerodrome',
  },
  {
    address: '0x1111111111166b7fe7bd91427724b487980afc69',
    chain: 'base',
    kind: 'erc20',
    label: 'Zora',
  },
  {
    address: '0xac1bd2486aaf3b5c0fc3fd868558b082a531b2b4',
    chain: 'base',
    kind: 'erc20',
    label: 'Toshi',
  },
  {
    address: '0x532f27101965dd16442e59d40670faf5ebb142e4',
    chain: 'base',
    kind: 'erc20',
    label: 'Brett',
  },
  {
    address: '0x4f9fd6be4a90f2620860d680c0d4d5fb53d1a825',
    chain: 'base',
    kind: 'erc20',
    label: 'aixbt',
  },
  {
    address: '0x1bc0c42215582d5a085795f4badbac3ff36d1bcb',
    chain: 'base',
    kind: 'erc20',
    label: 'Clanker',
  },
  {
    address: '0xba5e05cb26b78eda3a2f8e3b3814726305dcac83',
    chain: 'base',
    kind: 'nft',
    label: 'BasePaint',
  },
  {
    address: '0xb1a03eda10342529bbf8eb700a06c60441fef25d',
    chain: 'base',
    kind: 'erc20',
    label: 'Mister Miggles',
  },
  {
    address: '0x07152bfde079b5319e5308c43fb1dbc9c76cb4f9',
    chain: 'base',
    kind: 'nft',
    label: 'Chonks',
  },
  {
    address: '0x22af33fe49fd1fa80c7149773dde5890d3c76f3b',
    chain: 'base',
    kind: 'erc20',
    label: 'Bankr',
  },

  // Arbitrum: 7 tokens, 2 collections
  {
    address: '0x912ce59144191c1204e64559fe8253a0e49e6548',
    chain: 'arbitrum',
    kind: 'erc20',
    label: 'Arbitrum',
  },
  {
    address: '0xfc5a1a6eb076a2c7ad06ed22c90d7e710e35ad0a',
    chain: 'arbitrum',
    kind: 'erc20',
    label: 'GMX',
  },
  {
    address: '0x0c880f6761f1af8d9aa9c466984b80dab9a8c9e8',
    chain: 'arbitrum',
    kind: 'erc20',
    label: 'Pendle',
  },
  {
    address: '0x539bde0d7dbd336b79148aa742883198bbf60342',
    chain: 'arbitrum',
    kind: 'erc20',
    label: 'Treasure (MAGIC)',
  },
  {
    address: '0x4cb9a7ae498cedcbb5eae9f25736ae7d428c9d66',
    chain: 'arbitrum',
    kind: 'erc20',
    label: 'Xai',
  },
  {
    address: '0x3d9907f9a368ad0a51be60f7da3b97cf940982d8',
    chain: 'arbitrum',
    kind: 'erc20',
    label: 'Camelot (GRAIL)',
  },
  {
    address: '0x18c11fd286c5ec11c3b683caa813b77f5163a122',
    chain: 'arbitrum',
    kind: 'erc20',
    label: 'Gains Network (GNS)',
  },
  {
    address: '0xbc14d8563b248b79689ecbc43bba53290e0b6b66',
    chain: 'arbitrum',
    kind: 'nft',
    label: 'Xai Sentry Node License',
  },
  {
    address: '0x17f4baa9d35ee54ffbcb2608e20786473c7aa49f',
    chain: 'arbitrum',
    kind: 'nft',
    label: 'GMX Blueberry Club',
  },

  // Optimism: 4 tokens, 2 collections
  {
    address: '0x4200000000000000000000000000000000000042',
    chain: 'optimism',
    kind: 'erc20',
    label: 'Optimism',
  },
  {
    address: '0x9560e827af36c94d2ac33a39bce1fe78631088db',
    chain: 'optimism',
    kind: 'erc20',
    label: 'Velodrome',
  },
  {
    address: '0xef4461891dfb3ac8572ccf7c794664a8dd927945',
    chain: 'optimism',
    kind: 'erc20',
    label: 'WalletConnect',
  },
  {
    address: '0x2335022c740d17c2837f9c884bfe4ffdbf0a95d5',
    chain: 'optimism',
    kind: 'nft',
    label: 'Optimist NFT',
  },
  {
    address: '0x8700daec35af8ff88c16bdf0418774cb3d7599b4',
    chain: 'optimism',
    kind: 'erc20',
    label: 'Synthetix',
  },
  {
    address: '0xbb7b805b257d7c76ca9435b3ffe780355e4c4b17',
    chain: 'optimism',
    kind: 'nft',
    label: '3DNS Powered Domain Names',
  },

  // Polygon: 4 tokens, 7 collections
  {
    address: '0xdb46d1dc155634fbc732f92e853b10b288ad5a1d',
    chain: 'polygon',
    kind: 'nft',
    label: 'Lens Protocol Profiles',
  },
  {
    address: '0xdf7837de1f2fa4631d716cf2502f8b230f1dcc32',
    chain: 'polygon',
    kind: 'erc20',
    label: 'Telcoin',
  },
  {
    address: '0x251be3a17af4892035c37ebf5890f4a4d889dcad',
    chain: 'polygon',
    kind: 'nft',
    label: 'Courtyard.io',
  },
  {
    address: '0xb5c064f955d8e7f38fe0460c556a72987494ee17',
    chain: 'polygon',
    kind: 'erc20',
    label: 'QuickSwap',
  },
  {
    address: '0xe261d618a959afffd53168cd07d12e37b26761db',
    chain: 'polygon',
    kind: 'erc20',
    label: 'DIMO',
  },
  {
    address: '0x2b4a66557a79263275826ad31a4cddc2789334bd',
    chain: 'polygon',
    kind: 'nft',
    label: 'Sunflower Land',
  },
  {
    address: '0x385eeac5cb85a38a9a07a70c73e0a3271cfb54a7',
    chain: 'polygon',
    kind: 'erc20',
    label: 'Aavegotchi',
  },
  {
    address: '0xba6666b118f8303f990f3519df07e160227cce87',
    chain: 'polygon',
    kind: 'nft',
    label: 'Planet IX',
  },
  {
    address: '0x67f4732266c7300cca593c814d46bee72e40659f',
    chain: 'polygon',
    kind: 'nft',
    label: 'ZED RUN',
  },
  {
    address: '0x6380ccb3ada62ed1b13aa2b0a98fab0c1c7f0aa3',
    chain: 'polygon',
    kind: 'nft',
    label: 'Nike Our Force 1',
  },
  {
    address: '0x24a11e702cd90f034ea44faf1e180c0c654ac5d9',
    chain: 'polygon',
    kind: 'nft',
    label: 'Trump Digital Trading Cards',
  },

  // BNB Chain: 9 tokens, 1 collection
  {
    address: '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82',
    chain: 'bsc',
    kind: 'erc20',
    label: 'PancakeSwap',
  },
  {
    address: '0xc748673057861a797275cd8a068abb95a902e8de',
    chain: 'bsc',
    kind: 'erc20',
    label: 'Baby Doge Coin',
  },
  {
    address: '0xfb5b838b6cfeedc2873ab27866079ac55363d37e',
    chain: 'bsc',
    kind: 'erc20',
    label: 'FLOKI',
  },
  {
    address: '0x4b0f1812e5df2a09796481ff14017e6005508003',
    chain: 'bsc',
    kind: 'erc20',
    label: 'Trust Wallet Token',
  },
  {
    address: '0x000ae314e2a2172a039b26378814c252734f556a',
    chain: 'bsc',
    kind: 'erc20',
    label: 'Aster',
  },
  {
    address: '0xcf6bb5389c92bdda8a3747ddb454cb7a64626c63',
    chain: 'bsc',
    kind: 'erc20',
    label: 'Venus',
  },
  {
    address: '0xd41fdb03ba84762dd66a0af1a6c8540ff1ba5dfb',
    chain: 'bsc',
    kind: 'erc20',
    label: 'SafePal',
  },
  {
    address: '0xfceb31a79f71ac9cbdcf853519c1b12d379edc46',
    chain: 'bsc',
    kind: 'erc20',
    label: 'Lista DAO',
  },
  {
    address: '0x2dff88a56767223a5529ea5960da7a3f5f766406',
    chain: 'bsc',
    kind: 'erc20',
    label: 'SPACE ID',
  },
  {
    address: '0x0a8901b0e25deb55a87524f0cc164e9644020eba',
    chain: 'bsc',
    kind: 'nft',
    label: 'Pancake Squad',
  },

  // Robinhood Chain: 2 tokens, 0 collections
  {
    address: '0x020bfc650a365f8bb26819deaabf3e21291018b4',
    chain: 'robinhood',
    kind: 'erc20',
    label: 'Cash Cat',
  },
  {
    address: '0x39dbed3a2bd333467115de45665cc57f813c4571',
    chain: 'robinhood',
    kind: 'erc20',
    label: 'Pons',
  },
];

/**
 * The recognised contracts for one chain and kind, best-first.
 *
 * Returned as plain candidates so they can be prepended to whatever discovery
 * finds. Novelty filtering happens downstream in `selectNovelCandidates`, the
 * same as for a discovered candidate, so an entry seeded last week drops out
 * on its own and the next one takes the slot.
 */
export function recognizedCandidates(
  chain: SupportedChain,
  kind: 'nft' | 'erc20'
): RecognizedContract[] {
  return RECOGNIZED_CONTRACTS.filter(
    (c) => c.chain === chain && c.kind === kind
  );
}
