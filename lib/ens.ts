import { ethers } from 'ethers';
import { cleanTwitterHandle } from './twitter-cleaner';
import { maskWallet } from './redact';

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
        withTimeout(
          resolver.getText('com.twitter'),
          RPC_TIMEOUT_MS,
          'getText timeout'
        ),
        withTimeout(
          resolver.getText('twitter'),
          RPC_TIMEOUT_MS,
          'getText timeout'
        ),
        withTimeout(
          resolver.getText('vnd.twitter'),
          RPC_TIMEOUT_MS,
          'getText timeout'
        ),
        withTimeout(resolver.getText('url'), RPC_TIMEOUT_MS, 'getText timeout'),
        withTimeout(
          resolver.getText('com.github'),
          RPC_TIMEOUT_MS,
          'getText timeout'
        ),
        withTimeout(
          resolver.getText('email'),
          RPC_TIMEOUT_MS,
          'getText timeout'
        ),
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
    console.error(`ENS lookup failed for ${maskWallet(wallet)}:`, error);
    return result;
  }
}

/**
 * Whether the batch is out of time. When it is, every wallet it has not
 * reached is recorded as unreached, and the caller stops.
 *
 * Unreached is the point. The job worker treats a wallet in `failedWallets`
 * as never checked, so it is neither cached as empty nor written to the graph
 * as a negative: a wallet ENS never asked about is not a wallet with no ENS
 * name. Lowercased, because that is how the worker keys the set.
 */
export function ensPastDeadline(
  deadline: number | undefined,
  unreached: readonly string[],
  failedWallets?: Set<string>
): boolean {
  if (deadline === undefined || Date.now() < deadline) return false;
  for (const wallet of unreached) failedWallets?.add(wallet.toLowerCase());
  return true;
}

/**
 * Two-phase batch ENS lookup:
 * Phase 1: Reverse-resolve all wallets to ENS names in parallel
 * Phase 2: Fetch text records only for wallets that have ENS names
 *
 * This avoids the per-wallet serial penalty of resolve→text-records by
 * batching each phase independently.
 *
 * `opts.deadline` is a wall-clock time after which no new batch starts, the
 * same bound `batchFetchWeb3Bio` has. Without it a slice of 3,000 addresses is
 * 60 serial batches, each able to wait out a 15-second RPC timeout, which can
 * outrun the job worker's whole invocation: the platform kills it before
 * anything is saved, and the next claim runs the same slice again.
 */
export async function batchLookupENS(
  wallets: string[],
  onProgress?: (completed: number, found: number) => void,
  batchSize = 50,
  delayMs = 50,
  opts?: { deadline?: number; failedWallets?: Set<string> }
): Promise<Map<string, ENSResult>> {
  const results = new Map<string, ENSResult>();
  let found = 0;

  // Phase 1: Batch reverse-resolve all wallets to ENS names
  const ensNames = new Map<string, string>(); // wallet → ensName
  let completed = 0;
  for (let i = 0; i < wallets.length; i += batchSize) {
    if (ensPastDeadline(opts?.deadline, wallets.slice(i), opts?.failedWallets))
      break;
    const batch = wallets.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(
      batch.map(async (wallet) => ({
        wallet: wallet.toLowerCase(),
        ensName: await getENSName(wallet),
      }))
    );

    for (const result of batchResults) {
      if (result.status === 'fulfilled' && result.value.ensName) {
        ensNames.set(result.value.wallet, result.value.ensName);
      }
      completed++;
    }
    onProgress?.(completed, found);

    if (i + batchSize < wallets.length) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  // Phase 2: Fetch text records only for wallets with ENS names (in parallel)
  const walletsWithENS = Array.from(ensNames.entries());
  for (let i = 0; i < walletsWithENS.length; i += batchSize) {
    // A name found but its records never read is as unchecked as no name.
    if (
      ensPastDeadline(
        opts?.deadline,
        walletsWithENS.slice(i).map(([wallet]) => wallet),
        opts?.failedWallets
      )
    )
      break;
    const batch = walletsWithENS.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(
      batch.map(async ([wallet, ensName]) => {
        const records = await getENSTextRecords(ensName);
        const result: ENSResult = {
          wallet,
          ensName,
          twitter: records.twitter,
          twitterUrl: records.twitter
            ? `https://x.com/${records.twitter}`
            : null,
          url: records.url,
          github: records.github,
          email: records.email,
        };
        return result;
      })
    );

    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        const data = result.value;
        if (data.twitter || data.ensName) {
          results.set(data.wallet, data);
          if (data.twitter) found++;
        }
      }
    }
    onProgress?.(completed, found);

    if (i + batchSize < walletsWithENS.length) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return results;
}
