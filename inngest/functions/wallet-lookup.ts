import { inngest } from '../client';
import { getDb } from '@/db';
import { lookupJobs } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { batchFetchWeb3Bio } from '@/lib/web3bio';
import { batchFetchNeynar, type NeynarResult } from '@/lib/neynar';
import { batchLookupENS } from '@/lib/ens';
import { getCachedWallets, cacheWalletResults } from '@/lib/cache';
import { saveLookup } from '@/lib/history';
import { chargeForJob } from '@/lib/credits';
import { ANON_MATCHES_PER_JOB } from '@/lib/match-gate';
import type { UserTier } from '@/lib/access';
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
import { stampReachability } from '@/lib/handle-reachability';
import { jobGetsPaidFields } from '@/lib/job-processor';
import type { WalletSocialResult } from '@/lib/types';
import { asSourceList } from '@/lib/api-sources';
import { trackEvent } from '@/lib/analytics';

// Process wallets in micro-batches for parallel execution
const MICRO_BATCH_SIZE = 500;

/**
 * The real one, imported rather than mirrored.
 *
 * This was a hand-copied subset, and the copy is how the two pipelines drifted:
 * the options JSONB always carried the billing identity and this pipeline
 * simply never declared it, so it billed nothing at all. A type-only import
 * costs nothing at runtime and makes the next added option a compile error here
 * instead of a silent omission.
 */
