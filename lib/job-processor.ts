import { getDb } from '@/db';
import { lookupJobs } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { batchFetchWeb3Bio } from '@/lib/web3bio';
import { batchFetchNeynar, type NeynarResult } from '@/lib/neynar';
import { batchLookupENS } from '@/lib/ens';
import { getCachedWallets, cacheWalletResults } from '@/lib/cache';
import { saveLookup, type InputSource } from '@/lib/history';
import {
  upsertSocialGraphWithRetry,
  getSocialGraphWithQuality,
  socialGraphToResult,
  type SocialGraphQualityResult,
} from '@/lib/social-graph';
import {
  findHoldingsColumn,
  parseHoldingsValue,
  calculatePriorityScore,
} from '@/lib/csv-parser';
import { trackEvent } from '@/lib/analytics';
import type { WalletSocialResult } from '@/lib/types';
import type { LookupJob } from '@/db/schema';

// Process up to this many wallets per cron invocation
const CHUNK_SIZE = 3000; // Increased from 2000 for faster throughput

export interface JobOptions {
  includeENS?: boolean;
  saveToHistory?: boolean;
  historyName?: string;
  userId?: string;
  tier?: 'free' | 'starter' | 'pro' | 'unlimited';
  canUseNeynar?: boolean;
  canUseENS?: boolean;
  inputSource?: InputSource;
}

