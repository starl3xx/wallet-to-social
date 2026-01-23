import { ethers } from 'ethers';

// Types
export type ContractType = 'ERC-20' | 'ERC-721' | 'ERC-1155';
export type SupportedChain = 'ethereum' | 'base';

export interface HolderResult {
  wallets: string[];
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
};

// Alchemy endpoints for NFT holder lookups
const ALCHEMY_ENDPOINTS: Record<SupportedChain, string> = {
  ethereum: 'https://eth-mainnet.g.alchemy.com/nft/v3',
  base: 'https://base-mainnet.g.alchemy.com/nft/v3',
};

// Moralis chain IDs (use hex format for better compatibility)
const MORALIS_CHAIN_IDS: Record<SupportedChain, string> = {
  ethereum: '0x1',
  base: '0x2105',
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
 */
function getProvider(chain: SupportedChain): ethers.JsonRpcProvider {
  const alchemyKey = process.env.ALCHEMY_KEY;

  if (alchemyKey) {
    const alchemyEndpoint = chain === 'ethereum'
      ? `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}`
      : `https://base-mainnet.g.alchemy.com/v2/${alchemyKey}`;
    return new ethers.JsonRpcProvider(alchemyEndpoint);
  }

  // Fallback to public RPC
  const endpoints = RPC_ENDPOINTS[chain];
  return new ethers.JsonRpcProvider(endpoints[0]);
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
  if (!alchemyKey) {
    throw new Error('ALCHEMY_KEY required for NFT holder lookups');
  }

  const baseUrl = ALCHEMY_ENDPOINTS[chain];
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
 * Get ERC-20 token holders using Moralis API
 */
async function getERC20Holders(
  address: string,
  chain: SupportedChain,
  limit: number = HOLDER_LIMIT
): Promise<{ wallets: string[]; totalHolders: number }> {
  const moralisKey = process.env.MORALIS_API_KEY;
  if (!moralisKey) {
    throw new Error('MORALIS_API_KEY required for ERC-20 holder lookups');
  }

  const chainId = MORALIS_CHAIN_IDS[chain];
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
    totalHolders: totalHolders || uniqueWallets.length,
  };
}

/**
 * Main entry point: Get all holders for a contract
 */
export async function getContractHolders(
  address: string,
  chain: SupportedChain
): Promise<HolderResult> {
  // Validate address format
  if (!ethers.isAddress(address)) {
    throw new Error('INVALID_ADDRESS');
  }

  // Normalize address
  const normalizedAddress = ethers.getAddress(address);

  // Detect contract type
  const contractType = await detectContractType(normalizedAddress, chain);

  // Get token info
  const { name: tokenName, symbol: tokenSymbol } = await getTokenInfo(normalizedAddress, chain);

  // Fetch holders based on contract type
  let holdersResult: { wallets: string[]; totalHolders: number };

  if (contractType === 'ERC-721' || contractType === 'ERC-1155') {
    holdersResult = await getERC721Holders(normalizedAddress, chain, HOLDER_LIMIT);
  } else {
    holdersResult = await getERC20Holders(normalizedAddress, chain, HOLDER_LIMIT);
  }

  if (holdersResult.wallets.length === 0) {
    throw new Error('NO_HOLDERS');
  }

  return {
    wallets: holdersResult.wallets,
    tokenName,
    tokenSymbol,
    contractType,
    totalHolders: holdersResult.totalHolders,
    truncated: holdersResult.totalHolders > HOLDER_LIMIT,
    chain,
  };
}