import type { JobOptions } from '@/lib/job-processor';

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
    // Increased from 10 to handle 50+ concurrent customers
    concurrency: {
      limit: 100,
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
        .set({
          status: 'processing',
          startedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(lookupJobs.id, jobId));

      return jobData;
    });

    if (!job) {
      return { status: 'already_completed' };
    }

    const options = job.options as JobOptions;
    const originalData = (job.originalData || {}) as Record<
      string,
      Record<string, string>
    >;
    const allWallets = job.wallets;

    // Step 2: Initialize results map and detect holdings column
    const { results, holdingsColumn } = await step.run(
      'init-results',
      async () => {
        const resultsMap = new Map<string, WalletSocialResult>();

        // Load any partial results
        const partialResults = (job.partialResults ||
          []) as WalletSocialResult[];
        for (const r of partialResults) {
          // Normalised on the way in, for the same reason as the inline
          // pipeline: a row written before the spread order below was
          // corrected still carries `source` as a string, and this step runs
          // on resume as well as on a first pass.
          resultsMap.set(r.wallet, { ...r, source: asSourceList(r.source) });
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
              holdings =
                parseHoldingsValue(walletData[holdingsCol]) ?? undefined;
            }
            // Uploaded columns first, then the fields this function owns.
            // See lib/job-processor.ts for what spreading them last did: our
            // own CSV export writes `source` as a comma-joined string, so a
            // re-uploaded export replaced the array and every later
            // `[...existing.source, 'cache']` spread it into characters.
            resultsMap.set(walletLower, {
              ...walletData,
              wallet: walletLower,
              source: [],
              holdings,
            });
          }
        }

        // Convert to array for serialization
        return {
          results: Array.from(resultsMap.entries()),
          holdingsColumn: holdingsCol,
        };
      }
    );

    // Convert results back to Map
    let resultsMap = new Map<string, WalletSocialResult>(results);

    // Step 3: Check cache
    const cacheResult = await step.run('check-cache', async () => {
      let cached = new Map<string, WalletSocialResult>();
      try {
        cached = await getCachedWallets(allWallets);
      } catch (error) {
        console.error('Cache error:', error);
      }

      // Apply cached results to a copy of resultsMap
      const updatedMap = new Map(resultsMap);
      for (const [wallet, data] of cached) {
        const existing = updatedMap.get(wallet)!;
        updatedMap.set(wallet, {
          ...existing,
          ...data,
          source: [...data.source, 'cache'],
        });
      }

      const uncached = allWallets.filter((w) => !cached.has(w.toLowerCase()));
      return {
        cachedCount: cached.size,
        uncachedWallets: uncached,
        // Return the updated results with cache hits applied
        updatedResults: Array.from(updatedMap.entries()),
      };
    });

    // FIXED: Use updatedResults from cache step instead of original results
    // This ensures cache hits are preserved across Inngest step boundaries
    resultsMap = new Map<string, WalletSocialResult>(
      cacheResult.updatedResults
    );
    const { cachedCount, uncachedWallets } = cacheResult;

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

        const batchResults = await step.run(
          `process-batch-${batchIndex}`,
          async () => {
            const batchResultsMap = new Map<string, WalletSocialResult>();
            const neynarApiKey = process.env.NEYNAR_API_KEY;

            // Initialize batch results
            for (const wallet of batch) {
              const walletLower = wallet.toLowerCase();
              const walletData = originalData[walletLower] || {};
              let holdings: number | undefined;
              if (holdingsColumn && walletData[holdingsColumn]) {
                holdings =
                  parseHoldingsValue(walletData[holdingsColumn]) ?? undefined;
              }
              // Same precedence as the initializer above. Two copies of this
              // object literal is why the fix had to be made twice; the
              // invariant asserts both.
              batchResultsMap.set(walletLower, {
                ...walletData,
                wallet: walletLower,
                source: [],
                holdings,
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
          }
        );

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
              processedCount: Math.min(
                processedCount + cachedCount,
                allWallets.length
              ),
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
            if (!result.ens_name && storedData.ens_name)
              result.ens_name = storedData.ens_name;
            if (!result.twitter_handle && storedData.twitter_handle) {
              result.twitter_handle = storedData.twitter_handle;
              result.twitter_url = storedData.twitter_url;
            }
            if (!result.farcaster && storedData.farcaster) {
              result.farcaster = storedData.farcaster;
              result.farcaster_url = storedData.farcaster_url;
              result.fc_followers = storedData.fc_followers;
            }
            // Attestation applies to the handle it describes, so it is
            // copied whenever the graph's handle is the one on the result,
            // not only when the graph supplied it. Nesting this inside the
            // gap-filling branch meant a handle that arrived from cache or
            // the API kept no verification at all, which is the usual case
            // and left the gutter blank on the busiest path.
            if (
              result.twitter_handle &&
              result.twitter_handle === storedData.twitter_handle
            ) {
              result.twitter_verified = storedData.twitter_verified;
            }
            if (result.farcaster && result.farcaster === storedData.farcaster) {
              result.farcaster_verified = storedData.farcaster_verified;
            }
            if (!result.lens && storedData.lens) result.lens = storedData.lens;
            if (!result.github && storedData.github)
              result.github = storedData.github;
            resultsMap.set(wallet, result);
          }
        }
      } catch (error) {
        console.error('Social graph enrichment error:', error);
      }
    });

    /**
     * Step 6: reachability, then priority scores.
     *
     * RETURNS the rows, and the map is rebuilt from the return value outside
     * the step. That is this file's own pattern (`build-initial-results` and
     * `check-cache` both do it) and it is not a style choice: `step.run`
     * memoises its RESULT, so on a replay the callback does not execute at
     * all. A step that mutates `resultsMap` in place and returns nothing
     * therefore does nothing on the second pass, and `finalize` persists the
     * pre-stamp map: no `x_followers`, and a score that still ignores X
     * reach. The first version of this step did exactly that.
     *
     * `enrich-social-graph` above still has that shape. It predates this
     * change and is left alone here, but it loses its enrichment on a replay
     * for the same reason and is worth fixing separately.
     */
    const scored = await step.run('calculate-scores', async () => {
      const all = Array.from(resultsMap.values());

      /**
       * Stamped here because the score needs it, and this pipeline never did.
       *
       * `lib/job-processor.ts` stamps reachability in its finalize step and
       * this one did not stamp at all, so `x_followers` did not exist on the
       * API path. Adding X reach to the score without this would have given
       * an API caller a score computed from one platform and the app a score
       * computed from two, for the same wallet. The rule this file states a
       * few lines down is that a change to one pipeline is made to both.
       */
      await stampReachability(all);

      /**
       * The paid strip, before the score reads the field.
       *
       * `x_followers` is a paid field everywhere else, and it is new here, so
       * removing it for a free job takes nothing away that anybody had. Doing
       * it BEFORE the score means a free job's score is computed from the
       * same inputs it always was, and a paid job's gains the X term.
       *
       * `priority_score` itself is deliberately left ungated here, unlike the
       * app pipeline which strips it. That divergence predates this change
       * and removing the field would take it from API callers who have it
       * today, which is not this commit's decision to make.
       */
      if (!jobGetsPaidFields(options)) {
        for (const r of all) r.x_followers = undefined;
      }

      for (const r of all) {
        r.priority_score = calculatePriorityScore(
          r.holdings,
          r.fc_followers,
          r.x_followers
        );
      }

      return all;
    });

    resultsMap = new Map<string, WalletSocialResult>(
      scored.map((r) => [r.wallet, r])
    );

    // Step 7: Finalize job
    await step.run('finalize', async () => {
      const db = getDb();
      if (!db) return;

      const allResults = Array.from(resultsMap.values());

      // Count final stats before anything durable is written: the charge
      // needs the meter, and the history row carries the gate.
      let twitterFound = 0;
      let farcasterFound = 0;
      let anySocialFound = 0;
      for (const result of allResults) {
        if (result.twitter_handle) twitterFound++;
        if (result.farcaster) farcasterFound++;
        if (result.twitter_handle || result.farcaster) anySocialFound++;
      }

      /**
       * Charge and gate, mirrored from lib/job-processor.ts and in the same
       * order: charge first, so the gate rides the history insert and the
       * completion update rather than trailing them. This pipeline
       * previously billed nothing at all (no chargeForJob, no
       * anySocialFound); both pipelines must bill, for the reason the
       * history_saved comment below records: this one is registered and
       * therefore live.
       */
      let matchesDelivered: number | null = null;
      let gateIsFresh = false;
      /**
       * Same gate the worker applies, read from the same option. These two
       * pipelines have diverged once already, when this one billed nothing at
       * all, so the rule is that a change to one is made to both.
       */
      const anonGate = Math.min(
        ANON_MATCHES_PER_JOB,
        Math.max(0, options.anonMatchGate ?? ANON_MATCHES_PER_JOB)
      );

      if (options.meteredUserId) {
        try {
          const charge = await chargeForJob(
            options.meteredUserId,
            jobId,
            anySocialFound,
            allWallets.length,
            options.tier ?? 'free'
          );
          // Both meters, on `delivered`, mirrored exactly from
          // lib/job-processor.ts: the reasoning is written out there, and the
          // two workers drifting on a money rule is the failure this comment
          // exists to prevent.
          if (charge.delivered < anySocialFound) {
            matchesDelivered = charge.delivered;
            gateIsFresh = !charge.duplicate;
          }
        } catch (error) {
          console.error('Credit charge failed (job still succeeded):', error);
        }
      } else if (job.userId && anySocialFound > anonGate) {
        // The anonymous per-job gate, mirrored from lib/job-processor.ts;
        // job.userId excludes system jobs, which serve no rows to anyone.
        matchesDelivered = anonGate;
        gateIsFresh = true;
      }

      // Save to history if requested
      if (options.saveToHistory) {
        try {
          const lookupId = await saveLookup(
            allResults,
            options.historyName,
            options.userId,
            undefined,
            matchesDelivered !== null ? { jobId, matchesDelivered } : undefined
          );

          // Both pipelines emit this, for the reason CHANGELOG records twice:
          // a fix applied to `lib/job-processor.ts` alone leaves this file
          // running the old behaviour, and this one is registered in
          // `app/api/inngest/route.ts` and therefore live.
          trackEvent('history_saved', {
            userId: options.userId,
            sessionId: job.sessionId ?? undefined,
            metadata: {
              jobId,
              lookupId,
              walletCount: allResults.length,
            },
          });
        } catch (error) {
          console.error('History save error:', error);
        }
      }

      // Persist positive results to social graph
      try {
        const positiveResults = allResults.filter(
          (r) =>
            r.twitter_handle || r.farcaster || r.lens || r.github || r.ens_name
        );
        if (positiveResults.length > 0) {
          await upsertSocialGraph(positiveResults);
        }
      } catch (error) {
        console.error('Social graph persist error:', error);
      }

      // Mark job as complete, the gate atomic with completion.
      await db
        .update(lookupJobs)
        .set({
          status: 'completed',
          processedCount: allWallets.length,
          partialResults: allResults,
          twitterFound,
          farcasterFound,
          anySocialFound,
          cacheHits: cachedCount,
          completedAt: new Date(),
          updatedAt: new Date(),
          matchesDelivered,
        })
        .where(eq(lookupJobs.id, jobId));

      if (matchesDelivered !== null && gateIsFresh) {
        trackEvent('limit_hit', {
          userId: options.userId,
          sessionId: job.sessionId ?? undefined,
          metadata: {
            reason: 'match_gate',
            jobId,
            matchesFound: anySocialFound,
            matchesDelivered,
            matchesLocked: anySocialFound - matchesDelivered,
          },
        });
      }
    });

    return {
      status: 'completed',
      jobId,
      walletCount: allWallets.length,
    };
  }
);
