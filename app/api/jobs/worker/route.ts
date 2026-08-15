import { NextRequest, NextResponse } from 'next/server';
import { getNextPendingJobs, processJobChunk } from '@/lib/job-processor';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes max per invocation

// Process up to 5 jobs in parallel to clear queue faster
const PARALLEL_JOB_LIMIT = 5;

/**
 * Wallets allowed in flight across all jobs in one worker tick.
 *
 * Job count is the wrong unit. Five 200-wallet jobs and five 2,000-wallet jobs
 * are both "5 jobs", and only one of them is a problem: on 2026-08-13 the daily
 * seed cron queued five 2,000-wallet jobs, the worker took all five at once, and
 * 10,000 wallets hit Web3Bio together. It answered 500 to roughly 1,200 requests
 * per batch, and average latency went from about 20 seconds to 3.5 minutes.
 *
 * Budgeting by wallets keeps the queue draining quickly when jobs are small, and
 * serialises them when they are large. The first job is always admitted, however
 * big it is, or a single oversized job would never run at all.
 */
const MAX_WALLETS_IN_FLIGHT = 2500;

/**
 * Cron worker endpoint - called by Vercel Cron every minute.
 * Processes multiple jobs in parallel for faster queue clearing.
 */
export async function POST(request: NextRequest) {
  try {
    // Verify cron secret in production
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    if (!process.env.DATABASE_URL) {
      return NextResponse.json(
        { error: 'Database not configured' },
        { status: 500 }
      );
    }

    // Get multiple pending jobs to process in parallel
    const candidates = await getNextPendingJobs(PARALLEL_JOB_LIMIT);

    if (candidates.length === 0) {
      return NextResponse.json({
        message: 'No pending jobs',
        processed: false,
        jobCount: 0,
      });
    }

    // Admit jobs in queue order until the wallet budget is spent. Anything left
    // stays pending and is picked up by the next tick, a minute later.
    const jobs: typeof candidates = [];
    let walletsInFlight = 0;
    for (const job of candidates) {
      const size = job.wallets.length - job.processedCount;
      // Always admit the first, so one huge job cannot stall the queue forever.
      if (jobs.length > 0 && walletsInFlight + size > MAX_WALLETS_IN_FLIGHT) break;
      jobs.push(job);
      walletsInFlight += size;
    }

    const deferred = candidates.length - jobs.length;
    console.log(
      `Processing ${jobs.length} jobs in parallel (${walletsInFlight} wallets in flight` +
        (deferred > 0 ? `, ${deferred} deferred to the next tick` : '') +
        ')'
    );

    // Process all jobs in parallel
    const results = await Promise.all(
      jobs.map(async (job) => {
        console.log(`Processing job ${job.id}: ${job.processedCount}/${job.wallets.length} wallets`);
        try {
          const result = await processJobChunk(job.id);
          console.log(`Job ${job.id} chunk complete:`, result);
          return {
            jobId: job.id,
            walletCount: job.wallets.length,
            ...result,
          };
        } catch (error) {
          console.error(`Job ${job.id} failed:`, error);
          return {
            jobId: job.id,
            walletCount: job.wallets.length,
            completed: true,
            processedCount: job.processedCount,
            twitterFound: job.twitterFound,
            farcasterFound: job.farcasterFound,
            anySocialFound: job.anySocialFound,
            cacheHits: job.cacheHits,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      })
    );

    const totalProcessed = results.reduce((sum, r) => sum + (r.processedCount || 0), 0);
    const completedCount = results.filter((r) => r.completed).length;

    return NextResponse.json({
      message: `Processed ${jobs.length} jobs (${completedCount} completed)`,
      jobCount: jobs.length,
      totalProcessed,
      completedCount,
      results,
    });
  } catch (error) {
    console.error('Worker error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Worker failed' },
      { status: 500 }
    );
  }
}

// Also support GET for manual triggering in dev
export async function GET(request: NextRequest) {
  return POST(request);
}
