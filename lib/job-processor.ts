import { getDb } from '@/db';
import { lookupJobs } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { batchFetchWeb3Bio } from '@/lib/web3bio';
import { batchFetchNeynar, type NeynarResult } from '@/lib/neynar';
import { batchLookupENS } from '@/lib/ens';
import { getCachedWallets, cacheWalletResults } from '@/lib/cache';
import { saveLookup, type InputSource } from '@/lib/history';
import { stampReachability } from '@/lib/handle-reachability';
import {
  upsertSocialGraphWithRetry,
  upsertNegativeWallets,
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
import { chargeForJob } from '@/lib/credits';
import { detectKnownAgents, detectAgentFromBio } from '@/lib/agent-detection';
import type { WalletSocialResult } from '@/lib/types';
import type { LookupJob } from '@/db/schema';
import type { UserTier } from '@/lib/access';

// Process up to this many wallets per cron invocation
const CHUNK_SIZE = 3000; // Increased from 2000 for faster throughput

export interface JobOptions {
  includeENS?: boolean;
  fastMode?: boolean;
  saveToHistory?: boolean;
  historyName?: string;
  userId?: string;
  /**
   * The `users.id` to debit, set only when a signed-in account created the job.
   *
   * Separate from `userId`, which for an anonymous caller is a localStorage
   * value that a cleared cache resets. Guessing at uuid shape to tell them
   * apart would charge a ledger row to a string that is not an account, so the
   * caller states it instead: `/api/jobs` sets this from the session and
   * nowhere else can.
   */
  meteredUserId?: string;
  tier?: UserTier;
  canUseNeynar?: boolean;
  canUseENS?: boolean;
  inputSource?: InputSource;
  /** Contract behind a contract import, recorded for the admin Jobs table. */
  sourceContract?: {
    contractAddress: string;
    chain: string;
    tokenName?: string;
    tokenSymbol?: string;
    contractType?: string;
    totalHolders?: number;
    truncated?: boolean;
  };
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
    return {
      completed: true,
      processedCount: 0,
      twitterFound: 0,
      farcasterFound: 0,
      anySocialFound: 0,
      cacheHits: 0,
      error: 'Database not configured',
    };
  }

  // Load job from DB
  const [job] = await db
    .select()
    .from(lookupJobs)
    .where(eq(lookupJobs.id, jobId))
    .limit(1);

  if (!job) {
    return {
      completed: true,
      processedCount: 0,
      twitterFound: 0,
      farcasterFound: 0,
      anySocialFound: 0,
      cacheHits: 0,
      error: 'Job not found',
    };
  }

  if (job.status === 'completed' || job.status === 'failed') {
    return {
      completed: true,
      processedCount: job.processedCount,
      twitterFound: job.twitterFound,
      farcasterFound: job.farcasterFound,
      anySocialFound: job.anySocialFound,
      cacheHits: job.cacheHits,
    };
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
    const originalData = (job.originalData || {}) as Record<
      string,
      Record<string, string>
    >;
    const allWallets = job.wallets;
    const startIndex = job.processedCount;

    // Get chunk to process
    const walletsToProcess = allWallets.slice(
      startIndex,
      startIndex + CHUNK_SIZE
    );

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
          holdings =
            parseHoldingsValue(walletData[holdingsColumn]) ?? undefined;
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
    let graphNegativeHits = 0;
    let uncachedWallets = walletsToProcess;

    // =========================================================================
    // STEP 0: Check known_agents table (highest confidence agent detection)
    // Pre-populate agent fields for known wallets before any API calls
    // =========================================================================
    try {
      const knownAgentResults = await detectKnownAgents(walletsToProcess);
      for (const [wallet, agentData] of knownAgentResults) {
        const existing = results.get(wallet);
        if (existing) {
          results.set(wallet, {
            ...existing,
            is_agent: agentData.is_agent,
            agent_name: agentData.agent_name,
            agent_framework: agentData.agent_framework,
            agent_type: agentData.agent_type,
            agent_token_symbol: agentData.agent_token_symbol,
            agent_verified: agentData.agent_verified,
          });
        }
      }
    } catch (error) {
      console.error('Known agents detection error:', error);
    }

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

        if (graphResult.quality === 'negative') {
          // Persisted negative within its recheck window: this wallet was
          // already run through the full pipeline and has no socials. Skip
          // all API calls; the result stays empty. 'graph:none' (not 'graph')
          // so provenance doesn't claim data that was never found.
          results.set(wallet, {
            ...existing,
            source: [...existing.source, 'graph:none'],
          });
          graphNegativeHits++;
        } else if (
          graphResult.quality === 'high' &&
          graphResult.data &&
          !graphResult.needsRefresh
        ) {
          // Trust high-quality data completely - skip all API calls for this wallet
          results.set(wallet, mergeGraphRow(existing, graphResult.data));
          graphHits++;
        } else if (graphResult.quality === 'medium' && graphResult.data) {
          // Medium quality: use as base but still consider API refresh
          results.set(wallet, mergeGraphRow(existing, graphResult.data));
          // Medium quality still needs lookup to potentially refresh data
          walletsNeedingLookup.push(wallet);
        } else {
          // Low, stale, or missing - needs full lookup.
          //
          // The stored row is deliberately not applied on the normal path even
          // when one exists. Every field merges as `stored || existing`, so
          // seeding a stale value here would make the fresh answer lose to the
          // old one when the live pass returns.
          //
          // A fast scan has no live pass, and the same silence would hand back
          // an empty row for a wallet the index can answer for: a high-quality
          // record one day past its refresh window, or a low-confidence one.
          // "Answers from our index only" has to include those, so a fast scan
          // takes what is stored. The counters are left alone on purpose. They
          // measure how often the graph spared us a refresh, and this row still
          // wanted one.
          if (options.fastMode && graphResult.data) {
            results.set(wallet, mergeGraphRow(existing, graphResult.data));
          }
          walletsNeedingLookup.push(wallet);
        }
      }
    } catch (error) {
      console.error('Social graph lookup error:', error);
      // On error, fall back to looking up all wallets
      walletsNeedingLookup.push(...walletsToProcess);
    }

    // Track social graph hit rate for this chunk
    if (graphHits > 0 || graphNegativeHits > 0) {
      trackEvent('social_graph_hit', {
        userId: options.userId || job.userId || undefined,
        metadata: {
          jobId: job.id,
          hitCount: graphHits,
          // Negative hits reported separately so hit-rate dashboards don't
          // conflate "served data" with "served a trusted empty answer"
          negativeHitCount: graphNegativeHits,
          totalWallets: walletsToProcess.length,
          hitRate: Math.round(
            ((graphHits + graphNegativeHits) / walletsToProcess.length) * 100
          ),
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

    // Check cache for wallets not served by high-quality graph data.
    // Includes negative cache entries (source: ['none']) — wallets previously
    // checked with no social data found, so we skip redundant API calls.
    try {
      const cached = await getCachedWallets(walletsNeedingLookup);
      cacheHits += cached.size;

      for (const [wallet, data] of cached) {
        const isNegativeHit =
          data.source.length === 1 && data.source[0] === 'none';
        const existing = results.get(wallet)!;
        if (isNegativeHit) {
          // Negative cache: wallet was checked before with no results — skip APIs
          results.set(wallet, {
            ...existing,
            source: [...existing.source, 'cache'],
          });
        } else {
          results.set(wallet, mergeCacheRow(existing, data));
        }
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
    // ENS and Neynar run in parallel since they're independent. Web3Bio runs
    // after both, filtered to only wallets still missing Twitter.
    //
    // Fast mode stops before this step. It answers from the social graph and
    // the cache and nothing else: no live source is called, nothing is written
    // back, and no negative is persisted. That is what the interface now
    // promises ("answers from our index only"), and it is why a fast scan
    // costs the same whether the list holds 200 wallets or 200,000.
    //
    // It used to skip Web3Bio alone and still call Neynar, which made "fast"
    // an ambiguous middle: slower than an index read, cheaper than a real scan,
    // and impossible to describe to a user in one line. The sweep has since
    // taken Farcaster coverage to complete, so what that call added is, for the
    // most part, already in the graph the step above already read.
    // =========================================================================
    // Wallets whose external check failed (not "not found") — those must never
    // be persisted as negatives, or an API outage would poison the graph with
    // false "no socials" answers for the whole recheck window.
    const apiFailedWallets = new Set<string>();

    if (uncachedWallets.length > 0 && !options.fastMode) {
      const canUseNeynar = neynarApiKey && options.canUseNeynar !== false;
      const canUseENS = options.includeENS && options.canUseENS !== false;

      // Run ENS + Neynar in parallel (ENS is slow RPC, Neynar is fast batch)
      await updateJobStage(db, jobId, canUseENS ? 'ens' : 'neynar');

      const [ensResults, neynarResults] = await Promise.all([
        canUseENS
          ? batchLookupENS(uncachedWallets).catch((error) => {
              console.error('ENS lookup error:', error);
              return new Map<
                string,
                {
                  ensName?: string;
                  twitter?: string;
                  twitterUrl?: string;
                  github?: string;
                }
              >();
            })
          : Promise.resolve(
              new Map<
                string,
                {
                  ensName?: string;
                  twitter?: string;
                  twitterUrl?: string;
                  github?: string;
                }
              >()
            ),
        canUseNeynar
          ? batchFetchNeynar(
              uncachedWallets,
              neynarApiKey,
              undefined,
              undefined,
              {
                failedWallets: apiFailedWallets,
              }
            ).catch((error) => {
              console.error('Neynar fetch error:', error);
              for (const w of uncachedWallets)
                apiFailedWallets.add(w.toLowerCase());
              return new Map<string, NeynarResult>();
            })
          : Promise.resolve(new Map<string, NeynarResult>()),
      ]);

      // Apply ENS results
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

      // Apply Neynar results (including bio for agent detection)
      await updateJobStage(db, jobId, 'neynar');
      for (const [wallet, data] of neynarResults) {
        const existing = results.get(wallet)!;
        results.set(wallet, {
          ...existing,
          twitter_handle: existing.twitter_handle || data.twitter_handle,
          twitter_url: existing.twitter_url || data.twitter_url,
          farcaster: data.farcaster || existing.farcaster,
          farcaster_url: data.farcaster_url || existing.farcaster_url,
          fc_followers: data.fc_followers,
          fc_fid: data.fc_fid,
          fc_bio: data.fc_bio,
          source: existing.source.includes('neynar')
            ? existing.source
            : [...existing.source, 'neynar'],
        });
      }

      // Bio-based agent detection for wallets not already identified
      for (const [wallet, data] of neynarResults) {
        const existing = results.get(wallet);
        if (existing && !existing.is_agent && data.fc_bio) {
          const bioResult = detectAgentFromBio(data.fc_bio);
          if (bioResult) {
            results.set(wallet, {
              ...existing,
              is_agent: true,
              agent_verified: false,
            });
          }
        }
      }

      // Filter wallets that still need Twitter lookup after ENS + Neynar
      const walletsNeedingWeb3Bio = uncachedWallets.filter((wallet) => {
        const existing = results.get(wallet.toLowerCase());
        return !existing?.twitter_handle;
      });

      // Run Web3Bio only for wallets without Twitter (slow — 1 request per wallet)
      if (walletsNeedingWeb3Bio.length > 0) {
        await updateJobStage(db, jobId, 'web3bio');
        const web3BioResults = await batchFetchWeb3Bio(
          walletsNeedingWeb3Bio,
          undefined,
          undefined,
          {
            failedWallets: apiFailedWallets,
          }
        );

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

      // Cache looked-up wallets, including negative results ("not found").
      try {
        const walletsToCache = uncachedWallets
          .map((w) => {
            const r = results.get(w.toLowerCase())!;
            if (r.source.includes('cache')) return null;
            const hasSocial =
              r.twitter_handle ||
              r.farcaster ||
              r.ens_name ||
              r.lens ||
              r.github;
            if (!hasSocial && r.source.length === 0) {
              return { ...r, source: ['none'] as string[] };
            }
            return r.source.length > 0 ? r : null;
          })
          .filter((r): r is WalletSocialResult => r !== null);

        if (walletsToCache.length > 0) {
          await cacheWalletResults(walletsToCache);
        }
      } catch (error) {
        console.error('Cache write error:', error);
      }

      // Persist negatives to the social graph so future lookups skip the APIs
      // entirely (the wallet_cache negative above only lives 7 days). Only
      // wallets that completed the full pipeline count: canUseNeynar=false
      // means Farcaster was never checked, and apiFailedWallets covers
      // per-batch/per-wallet API failures. A fast scan never reaches here.
      if (canUseNeynar) {
        const negativeWallets = uncachedWallets.filter((w) => {
          const wl = w.toLowerCase();
          if (apiFailedWallets.has(wl)) return false;
          const r = results.get(wl)!;
          const hasSocial =
            r.twitter_handle || r.farcaster || r.ens_name || r.lens || r.github;
          return !hasSocial && r.source.length === 0;
        });

        if (negativeWallets.length > 0) {
          try {
            await upsertNegativeWallets(negativeWallets);
          } catch (error) {
            console.error('Negative persistence error:', error);
          }
        }
      }
    }

    // Social graph enrichment is now done FIRST (see STEP 1 above)
    // This ensures we use high-quality cached data before calling external APIs

    // Calculate priority scores (paid tiers only)
    const isPaidTier = options.tier === 'pro' || options.tier === 'unlimited';
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
    const chunkResults = walletsToProcess.map(
      (w) => results.get(w.toLowerCase())!
    );
    const twitterFound =
      job.twitterFound + chunkResults.filter((r) => r.twitter_handle).length;
    const farcasterFound =
      job.farcasterFound + chunkResults.filter((r) => r.farcaster).length;
    const anySocialFound =
      job.anySocialFound +
      chunkResults.filter((r) => r.twitter_handle || r.farcaster).length;

    const newProcessedCount = startIndex + walletsToProcess.length;
    const allResults = Array.from(results.values());

    // Check if job is complete
    const isComplete = newProcessedCount >= allWallets.length;

    if (isComplete) {
      // Finalize: save to history and social graph
      await finalizeJobWithResults(
        db,
        job,
        allResults,
        twitterFound,
        farcasterFound,
        anySocialFound,
        cacheHits
      );
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

/**
 * Merge a stored `social_graph` row onto an in-flight result.
 *
 * This literal existed twice, character for character, and now three times over
 * with the fast-scan path. It decides provenance for every row the graph
 * serves, so two copies of it is two chances to diverge on which side wins.
 *
 * The field policy is not uniform, and each rule is deliberate:
 *
 * - Identity fields take the stored value first. The graph is the better
 *   source; `existing` at this point holds little more than the wallet.
 * - Attestation merges with `??`, not `||`. A `twitter_verified: false` is the
 *   graph saying "consulted, not attested", which is a real answer that `||`
 *   would throw away.
 * - Agent fields keep `existing` first. `detectKnownAgents` has already run
 *   against the curated list, and that list outranks the graph.
 */
function mergeGraphRow(
  existing: WalletSocialResult,
  row: NonNullable<SocialGraphQualityResult['data']>
): WalletSocialResult {
  const stored = socialGraphToResult(row);
  return {
    ...existing,
    ens_name: stored.ens_name || existing.ens_name,
    twitter_handle: stored.twitter_handle || existing.twitter_handle,
    twitter_url: stored.twitter_url || existing.twitter_url,
    farcaster: stored.farcaster || existing.farcaster,
    farcaster_url: stored.farcaster_url || existing.farcaster_url,
    fc_followers: stored.fc_followers || existing.fc_followers,
    fc_fid: stored.fc_fid || existing.fc_fid,
    lens: stored.lens || existing.lens,
    github: stored.github || existing.github,
    twitter_verified: stored.twitter_verified ?? existing.twitter_verified,
    farcaster_verified:
      stored.farcaster_verified ?? existing.farcaster_verified,
    source: [...existing.source, 'graph'],
    is_agent: existing.is_agent || stored.is_agent,
    agent_name: existing.agent_name || stored.agent_name,
    agent_framework: existing.agent_framework || stored.agent_framework,
    agent_type: existing.agent_type || stored.agent_type,
    agent_token_symbol:
      existing.agent_token_symbol || stored.agent_token_symbol,
    agent_verified: existing.agent_verified || stored.agent_verified,
  };
}

/**
 * Merge a `wallet_cache` row onto an in-flight result.
 *
 * This was `{ ...existing, ...data }`, which is not the same thing and loses
 * data. `getCachedWallets` builds every field explicitly, so an empty one
 * arrives as a present key holding `undefined` rather than as an absent key,
 * and a spread writes that `undefined` over whatever the graph step already
 * found. A wallet whose graph row held a Farcaster name and whose cache row
 * held only a Twitter handle came out of this step with no Farcaster name.
 *
 * The cache is fresher than a graph row that reached this step, so it wins
 * where it has an answer, and only where it has one. Agent fields keep the same
 * exception as above: the curated list outranks both.
 */
function mergeCacheRow(
  existing: WalletSocialResult,
  data: WalletSocialResult
): WalletSocialResult {
  return {
    ...existing,
    ens_name: data.ens_name ?? existing.ens_name,
    twitter_handle: data.twitter_handle ?? existing.twitter_handle,
    twitter_url: data.twitter_url ?? existing.twitter_url,
    farcaster: data.farcaster ?? existing.farcaster,
    farcaster_url: data.farcaster_url ?? existing.farcaster_url,
    fc_followers: data.fc_followers ?? existing.fc_followers,
    fc_fid: data.fc_fid ?? existing.fc_fid,
    lens: data.lens ?? existing.lens,
    github: data.github ?? existing.github,
    source: [...existing.source, 'cache'],
    is_agent: existing.is_agent || data.is_agent,
    agent_name: existing.agent_name || data.agent_name,
    agent_framework: existing.agent_framework || data.agent_framework,
    agent_type: existing.agent_type || data.agent_type,
    agent_token_symbol: existing.agent_token_symbol || data.agent_token_symbol,
    agent_verified: existing.agent_verified || data.agent_verified,
  };
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

async function finalizeJobWithResults(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  job: LookupJob,
  results: WalletSocialResult[],
  twitterFound: number,
  farcasterFound: number,
  anySocialFound: number,
  cacheHits: number
): Promise<ProcessResult> {
  const options = job.options as JobOptions;

  /**
   * Stamped here, and BEFORE history is written.
   *
   * This is the path the product actually uses: the UI posts to /api/jobs, and
   * everything funnels through this function. Stamping only the SSE route left
   * the feature reaching no real user at all.
   *
   * Before `saveLookup` because it mutates these objects in place. Saving first
   * would persist rows without the mark, so reopening a saved lookup would drop
   * the dead-handle warnings and the export filtering that the live view had.
   */
  await stampReachability(results);

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

  /**
   * A fast scan writes nothing back, and this is the reason it must not.
   *
   * Every row it produced came out of the graph or the cache. Nothing was
   * confirmed against a live source. `upsertSocialGraphWithRetry` resets
   * `staleAt` and `lastCheckedAt`, so writing those rows would stamp unverified
   * data as freshly checked, and a later deep scan would trust the stamp and
   * skip the very sources meant to confirm it. One fast scan would suppress the
   * next real one for the whole trust window, and the rows it protects are
   * exactly the stale ones a fast scan now serves.
   */
  const positiveResults = options.fastMode
    ? []
    : results.filter(
        (r) =>
          r.twitter_handle || r.farcaster || r.lens || r.github || r.ens_name
      );

  if (positiveResults.length > 0) {
    const writeResult = await upsertSocialGraphWithRetry(positiveResults);

    // Determine write status
    if (writeResult.failed === 0) {
      socialGraphWriteStatus = 'success';
      console.log(
        `Social graph: persisted ${writeResult.succeeded} of ${positiveResults.length} wallets`
      );
    } else if (writeResult.succeeded > 0) {
      socialGraphWriteStatus = 'partial';
      socialGraphWriteErrors = writeResult.errors;
      console.warn(
        `Social graph: partial write - ${writeResult.succeeded} succeeded, ${writeResult.failed} failed`
      );
    } else {
      socialGraphWriteStatus = 'failed';
      socialGraphWriteErrors = writeResult.errors;
      console.error(
        'CRITICAL: Social graph persist completely failed:',
        writeResult.errors
      );
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
      socialGraphWriteErrors:
        socialGraphWriteErrors.length > 0 ? socialGraphWriteErrors : null,
    })
    .where(eq(lookupJobs.id, job.id));

  /**
   * Charge for the matches, after the job is marked complete.
   *
   * Deliberately after. A job that fails partway is not charged, and the debit
   * is keyed on the job id, so a resumed job that reaches here twice inserts
   * once and the second attempt is swallowed by the unique index.
   *
   * `anySocialFound` is the meter: wallets carrying an X handle or a Farcaster
   * account. Misses are free, which is the whole pricing position, so this must
   * not be `processedCount` however tempting the symmetry.
   *
   * Never fatal. A ledger write that fails must not fail a lookup the caller
   * has already waited for; the work is done and the results are theirs. The
   * cost of a missed debit is one uncharged job, which is strictly better than
   * a completed job that reports as failed.
   */
  /**
   * Called for every job by a signed-in account, including zero-match ones.
   *
   * The earlier `anySocialFound > 0` guard skipped the cheap case, and that was
   * wrong once legacy accounts started recording usage: they are never charged
   * but their submitted-wallet counts feed the daily anti-enumeration ceiling,
   * and a run that matched nothing is exactly the shape enumeration takes.
   * `chargeForJob` returns early for the metered zero-match case, so the only
   * cost here is one function call.
   */
  if (options.meteredUserId) {
    try {
      await chargeForJob(
        options.meteredUserId,
        job.id,
        anySocialFound,
        job.wallets.length,
        options.tier ?? 'free'
      );
    } catch (error) {
      console.error('Credit charge failed (job still succeeded):', error);
    }
  }

  // Track lookup completed event
  const durationMs =
    completedAt.getTime() -
    (job.startedAt?.getTime() || job.createdAt.getTime());
  const matchRate =
    job.wallets.length > 0 ? (anySocialFound / job.wallets.length) * 100 : 0;

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
export async function getNextPendingJobs(
  limit: number = 5
): Promise<LookupJob[]> {
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
