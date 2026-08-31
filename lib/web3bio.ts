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

const RATE_LIMIT_DELAY = 10; // ms between batches
const MAX_CONCURRENT = 100; // Zero 429s at 50 over 30 days — safe to double

/**
 * Per-request timeout, cut from 15s to 6s on measurement.
 *
 * A wallet that has not answered in six seconds is not going to. Across 208
 * healthy batches the slowest wave of 100 took 2.79s (83.7s over 30 waves), so
 * six is more than double the worst wave ever observed and eight times the
 * typical one.
 *
 * The old 15s was not costing anything while the upstream was healthy, because
 * healthy requests finish in well under a second. It cost everything on 13
 * August, when roughly half of every batch failed: a failing request waits the
 * full timeout, waves run one after another, and a 1,867-wallet batch is 19
 * waves. That is where the 229s median for that day came from, and 60% of it
 * was this constant.
 */
export const API_TIMEOUT_MS = 6000;

/**
 * How long a whole batch may take before it gives up and returns what it has.
 *
 * A budget per wave rather than a flat number, because a batch is
 * `ceil(n / MAX_CONCURRENT)` waves run in series and a legitimate 3,000-wallet
 * batch cannot be held to the same clock as a 200-wallet one.
 *
 * Four seconds a wave against a measured worst healthy wave of 2.79s. For the
 * largest batch seen (2,999 wallets, 30 waves) that is a 120s ceiling over an
 * 83.7s worst case, and it would have cut 13 August's median from 229s to 120s.
 * The floor exists so a handful of wallets is never cut off by arithmetic.
 */
const WAVE_BUDGET_MS = 4000;
export const MIN_BATCH_DEADLINE_MS = 30_000;

export function batchDeadlineMs(walletCount: number): number {
  const waves = Math.ceil(Math.max(0, walletCount) / MAX_CONCURRENT);
  return MIN_BATCH_DEADLINE_MS;
}

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
  walletOrEns: string,
  opts?: {
    /**
     * Called when the request failed (timeout, 429, 5xx) rather than the
     * profile genuinely not existing (404). Both return null, so without this
     * signal callers can't tell "no profile" from "check never completed".
     */
    onFailure?: () => void;
  }
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
      console.error(
        `Error fetching Web3.bio profile for ${walletOrEns}:`,
        error
      );
    }
    opts?.onFailure?.();
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
  jobId?: string,
  opts?: {
    /** Populated with wallets whose fetch failed rather than 404'd. */
    failedWallets?: Set<string>;
  }
): Promise<Map<string, Web3BioResult>> {
  const results = new Map<string, Web3BioResult>();
  let processed = 0;
  let found = 0;
  const startTime = Date.now();
  let errorCount = 0;
  const deadline = startTime + batchDeadlineMs(wallets.length);
  let abandonedAt: number | null = null;

  // Process in batches with rate limiting
  for (let i = 0; i < wallets.length; i += MAX_CONCURRENT) {
    /**
     * Stop starting waves once the budget is spent.
     *
     * Checked between waves rather than inside one: a wave already in flight is
     * bounded by API_TIMEOUT_MS and abandoning it would throw away answers
     * already paid for.
     *
     * Every wallet not reached is recorded as failed, which is the part that
     * matters beyond speed. The pipeline persists a negative only when the full
     * run completed without API failures, so a wallet this gives up on must
     * look like "not checked" and not like "checked, has nothing". Dropping it
     * silently would write a false negative that the graph trusts for 30 days.
     */
    if (Date.now() >= deadline) {
      abandonedAt = i;
      for (const wallet of wallets.slice(i)) {
        errorCount++;
        opts?.failedWallets?.add(wallet.toLowerCase());
      }
      break;
    }

    const batch = wallets.slice(i, i + MAX_CONCURRENT);

    const batchPromises = batch.map(async (wallet) => {
      const profiles = await fetchWeb3BioProfile(wallet, {
        onFailure: () => {
          errorCount++;
          opts?.failedWallets?.add(wallet.toLowerCase());
        },
      });
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
  /**
   * A batch that ran out of time says so.
   *
   * "1,023 requests failed" and "gave up after 120s with 1,023 unreached" are
   * different events with the same count, and only one of them is a decision
   * this code made. Reading a truncated batch as an upstream failure is how a
   * deliberate ceiling turns into a phantom outage on the dashboard.
   */
  trackApiCall('web3bio', {
    latencyMs,
    statusCode: errorCount > 0 ? 500 : 200,
    errorMessage:
      abandonedAt !== null
        ? `deadline: stopped at ${abandonedAt} of ${wallets.length} after ${latencyMs}ms`
        : errorCount > 0
          ? `${errorCount} requests failed`
          : undefined,
    walletCount: wallets.length,
    jobId,
  });

  return results;
}
