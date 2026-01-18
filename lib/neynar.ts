import { cleanTwitterHandle } from './twitter-cleaner';
import { trackApiCall } from './analytics';

export interface NeynarUser {
  fid: number;
  username: string;
  display_name: string;
  follower_count: number;
  pfp_url?: string;
  verified_accounts?: Array<{
    platform: string;
    username: string;
  }>;
}

export interface NeynarResult {
  wallet: string;
  farcaster?: string;
  farcaster_url?: string;
  fc_followers?: number;
  fc_fid?: number;
  twitter_handle?: string;
  twitter_url?: string;
  source: string;
}

const BATCH_SIZE = 200; // Neynar supports up to 350
const RATE_LIMIT_DELAY = 200; // ms between concurrent batch rounds
const CONCURRENT_BATCHES = 5; // Process 5 batches in parallel
const API_TIMEOUT_MS = 15000; // 15 second timeout to prevent hanging requests

/**
 * Creates an AbortController with a timeout
 * Returns both the controller and a cleanup function
 */
function createTimeoutController(timeoutMs: number): {
  controller: AbortController;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return {
    controller,
    cleanup: () => clearTimeout(timeoutId),
  };
}

export async function fetchNeynarBatch(
  addresses: string[],
  apiKey: string
): Promise<Record<string, NeynarUser[]> | null> {
  // Filter out empty/invalid addresses and ensure lowercase
  const validAddresses = addresses
    .filter((addr) => addr && addr.length === 42 && addr.startsWith('0x'))
    .map((addr) => addr.toLowerCase());

  // Return empty if no valid addresses
  if (validAddresses.length === 0) {
    return {};
  }

  const { controller, cleanup } = createTimeoutController(API_TIMEOUT_MS);

  try {
    const response = await fetch(
      `https://api.neynar.com/v2/farcaster/user/bulk-by-address?addresses=${validAddresses.join(',')}`,
      {
        headers: {
          accept: 'application/json',
          'x-api-key': apiKey,
        },
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Invalid Neynar API key');
      }
      if (response.status === 429) {
        throw new Error('Neynar rate limited');
      }
      if (response.status === 404) {
        // 404 can happen if none of the addresses have Farcaster accounts
        // This is not an error - just return empty result
        return {};
      }
      throw new Error(`Neynar API error: ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.error('Neynar request timed out');
      throw new Error('Neynar request timed out');
    }
    console.error('Error fetching Neynar batch:', error);
    throw error;
  } finally {
    cleanup();
  }
}

export function parseNeynarUser(
  users: NeynarUser[] | undefined,
  wallet: string
): NeynarResult | null {
  if (!users || users.length === 0) return null;

  // Get the first user (primary)
  const user = users[0];

  const result: NeynarResult = {
    wallet: wallet.toLowerCase(),
    farcaster: user.username,
    farcaster_url: `https://warpcast.com/${user.username}`,
    fc_followers: user.follower_count,
    fc_fid: user.fid,
    source: 'neynar',
  };

  // Check for verified Twitter
  const twitterAccount = user.verified_accounts?.find(
    (acc) => acc.platform === 'twitter' || acc.platform === 'x'
  );

  if (twitterAccount?.username) {
    const cleaned = cleanTwitterHandle(twitterAccount.username);
    if (cleaned) {
      result.twitter_handle = cleaned;
      result.twitter_url = `https://x.com/${cleaned}`;
    }
  }

  return result;
}

export async function batchFetchNeynar(
  wallets: string[],
  apiKey: string,
  onProgress?: (processed: number, found: number) => void,
  jobId?: string
): Promise<Map<string, NeynarResult>> {
  const results = new Map<string, NeynarResult>();
  let processed = 0;
  let found = 0;
  const startTime = Date.now();
  let errorCount = 0;
  let lastError: string | undefined;

  // Split wallets into batches of BATCH_SIZE
  const batches: string[][] = [];
  for (let i = 0; i < wallets.length; i += BATCH_SIZE) {
    batches.push(wallets.slice(i, i + BATCH_SIZE));
  }

  // Process CONCURRENT_BATCHES in parallel
  for (let i = 0; i < batches.length; i += CONCURRENT_BATCHES) {
    const concurrentBatches = batches.slice(i, i + CONCURRENT_BATCHES);

    const batchPromises = concurrentBatches.map(async (batch) => {
      try {
        const response = await fetchNeynarBatch(batch, apiKey);
        return { batch, response, error: null };
      } catch (error) {
        console.error(`Neynar batch failed:`, error);
        errorCount++;
        lastError = error instanceof Error ? error.message : 'Unknown error';
        return { batch, response: null, error };
      }
    });

    const batchResults = await Promise.all(batchPromises);

    // Process results from all concurrent batches
    for (const { batch, response } of batchResults) {
      if (response) {
        for (const wallet of batch) {
          const walletLower = wallet.toLowerCase();
          const users = response[walletLower];
          const parsed = parseNeynarUser(users, wallet);

          if (parsed) {
            results.set(walletLower, parsed);
            found++;
          }
        }
      }
      processed += batch.length;
    }

    onProgress?.(processed, found);

    // Rate limit delay between concurrent rounds
    if (i + CONCURRENT_BATCHES < batches.length) {
      await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_DELAY));
    }
  }

  // Track API metrics for the batch
  const latencyMs = Date.now() - startTime;
  trackApiCall('neynar', {
    latencyMs,
    statusCode: errorCount > 0 ? 500 : 200,
    errorMessage: lastError,
    walletCount: wallets.length,
    jobId,
  });

  return results;
}

export function isNeynarConfigured(): boolean {
  return !!process.env.NEYNAR_API_KEY;
}
