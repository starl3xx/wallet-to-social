import { cleanTwitterHandle } from './twitter-cleaner';
import { trackApiCall } from './analytics';

export interface Web3BioProfile {
  address: string;
  identity: string;
  platform: string;
  displayName: string;
  avatar?: string;
  description?: string;
  links: {
    twitter?: { handle: string; link: string };
    farcaster?: { handle: string; link: string };
    lens?: { handle: string; link: string };
    github?: { handle: string; link: string };
  };
}

export interface Web3BioResult {
  wallet: string;
  ens_name?: string;
  twitter_handle?: string;
  twitter_url?: string;
  farcaster?: string;
  farcaster_url?: string;
  lens?: string;
  github?: string;
  source: string;
}

const RATE_LIMIT_DELAY = 20; // ms between batches
const MAX_CONCURRENT = 50; // Higher with API key
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

export async function fetchWeb3BioProfile(
  walletOrEns: string
): Promise<Web3BioProfile[] | null> {
  const { controller, cleanup } = createTimeoutController(API_TIMEOUT_MS);

  try {
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };

    if (process.env.WEB3BIO_API_KEY) {
      headers['X-API-Key'] = process.env.WEB3BIO_API_KEY;
    }

    const response = await fetch(
      `https://api.web3.bio/profile/${walletOrEns}`,
      {
        headers,
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      throw new Error(`Web3.bio API error: ${response.status}`);
    }

    const data = await response.json();
    return Array.isArray(data) ? data : [data];
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.error(`Web3.bio request timed out for ${walletOrEns}`);
    } else {
      console.error(`Error fetching Web3.bio profile for ${walletOrEns}:`, error);
    }
    return null;
  } finally {
    cleanup();
  }
}

export function parseWeb3BioProfiles(
  profiles: Web3BioProfile[] | null,
  wallet: string
): Web3BioResult | null {
  if (!profiles || profiles.length === 0) return null;

  const result: Web3BioResult = {
    wallet: wallet.toLowerCase(),
    source: 'web3bio',
  };

  for (const profile of profiles) {
    // Get ENS name
    if (profile.platform === 'ens' && profile.identity) {
      result.ens_name = profile.identity;
    }

    // Get Twitter
    if (profile.links?.twitter?.handle) {
      const cleaned = cleanTwitterHandle(profile.links.twitter.handle);
      if (cleaned) {
        result.twitter_handle = cleaned;
        result.twitter_url =
          profile.links.twitter.link || `https://x.com/${cleaned}`;
      }
    }

    // Get Farcaster
    if (profile.links?.farcaster?.handle) {
      result.farcaster = profile.links.farcaster.handle;
      result.farcaster_url =
        profile.links.farcaster.link ||
        `https://warpcast.com/${profile.links.farcaster.handle}`;
    }

    // Get Lens
    if (profile.links?.lens?.handle) {
      result.lens = profile.links.lens.handle;
    }

    // Get GitHub
    if (profile.links?.github?.handle) {
      result.github = profile.links.github.handle;
    }
  }

  // Only return if we found something useful
  if (
    result.ens_name ||
    result.twitter_handle ||
    result.farcaster ||
    result.lens ||
    result.github
  ) {
    return result;
  }

  return null;
}

export async function batchFetchWeb3Bio(
  wallets: string[],
  onProgress?: (processed: number, found: number) => void,
  jobId?: string
): Promise<Map<string, Web3BioResult>> {
  const results = new Map<string, Web3BioResult>();
  let processed = 0;
  let found = 0;
  const startTime = Date.now();
  let errorCount = 0;

  // Process in batches with rate limiting
  for (let i = 0; i < wallets.length; i += MAX_CONCURRENT) {
    const batch = wallets.slice(i, i + MAX_CONCURRENT);

    const batchPromises = batch.map(async (wallet) => {
      const profiles = await fetchWeb3BioProfile(wallet);
      const parsed = parseWeb3BioProfiles(profiles, wallet);

      if (parsed) {
        results.set(wallet.toLowerCase(), parsed);
        found++;
      }

      processed++;
      onProgress?.(processed, found);
    });

    try {
      await Promise.all(batchPromises);
    } catch (error) {
      errorCount++;
    }

    // Rate limit delay between batches
    if (i + MAX_CONCURRENT < wallets.length) {
      await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_DELAY));
    }
  }

  // Track API metrics for the batch
  const latencyMs = Date.now() - startTime;
  trackApiCall('web3bio', {
    latencyMs,
    statusCode: errorCount > 0 ? 500 : 200,
    errorMessage: errorCount > 0 ? `${errorCount} requests failed` : undefined,
    walletCount: wallets.length,
    jobId,
  });

  return results;
}
