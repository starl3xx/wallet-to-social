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
import type { LookupJob } from '@/db/schema';

// Process up to this many wallets per cron invocation
const CHUNK_SIZE = 3000; // Increased from 2000 for faster throughput

export interface JobOptions {
  includeENS?: boolean;
  saveToHistory?: boolean;
  historyName?: string;
  userId?: string;
}

export interface ProcessResult {
  completed: boolean;
  processedCount: number;
  twitterFound: number;
  farcasterFound: number;
  cacheHits: number;
  error?: string;
}

/**
 * Process a chunk of wallets for a job.
 * Called by the cron worker - processes up to CHUNK_SIZE wallets and saves progress.
 */
export async function processJobChunk(jobId: string): Promise<ProcessResult> {
  const db = getDb();
  if (!db) {
    return { completed: true, processedCount: 0, twitterFound: 0, farcasterFound: 0, cacheHits: 0, error: 'Database not configured' };
  }

  // Load job from DB
  const [job] = await db
    .select()
    .from(lookupJobs)
    .where(eq(lookupJobs.id, jobId))
    .limit(1);

  if (!job) {
    return { completed: true, processedCount: 0, twitterFound: 0, farcasterFound: 0, cacheHits: 0, error: 'Job not found' };
  }

  if (job.status === 'completed' || job.status === 'failed') {
    return { completed: true, processedCount: job.processedCount, twitterFound: job.twitterFound, farcasterFound: job.farcasterFound, cacheHits: job.cacheHits };
  }

  // Mark as processing
  await db
    .update(lookupJobs)
    .set({
      status: 'processing',
      startedAt: job.startedAt || new Date(),
      updatedAt: new Date(),
    })
    .where(eq(lookupJobs.id, jobId));

  try {
    const options = job.options as JobOptions;
    const originalData = (job.originalData || {}) as Record<string, Record<string, string>>;
    const allWallets = job.wallets;
    const startIndex = job.processedCount;

    // Get chunk to process
    const walletsToProcess = allWallets.slice(startIndex, startIndex + CHUNK_SIZE);

    if (walletsToProcess.length === 0) {
      // All done - finalize job
      return await finalizeJob(db, job);
    }

    // Initialize or load partial results
    const results = new Map<string, WalletSocialResult>();
    const partialResults = (job.partialResults || []) as WalletSocialResult[];
    for (const r of partialResults) {
      results.set(r.wallet, r);
    }

    // Detect holdings column
    const firstWallet = walletsToProcess[0]?.toLowerCase();
    const firstData = originalData[firstWallet] || {};
    const dataColumns = Object.keys(firstData);
    const holdingsColumn = findHoldingsColumn(dataColumns);

    // Initialize results for this chunk
    for (const wallet of walletsToProcess) {
      const walletLower = wallet.toLowerCase();
      if (!results.has(walletLower)) {
        const walletData = originalData[walletLower] || {};

        let holdings: number | undefined;
        if (holdingsColumn && walletData[holdingsColumn]) {
          holdings = parseHoldingsValue(walletData[holdingsColumn]) ?? undefined;
        }

        results.set(walletLower, {
          wallet: walletLower,
          source: [],
          holdings,
          ...walletData,
        });
      }
    }

    const neynarApiKey = process.env.NEYNAR_API_KEY;
    let cacheHits = job.cacheHits;
    let uncachedWallets = walletsToProcess;

    // Update stage
    await updateJobStage(db, jobId, 'cache');

    // Check cache
    try {
      const cached = await getCachedWallets(walletsToProcess);
      cacheHits += cached.size;

      for (const [wallet, data] of cached) {
        const existing = results.get(wallet)!;
        results.set(wallet, {
          ...existing,
          ...data,
          source: [...data.source, 'cache'],
        });
      }

      uncachedWallets = walletsToProcess.filter(
        (w) => !cached.has(w.toLowerCase())
      );
    } catch (error) {
      console.error('Cache error:', error);
    }

    if (uncachedWallets.length > 0) {
      // ENS lookups (optional)
      if (options.includeENS) {
        await updateJobStage(db, jobId, 'ens');
        try {
          const ensResults = await batchLookupENS(uncachedWallets);

          for (const [wallet, data] of ensResults) {
            const existing = results.get(wallet)!;
            results.set(wallet, {
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

      // Web3.bio + Neynar lookups in parallel
      await updateJobStage(db, jobId, 'web3bio+neynar');

      const [web3BioResults, neynarResults] = await Promise.all([
        batchFetchWeb3Bio(uncachedWallets),
        neynarApiKey
          ? batchFetchNeynar(uncachedWallets, neynarApiKey).catch((error) => {
              console.error('Neynar fetch error:', error);
              return new Map<string, NeynarResult>();
            })
          : Promise.resolve(new Map<string, NeynarResult>()),
      ]);

      // Apply Web3.bio results
      for (const [wallet, data] of web3BioResults) {
        const existing = results.get(wallet)!;
        results.set(wallet, {
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

      // Apply Neynar results (if available)
      for (const [wallet, data] of neynarResults) {
        const existing = results.get(wallet)!;
        results.set(wallet, {
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

      // Cache newly fetched results
      try {
        const newResults = uncachedWallets
          .map((w) => results.get(w.toLowerCase())!)
          .filter((r) => r.source.length > 0 && !r.source.includes('cache'));

        if (newResults.length > 0) {
          await cacheWalletResults(newResults);
        }
      } catch (error) {
        console.error('Cache write error:', error);
      }
    }

    // Enrich from social graph
    try {
      const graphData = await getSocialGraphData(walletsToProcess);

      for (const [wallet, result] of results) {
        const stored = graphData.get(wallet);
        if (stored) {
          const storedData = socialGraphToResult(stored);

          if (!result.ens_name && storedData.ens_name) {
            result.ens_name = storedData.ens_name;
          }
          if (!result.twitter_handle && storedData.twitter_handle) {
            result.twitter_handle = storedData.twitter_handle;
            result.twitter_url = storedData.twitter_url;
          }
          if (!result.farcaster && storedData.farcaster) {
            result.farcaster = storedData.farcaster;
            result.farcaster_url = storedData.farcaster_url;
            result.fc_followers = storedData.fc_followers;
          }
          if (!result.lens && storedData.lens) {
            result.lens = storedData.lens;
          }
          if (!result.github && storedData.github) {
            result.github = storedData.github;
          }

          results.set(wallet, result);
        }
      }
    } catch (error) {
      console.error('Social graph enrichment error:', error);
    }

    // Calculate priority scores
    for (const [wallet, result] of results) {
      result.priority_score = calculatePriorityScore(
        result.holdings,
        result.fc_followers
      );
      results.set(wallet, result);
    }

    // Calculate stats for this chunk
    const chunkResults = walletsToProcess.map((w) => results.get(w.toLowerCase())!);
    const twitterFound = job.twitterFound + chunkResults.filter((r) => r.twitter_handle).length;
    const farcasterFound = job.farcasterFound + chunkResults.filter((r) => r.farcaster).length;

    const newProcessedCount = startIndex + walletsToProcess.length;
    const allResults = Array.from(results.values());

    // Check if job is complete
    const isComplete = newProcessedCount >= allWallets.length;

    if (isComplete) {
      // Finalize: save to history and social graph
      await finalizeJobWithResults(db, job, allResults, twitterFound, farcasterFound, cacheHits);
      return {
        completed: true,
        processedCount: newProcessedCount,
        twitterFound,
        farcasterFound,
        cacheHits,
      };
    }

    // Save progress for resume
    await db
      .update(lookupJobs)
      .set({
        processedCount: newProcessedCount,
        partialResults: allResults,
        twitterFound,
        farcasterFound,
        cacheHits,
        updatedAt: new Date(),
      })
      .where(eq(lookupJobs.id, jobId));

    return {
      completed: false,
      processedCount: newProcessedCount,
      twitterFound,
      farcasterFound,
      cacheHits,
    };
  } catch (error) {
    console.error('Job processing error:', error);

    // Mark job as failed
    await db
      .update(lookupJobs)
      .set({
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        retryCount: job.retryCount + 1,
        updatedAt: new Date(),
      })
      .where(eq(lookupJobs.id, jobId));

    return {
      completed: true,
      processedCount: job.processedCount,
      twitterFound: job.twitterFound,
      farcasterFound: job.farcasterFound,
      cacheHits: job.cacheHits,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function updateJobStage(db: any, jobId: string, stage: string) {
  await db
    .update(lookupJobs)
    .set({ currentStage: stage, updatedAt: new Date() })
    .where(eq(lookupJobs.id, jobId));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function finalizeJob(db: any, job: LookupJob): Promise<ProcessResult> {
  const results = (job.partialResults || []) as WalletSocialResult[];
  return finalizeJobWithResults(
    db,
    job,
    results,
    job.twitterFound,
    job.farcasterFound,
    job.cacheHits
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function finalizeJobWithResults(
  db: any,
  job: LookupJob,
  results: WalletSocialResult[],
  twitterFound: number,
  farcasterFound: number,
  cacheHits: number
): Promise<ProcessResult> {
  const options = job.options as JobOptions;

  // Save to history if requested
  if (options.saveToHistory) {
    try {
      await saveLookup(results, options.historyName, options.userId || job.userId || undefined);
    } catch (error) {
      console.error('History save error:', error);
    }
  }

  // Persist positive results to social graph
  try {
    const positiveResults = results.filter(
      (r) =>
        r.twitter_handle ||
        r.farcaster ||
        r.lens ||
        r.github ||
        r.ens_name
    );

    if (positiveResults.length > 0) {
      await upsertSocialGraph(positiveResults);
    }
  } catch (error) {
    console.error('Social graph persist error:', error);
  }

  // Mark job as complete
  await db
    .update(lookupJobs)
    .set({
      status: 'completed',
      processedCount: job.wallets.length,
      partialResults: results,
      twitterFound,
      farcasterFound,
      cacheHits,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(lookupJobs.id, job.id));

  return {
    completed: true,
    processedCount: job.wallets.length,
    twitterFound,
    farcasterFound,
    cacheHits,
  };
}

/**
 * Create a new lookup job
 */
export async function createJob(
  wallets: string[],
  originalData: Record<string, Record<string, string>>,
  options: JobOptions
): Promise<string> {
  const db = getDb();
  if (!db) {
    throw new Error('Database not configured');
  }

  const [job] = await db
    .insert(lookupJobs)
    .values({
      wallets,
      originalData,
      options,
      userId: options.userId,
    })
    .returning({ id: lookupJobs.id });

  return job.id;
}

/**
 * Get job by ID
 */
export async function getJob(jobId: string): Promise<LookupJob | null> {
  const db = getDb();
  if (!db) {
    return null;
  }

  const [job] = await db
    .select()
    .from(lookupJobs)
    .where(eq(lookupJobs.id, jobId))
    .limit(1);

  return job || null;
}

/**
 * Get the next pending job to process
 */
export async function getNextPendingJob(): Promise<LookupJob | null> {
  const db = getDb();
  if (!db) {
    return null;
  }

  const [job] = await db
    .select()
    .from(lookupJobs)
    .where(eq(lookupJobs.status, 'pending'))
    .orderBy(lookupJobs.createdAt)
    .limit(1);

  if (job) return job;

  // Also check for processing jobs (in case previous worker died)
  const [processingJob] = await db
    .select()
    .from(lookupJobs)
    .where(eq(lookupJobs.status, 'processing'))
    .orderBy(lookupJobs.createdAt)
    .limit(1);

  return processingJob || null;
}
