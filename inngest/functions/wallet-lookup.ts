import { inngest } from '../client';
import { getDb } from '@/db';
import { lookupJobs } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { batchFetchWeb3Bio } from '@/lib/web3bio';
import { batchFetchNeynar, type NeynarResult } from '@/lib/neynar';
import { batchLookupENS } from '@/lib/ens';
import { getCachedWallets, cacheWalletResults } from '@/lib/cache';
import { saveLookup } from '@/lib/history';
import {
  upsertSocialGraph,
  getSocialGraphData,
  socialGraphToResult,
} from '@/lib/social-graph';
import {
  findHoldingsColumn,
  parseHoldingsValue,
  calculatePriorityScore,
} from '@/lib/csv-parser';
import type { WalletSocialResult } from '@/lib/types';

// Process wallets in micro-batches for parallel execution
const MICRO_BATCH_SIZE = 500;

interface JobOptions {
  includeENS?: boolean;
  saveToHistory?: boolean;
  historyName?: string;
}

// Define the event type
type WalletLookupEvent = {
  name: 'wallet/lookup.requested';
  data: {
    jobId: string;
  };
};

/**
 * Inngest function for processing wallet lookups.
 * Uses step functions for durable, retriable execution.
 */
export const walletLookup = inngest.createFunction(
  {
    id: 'wallet-lookup',
    // Allow multiple jobs to run concurrently
    concurrency: {
      limit: 10,
    },
    // Retry on failure
    retries: 3,
  },
  { event: 'wallet/lookup.requested' },
  async ({ event, step }) => {
    const { jobId } = event.data;

    // Step 1: Load job from database
    const job = await step.run('load-job', async () => {
      const db = getDb();
      if (!db) throw new Error('Database not configured');

      const [jobData] = await db
        .select()
        .from(lookupJobs)
        .where(eq(lookupJobs.id, jobId))
        .limit(1);

      if (!jobData) throw new Error('Job not found');
      if (jobData.status === 'completed' || jobData.status === 'failed') {
        return null; // Already processed
      }

      // Mark as processing
      await db
        .update(lookupJobs)
        .set({ status: 'processing', startedAt: new Date(), updatedAt: new Date() })
        .where(eq(lookupJobs.id, jobId));

      return jobData;
    });

    if (!job) {
      return { status: 'already_completed' };
    }

    const options = job.options as JobOptions;
    const originalData = (job.originalData || {}) as Record<string, Record<string, string>>;
    const allWallets = job.wallets;

    // Step 2: Initialize results map and detect holdings column
    const { results, holdingsColumn } = await step.run('init-results', async () => {
      const resultsMap = new Map<string, WalletSocialResult>();

      // Load any partial results
      const partialResults = (job.partialResults || []) as WalletSocialResult[];
      for (const r of partialResults) {
        resultsMap.set(r.wallet, r);
      }

      // Detect holdings column
      const firstWallet = allWallets[0]?.toLowerCase();
      const firstData = originalData[firstWallet] || {};
      const dataColumns = Object.keys(firstData);
      const holdingsCol = findHoldingsColumn(dataColumns);

      // Initialize results for all wallets
      for (const wallet of allWallets) {
        const walletLower = wallet.toLowerCase();
        if (!resultsMap.has(walletLower)) {
          const walletData = originalData[walletLower] || {};
          let holdings: number | undefined;
          if (holdingsCol && walletData[holdingsCol]) {
            holdings = parseHoldingsValue(walletData[holdingsCol]) ?? undefined;
          }
          resultsMap.set(walletLower, {
            wallet: walletLower,
            source: [],
            holdings,
            ...walletData,
          });
        }
      }

      // Convert to array for serialization
      return {
        results: Array.from(resultsMap.entries()),
        holdingsColumn: holdingsCol,
      };
    });

    // Convert results back to Map
    let resultsMap = new Map<string, WalletSocialResult>(results);

    // Step 3: Check cache
    const { cachedCount, uncachedWallets } = await step.run('check-cache', async () => {
      let cached = new Map<string, WalletSocialResult>();
      try {
        cached = await getCachedWallets(allWallets);
      } catch (error) {
        console.error('Cache error:', error);
      }

      // Apply cached results
      for (const [wallet, data] of cached) {
        const existing = resultsMap.get(wallet)!;
        resultsMap.set(wallet, {
          ...existing,
          ...data,
          source: [...data.source, 'cache'],
        });
      }

      const uncached = allWallets.filter((w) => !cached.has(w.toLowerCase()));
      return {
        cachedCount: cached.size,
        uncachedWallets: uncached,
        // Update results with cache hits
        updatedResults: Array.from(resultsMap.entries()),
      };
    });

    // Update results map with cache hits
    resultsMap = new Map(uncachedWallets.length > 0 ? results : []);
    // Re-apply cache step results
    const cacheStepResults = await step.run('apply-cache-results', async () => {
      // This is a workaround for serialization - reload from step result
      return { cachedCount, uncachedWallets };
    });

    // Update progress in DB
    await step.run('update-progress-cache', async () => {
      const db = getDb();
      if (!db) return;
      await db
        .update(lookupJobs)
        .set({
          cacheHits: cachedCount,
          currentStage: 'cache',
          updatedAt: new Date(),
        })
        .where(eq(lookupJobs.id, jobId));
    });

    // Step 4: Process uncached wallets in micro-batches
    if (uncachedWallets.length > 0) {
      // Split into micro-batches
      const batches: string[][] = [];
      for (let i = 0; i < uncachedWallets.length; i += MICRO_BATCH_SIZE) {
        batches.push(uncachedWallets.slice(i, i + MICRO_BATCH_SIZE));
      }

      // Process each micro-batch as a separate step
      let twitterFound = 0;
      let farcasterFound = 0;

      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex];

        const batchResults = await step.run(`process-batch-${batchIndex}`, async () => {
          const batchResultsMap = new Map<string, WalletSocialResult>();
          const neynarApiKey = process.env.NEYNAR_API_KEY;

          // Initialize batch results
          for (const wallet of batch) {
            const walletLower = wallet.toLowerCase();
            const walletData = originalData[walletLower] || {};
            let holdings: number | undefined;
            if (holdingsColumn && walletData[holdingsColumn]) {
              holdings = parseHoldingsValue(walletData[holdingsColumn]) ?? undefined;
            }
            batchResultsMap.set(walletLower, {
              wallet: walletLower,
              source: [],
              holdings,
              ...walletData,
            });
          }

          // Optional ENS lookups
          if (options.includeENS) {
            try {
              const ensResults = await batchLookupENS(batch);
              for (const [wallet, data] of ensResults) {
                const existing = batchResultsMap.get(wallet)!;
                batchResultsMap.set(wallet, {
                  ...existing,
                  ens_name: data.ensName || existing.ens_name,
                  twitter_handle: data.twitter || existing.twitter_handle,
                  twitter_url: data.twitterUrl || existing.twitter_url,
                  github: data.github || existing.github,
                  source: [...existing.source, 'ens'],
                });
              }
            } catch (error) {
              console.error('ENS lookup error:', error);
            }
          }

          // Web3.bio + Neynar in parallel
          const [web3BioResults, neynarResults] = await Promise.all([
            batchFetchWeb3Bio(batch),
            neynarApiKey
              ? batchFetchNeynar(batch, neynarApiKey).catch((error) => {
                  console.error('Neynar fetch error:', error);
                  return new Map<string, NeynarResult>();
                })
              : Promise.resolve(new Map<string, NeynarResult>()),
          ]);

          // Apply Web3.bio results
          for (const [wallet, data] of web3BioResults) {
            const existing = batchResultsMap.get(wallet)!;
            batchResultsMap.set(wallet, {
              ...existing,
              ens_name: existing.ens_name || data.ens_name,
              twitter_handle: existing.twitter_handle || data.twitter_handle,
              twitter_url: existing.twitter_url || data.twitter_url,
              farcaster: data.farcaster || existing.farcaster,
              farcaster_url: data.farcaster_url || existing.farcaster_url,
              lens: data.lens || existing.lens,
              github: existing.github || data.github,
              source: existing.source.includes('web3bio')
                ? existing.source
                : [...existing.source, 'web3bio'],
            });
          }

          // Apply Neynar results
          for (const [wallet, data] of neynarResults) {
            const existing = batchResultsMap.get(wallet)!;
            batchResultsMap.set(wallet, {
              ...existing,
              twitter_handle: existing.twitter_handle || data.twitter_handle,
              twitter_url: existing.twitter_url || data.twitter_url,
              farcaster: data.farcaster || existing.farcaster,
              farcaster_url: data.farcaster_url || existing.farcaster_url,
              fc_followers: data.fc_followers,
              source: existing.source.includes('neynar')
                ? existing.source
                : [...existing.source, 'neynar'],
            });
          }

          // Cache results
          try {
            const newResults = batch
              .map((w) => batchResultsMap.get(w.toLowerCase())!)
              .filter((r) => r.source.length > 0);
            if (newResults.length > 0) {
              await cacheWalletResults(newResults);
            }
          } catch (error) {
            console.error('Cache write error:', error);
          }

          // Count findings
          let batchTwitter = 0;
          let batchFarcaster = 0;
          for (const result of batchResultsMap.values()) {
            if (result.twitter_handle) batchTwitter++;
            if (result.farcaster) batchFarcaster++;
          }

          return {
            results: Array.from(batchResultsMap.entries()),
            twitterFound: batchTwitter,
            farcasterFound: batchFarcaster,
          };
        });

        // Merge batch results into main results map
        for (const [wallet, result] of batchResults.results) {
          resultsMap.set(wallet, result);
        }
        twitterFound += batchResults.twitterFound;
        farcasterFound += batchResults.farcasterFound;

        // Update progress
        await step.run(`update-progress-${batchIndex}`, async () => {
          const db = getDb();
          if (!db) return;
          const processedCount = (batchIndex + 1) * MICRO_BATCH_SIZE;
          await db
            .update(lookupJobs)
            .set({
              processedCount: Math.min(processedCount + cachedCount, allWallets.length),
              twitterFound,
              farcasterFound,
              currentStage: 'processing',
              updatedAt: new Date(),
            })
            .where(eq(lookupJobs.id, jobId));
        });
      }
    }

    // Step 5: Enrich from social graph
    await step.run('enrich-social-graph', async () => {
      try {
        const graphData = await getSocialGraphData(allWallets);
        for (const [wallet, result] of resultsMap) {
          const stored = graphData.get(wallet);
          if (stored) {
            const storedData = socialGraphToResult(stored);
            if (!result.ens_name && storedData.ens_name) result.ens_name = storedData.ens_name;
            if (!result.twitter_handle && storedData.twitter_handle) {
              result.twitter_handle = storedData.twitter_handle;
              result.twitter_url = storedData.twitter_url;
            }
            if (!result.farcaster && storedData.farcaster) {
              result.farcaster = storedData.farcaster;
              result.farcaster_url = storedData.farcaster_url;
              result.fc_followers = storedData.fc_followers;
            }
            if (!result.lens && storedData.lens) result.lens = storedData.lens;
            if (!result.github && storedData.github) result.github = storedData.github;
            resultsMap.set(wallet, result);
          }
        }
      } catch (error) {
        console.error('Social graph enrichment error:', error);
      }
    });

    // Step 6: Calculate priority scores
    await step.run('calculate-scores', async () => {
      for (const [wallet, result] of resultsMap) {
        result.priority_score = calculatePriorityScore(result.holdings, result.fc_followers);
        resultsMap.set(wallet, result);
      }
    });

    // Step 7: Finalize job
    await step.run('finalize', async () => {
      const db = getDb();
      if (!db) return;

      const allResults = Array.from(resultsMap.values());

      // Save to history if requested
      if (options.saveToHistory) {
        try {
          await saveLookup(allResults, options.historyName);
        } catch (error) {
          console.error('History save error:', error);
        }
      }

      // Persist positive results to social graph
      try {
        const positiveResults = allResults.filter(
          (r) => r.twitter_handle || r.farcaster || r.lens || r.github || r.ens_name
        );
        if (positiveResults.length > 0) {
          await upsertSocialGraph(positiveResults);
        }
      } catch (error) {
        console.error('Social graph persist error:', error);
      }

      // Count final stats
      let twitterFound = 0;
      let farcasterFound = 0;
      for (const result of allResults) {
        if (result.twitter_handle) twitterFound++;
        if (result.farcaster) farcasterFound++;
      }

      // Mark job as complete
      await db
        .update(lookupJobs)
        .set({
          status: 'completed',
          processedCount: allWallets.length,
          partialResults: allResults,
          twitterFound,
          farcasterFound,
          cacheHits: cachedCount,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(lookupJobs.id, jobId));
    });

    return {
      status: 'completed',
      jobId,
      walletCount: allWallets.length,
    };
  }
);
