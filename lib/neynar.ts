import { cleanTwitterHandle } from './twitter-cleaner';

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
const RATE_LIMIT_DELAY = 200; // ms between batches

export async function fetchNeynarBatch(
  addresses: string[],
  apiKey: string
): Promise<Record<string, NeynarUser[]> | null> {
  try {
    const response = await fetch(
      `https://api.neynar.com/v2/farcaster/user/bulk-by-address?addresses=${addresses.join(',')}`,
      {
        headers: {
          accept: 'application/json',
          'x-api-key': apiKey,
        },
      }
    );

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Invalid Neynar API key');
      }
      if (response.status === 429) {
        throw new Error('Neynar rate limited');
      }
      throw new Error(`Neynar API error: ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching Neynar batch:', error);
    throw error;
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
  onProgress?: (processed: number, found: number) => void
): Promise<Map<string, NeynarResult>> {
  const results = new Map<string, NeynarResult>();
  let processed = 0;
  let found = 0;

  // Process in batches
  for (let i = 0; i < wallets.length; i += BATCH_SIZE) {
    const batch = wallets.slice(i, i + BATCH_SIZE);

    try {
      const response = await fetchNeynarBatch(batch, apiKey);

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
    } catch (error) {
      // Continue processing even if one batch fails
      console.error(`Batch ${i / BATCH_SIZE + 1} failed:`, error);
    }

    processed += batch.length;
    onProgress?.(processed, found);

    // Rate limit delay between batches
    if (i + BATCH_SIZE < wallets.length) {
      await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_DELAY));
    }
  }

  return results;
}

export function isNeynarConfigured(): boolean {
  return !!process.env.NEYNAR_API_KEY;
}
