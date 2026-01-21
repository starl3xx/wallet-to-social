import { ethers } from 'ethers';
import { cleanTwitterHandle } from './twitter-cleaner';

const RPC_ENDPOINTS = [
  'https://eth.llamarpc.com',
  'https://rpc.ankr.com/eth',
  'https://ethereum.publicnode.com',
];

const RPC_TIMEOUT_MS = 15000; // 15 second timeout for RPC calls

let providerIndex = 0;

function getProvider(): ethers.JsonRpcProvider {
  const endpoint = process.env.ALCHEMY_KEY
    ? `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_KEY}`
    : RPC_ENDPOINTS[providerIndex % RPC_ENDPOINTS.length];
  return new ethers.JsonRpcProvider(endpoint);
}

function rotateProvider() {
  providerIndex++;
}

/**
 * Wraps a promise with a timeout
 * Rejects with a timeout error if the promise doesn't resolve in time
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

// Text record keys where Twitter handles are stored (per ENSIP-5)
const TWITTER_KEYS = ['com.twitter', 'twitter', 'vnd.twitter'];

export interface ENSResult {
  wallet: string;
  ensName: string | null;
  twitter: string | null;
  twitterUrl: string | null;
  url: string | null;
  github: string | null;
  email: string | null;
}

export async function getENSName(wallet: string): Promise<string | null> {
  const provider = getProvider();
  try {
    const name = await withTimeout(
      provider.lookupAddress(wallet),
      RPC_TIMEOUT_MS,
      `ENS lookup timed out for ${wallet}`
    );
    return name;
  } catch (error) {
    if (error instanceof Error && error.message.includes('timed out')) {
      console.error(error.message);
    }
    rotateProvider();
    return null;
  }
}

export async function getENSTextRecords(ensName: string): Promise<{
  twitter: string | null;
  url: string | null;
  github: string | null;
  email: string | null;
}> {
  const provider = getProvider();
  const result = {
    twitter: null as string | null,
    url: null as string | null,
    github: null as string | null,
    email: null as string | null,
  };

  try {
    const resolver = await withTimeout(
      provider.getResolver(ensName),
      RPC_TIMEOUT_MS,
      `ENS resolver lookup timed out for ${ensName}`
    );
    if (!resolver) return result;

    // Wrap each text record lookup with timeout and use Promise.allSettled
    const [twitter1, twitter2, twitter3, url, github, email] =
      await Promise.allSettled([
        withTimeout(resolver.getText('com.twitter'), RPC_TIMEOUT_MS, 'getText timeout'),
        withTimeout(resolver.getText('twitter'), RPC_TIMEOUT_MS, 'getText timeout'),
        withTimeout(resolver.getText('vnd.twitter'), RPC_TIMEOUT_MS, 'getText timeout'),
        withTimeout(resolver.getText('url'), RPC_TIMEOUT_MS, 'getText timeout'),
        withTimeout(resolver.getText('com.github'), RPC_TIMEOUT_MS, 'getText timeout'),
        withTimeout(resolver.getText('email'), RPC_TIMEOUT_MS, 'getText timeout'),
      ]);

    // Find first valid Twitter handle
    for (const t of [twitter1, twitter2, twitter3]) {
      if (t.status === 'fulfilled' && t.value) {
        const cleaned = cleanTwitterHandle(t.value);
        if (cleaned) {
          result.twitter = cleaned;
          break;
        }
      }
    }

    if (url.status === 'fulfilled') result.url = url.value || null;
    if (github.status === 'fulfilled') result.github = github.value || null;
    if (email.status === 'fulfilled') result.email = email.value || null;

    return result;
  } catch (error) {
    if (error instanceof Error && error.message.includes('timed out')) {
      console.error(error.message);
    }
    rotateProvider();
    return result;
  }
}

export async function lookupWalletENS(wallet: string): Promise<ENSResult> {
  const result: ENSResult = {
    wallet: wallet.toLowerCase(),
    ensName: null,
    twitter: null,
    twitterUrl: null,
    url: null,
    github: null,
    email: null,
  };

  try {
    // Step 1: Reverse resolve wallet to ENS name
    const ensName = await getENSName(wallet);
    if (!ensName) return result;

    result.ensName = ensName;

    // Step 2: Get text records
    const records = await getENSTextRecords(ensName);
    result.twitter = records.twitter;
    if (records.twitter) {
      result.twitterUrl = `https://x.com/${records.twitter}`;
    }
    result.url = records.url;
    result.github = records.github;
    result.email = records.email;

    return result;
  } catch (error) {
    console.error(`ENS lookup failed for ${wallet}:`, error);
    return result;
  }
}

export async function batchLookupENS(
  wallets: string[],
  onProgress?: (completed: number, found: number) => void,
  batchSize = 50, // Increased from 20 for faster processing
  delayMs = 50
): Promise<Map<string, ENSResult>> {
  const results = new Map<string, ENSResult>();
  let completed = 0;
  let found = 0;

  for (let i = 0; i < wallets.length; i += batchSize) {
    const batch = wallets.slice(i, i + batchSize);

    const batchResults = await Promise.allSettled(
      batch.map((wallet) => lookupWalletENS(wallet))
    );

    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        const data = result.value;
        if (data.twitter || data.ensName) {
          results.set(data.wallet, data);
          if (data.twitter) found++;
        }
      }
      completed++;
    }
    onProgress?.(completed, found);

    // Small delay between batches
    if (i + batchSize < wallets.length) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return results;
}