export interface ProcessResult {
  completed: boolean;
  processedCount: number;
  twitterFound: number;
  farcasterFound: number;
  anySocialFound: number;
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
    return { completed: true, processedCount: 0, twitterFound: 0, farcasterFound: 0, anySocialFound: 0, cacheHits: 0, error: 'Database not configured' };
  }

  // Load job from DB
  const [job] = await db
    .select()
    .from(lookupJobs)
    .where(eq(lookupJobs.id, jobId))
    .limit(1);

  if (!job) {
    return { completed: true, processedCount: 0, twitterFound: 0, farcasterFound: 0, anySocialFound: 0, cacheHits: 0, error: 'Job not found' };
  }

  if (job.status === 'completed' || job.status === 'failed') {
    return { completed: true, processedCount: job.processedCount, twitterFound: job.twitterFound, farcasterFound: job.farcasterFound, anySocialFound: job.anySocialFound, cacheHits: job.cacheHits };
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
    let graphHits = 0;
    let uncachedWallets = walletsToProcess;

    // =========================================================================
    // STEP 1: Check social_graph FIRST (primary data source)
    // High-quality records are trusted completely, reducing API calls
    // =========================================================================
    await updateJobStage(db, jobId, 'graph');

    const walletsNeedingLookup: string[] = [];
    try {
      const graphResults = await getSocialGraphWithQuality(walletsToProcess);

      for (const [wallet, graphResult] of graphResults) {
        const existing = results.get(wallet)!;

        if (graphResult.quality === 'high' && graphResult.data && !graphResult.needsRefresh) {
          // Trust high-quality data completely - skip all API calls for this wallet
          const storedData = socialGraphToResult(graphResult.data);
          results.set(wallet, {
            ...existing,
            ens_name: storedData.ens_name || existing.ens_name,
            twitter_handle: storedData.twitter_handle || existing.twitter_handle,
            twitter_url: storedData.twitter_url || existing.twitter_url,
            farcaster: storedData.farcaster || existing.farcaster,
            farcaster_url: storedData.farcaster_url || existing.farcaster_url,
            fc_followers: storedData.fc_followers || existing.fc_followers,
            lens: storedData.lens || existing.lens,
            github: storedData.github || existing.github,
            source: [...existing.source, 'graph'],
          });
          graphHits++;
        } else if (graphResult.quality === 'medium' && graphResult.data) {
          // Medium quality: use as base but still consider API refresh
          const storedData = socialGraphToResult(graphResult.data);
          results.set(wallet, {
            ...existing,
            ens_name: storedData.ens_name || existing.ens_name,
            twitter_handle: storedData.twitter_handle || existing.twitter_handle,
            twitter_url: storedData.twitter_url || existing.twitter_url,
            farcaster: storedData.farcaster || existing.farcaster,
            farcaster_url: storedData.farcaster_url || existing.farcaster_url,
            fc_followers: storedData.fc_followers || existing.fc_followers,
            lens: storedData.lens || existing.lens,
            github: storedData.github || existing.github,
            source: [...existing.source, 'graph'],
          });
          // Medium quality still needs lookup to potentially refresh data
          walletsNeedingLookup.push(wallet);
        } else {
          // Low, stale, or missing - needs full lookup
          walletsNeedingLookup.push(wallet);
        }
      }
    } catch (error) {
      console.error('Social graph lookup error:', error);
      // On error, fall back to looking up all wallets
      walletsNeedingLookup.push(...walletsToProcess);
    }

    // Track social graph hit rate for this chunk
    if (graphHits > 0) {
      trackEvent('social_graph_hit', {
        userId: options.userId || job.userId || undefined,
        metadata: {
          jobId: job.id,
          hitCount: graphHits,
          totalWallets: walletsToProcess.length,
          hitRate: Math.round((graphHits / walletsToProcess.length) * 100),
        },
      });
    }

    const misses = walletsNeedingLookup.length;
    if (misses > 0) {
      trackEvent('social_graph_miss', {
        userId: options.userId || job.userId || undefined,
        metadata: {
          jobId: job.id,
          missCount: misses,
          totalWallets: walletsToProcess.length,
        },
      });
    }

    // =========================================================================
    // STEP 2: Check cache for wallets that need lookup
    // =========================================================================
    await updateJobStage(db, jobId, 'cache');

    // Check cache for wallets not served by high-quality graph data
    try {
      const cached = await getCachedWallets(walletsNeedingLookup);
      cacheHits += cached.size;

      for (const [wallet, data] of cached) {
        const existing = results.get(wallet)!;
        results.set(wallet, {
          ...existing,
          ...data,
          source: [...existing.source, 'cache'],
        });
      }

      uncachedWallets = walletsNeedingLookup.filter(
        (w) => !cached.has(w.toLowerCase())
      );
    } catch (error) {
      console.error('Cache error:', error);
      uncachedWallets = walletsNeedingLookup;
    }

    // =========================================================================
    // STEP 3: Call external APIs for remaining uncached wallets
    // =========================================================================
    if (uncachedWallets.length > 0) {
      // ENS lookups (optional, requires paid tier)
      if (options.includeENS && options.canUseENS !== false) {
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

      // Neynar first (fast batch API), then Web3Bio only for wallets without Twitter
      // This optimization reduces Web3Bio calls by 30-60% since Neynar returns verified Twitter
      const canUseNeynar = neynarApiKey && options.canUseNeynar !== false;

      // Step 1: Run Neynar (fast - batch API handles 200 wallets per request)
      let neynarResults = new Map<string, NeynarResult>();
      if (canUseNeynar) {
        await updateJobStage(db, jobId, 'neynar');
        try {
          neynarResults = await batchFetchNeynar(uncachedWallets, neynarApiKey);
        } catch (error) {
          console.error('Neynar fetch error:', error);
        }

        // Apply Neynar results immediately
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
      }

      // Step 2: Filter wallets that still need Twitter lookup
      // Skip Web3Bio for wallets that already have Twitter from cache, ENS, or Neynar
      const walletsNeedingWeb3Bio = uncachedWallets.filter((wallet) => {
        const existing = results.get(wallet.toLowerCase());
        // Only call Web3Bio if we don't have Twitter yet
        return !existing?.twitter_handle;
      });

      // Step 3: Run Web3Bio only for wallets without Twitter (slow - 1 request per wallet)
      if (walletsNeedingWeb3Bio.length > 0) {
        await updateJobStage(db, jobId, 'web3bio');
        const web3BioResults = await batchFetchWeb3Bio(walletsNeedingWeb3Bio);

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

    // Social graph enrichment is now done FIRST (see STEP 1 above)
    // This ensures we use high-quality cached data before calling external APIs

    // Calculate priority scores (paid tiers only)
    const isPaidTier = options.tier === 'starter' || options.tier === 'pro' || options.tier === 'unlimited';
    for (const [wallet, result] of results) {
      if (!isPaidTier) {
        // Free tier doesn't get premium data
        result.priority_score = undefined;
        result.fc_followers = undefined;
      } else {
        result.priority_score = calculatePriorityScore(
          result.holdings,
          result.fc_followers
        );
      }
      results.set(wallet, result);
    }

    // Calculate stats for this chunk
    const chunkResults = walletsToProcess.map((w) => results.get(w.toLowerCase())!);
    const twitterFound = job.twitterFound + chunkResults.filter((r) => r.twitter_handle).length;
    const farcasterFound = job.farcasterFound + chunkResults.filter((r) => r.farcaster).length;
    const anySocialFound = job.anySocialFound + chunkResults.filter((r) => r.twitter_handle || r.farcaster).length;

    const newProcessedCount = startIndex + walletsToProcess.length;
    const allResults = Array.from(results.values());

    // Check if job is complete
    const isComplete = newProcessedCount >= allWallets.length;

    if (isComplete) {
      // Finalize: save to history and social graph
      await finalizeJobWithResults(db, job, allResults, twitterFound, farcasterFound, anySocialFound, cacheHits);
      return {
        completed: true,
        processedCount: newProcessedCount,
        twitterFound,
        farcasterFound,
        anySocialFound,
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
        anySocialFound,
        cacheHits,
        updatedAt: new Date(),
      })
      .where(eq(lookupJobs.id, jobId));

    return {
      completed: false,
      processedCount: newProcessedCount,
      twitterFound,
      farcasterFound,
      anySocialFound,
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
      anySocialFound: job.anySocialFound,
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
    job.anySocialFound,
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
  anySocialFound: number,
  cacheHits: number
): Promise<ProcessResult> {
  const options = job.options as JobOptions;

  // Save to history if requested
  if (options.saveToHistory) {
    try {
      await saveLookup(
        results,
        options.historyName,
        options.userId || job.userId || undefined,
        options.inputSource
      );
    } catch (error) {
      console.error('History save error:', error);
    }
  }

  // Persist positive results to social graph with retry logic
  let socialGraphWriteStatus: 'success' | 'partial' | 'failed' | null = null;
  let socialGraphWriteErrors: string[] = [];

  const positiveResults = results.filter(
    (r) =>
      r.twitter_handle ||
      r.farcaster ||
      r.lens ||
      r.github ||
      r.ens_name
  );

  if (positiveResults.length > 0) {
    const writeResult = await upsertSocialGraphWithRetry(positiveResults);

    // Determine write status
    if (writeResult.failed === 0) {
      socialGraphWriteStatus = 'success';
      console.log(`Social graph: persisted ${writeResult.succeeded} of ${positiveResults.length} wallets`);
    } else if (writeResult.succeeded > 0) {
      socialGraphWriteStatus = 'partial';
      socialGraphWriteErrors = writeResult.errors;
      console.warn(`Social graph: partial write - ${writeResult.succeeded} succeeded, ${writeResult.failed} failed`);
    } else {
      socialGraphWriteStatus = 'failed';
      socialGraphWriteErrors = writeResult.errors;
      console.error('CRITICAL: Social graph persist completely failed:', writeResult.errors);
    }

    // Track write failures in analytics
    if (writeResult.failed > 0) {
      trackEvent('lookup_completed', {
        userId: options.userId || job.userId || undefined,
        metadata: {
          jobId: job.id,
          eventSubtype: 'social_graph_write_failed',
          failed: writeResult.failed,
          succeeded: writeResult.succeeded,
          errors: writeResult.errors,
        },
      });
    }
  }

  // Mark job as complete with write status
  const completedAt = new Date();
  await db
    .update(lookupJobs)
    .set({
      status: 'completed',
      processedCount: job.wallets.length,
      partialResults: results,
      twitterFound,
      farcasterFound,
      anySocialFound,
      cacheHits,
      completedAt,
      updatedAt: new Date(),
      socialGraphWriteStatus,
      socialGraphWriteErrors: socialGraphWriteErrors.length > 0 ? socialGraphWriteErrors : null,
    })
    .where(eq(lookupJobs.id, job.id));

  // Track lookup completed event
  const durationMs = completedAt.getTime() - (job.startedAt?.getTime() || job.createdAt.getTime());
  const matchRate = job.wallets.length > 0 ? (anySocialFound / job.wallets.length) * 100 : 0;

  trackEvent('lookup_completed', {
    userId: options.userId || job.userId || undefined,
    metadata: {
      jobId: job.id,
      walletCount: job.wallets.length,
      twitterFound,
      farcasterFound,
      anySocialFound,
      cacheHits,
      matchRate: Math.round(matchRate * 100) / 100,
      durationMs,
      tier: options.tier,
      socialGraphWriteStatus,
    },
  });

  return {
    completed: true,
    processedCount: job.wallets.length,
    twitterFound,
    farcasterFound,
    anySocialFound,
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
    .returning();

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

/**
 * Get multiple pending jobs to process in parallel
 * This allows the cron worker to clear the queue faster
 */
export async function getNextPendingJobs(limit: number = 5): Promise<LookupJob[]> {
  const db = getDb();
  if (!db) {
    return [];
  }

  // Get pending jobs first
  const pendingJobs = await db
    .select()
    .from(lookupJobs)
    .where(eq(lookupJobs.status, 'pending'))
    .orderBy(lookupJobs.createdAt)
    .limit(limit);

  if (pendingJobs.length >= limit) {
    return pendingJobs;
  }

  // Also check for processing jobs (in case previous worker died)
  const remainingLimit = limit - pendingJobs.length;
  const processingJobs = await db
    .select()
    .from(lookupJobs)
    .where(eq(lookupJobs.status, 'processing'))
    .orderBy(lookupJobs.createdAt)
    .limit(remainingLimit);

  return [...pendingJobs, ...processingJobs];
}
