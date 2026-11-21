import { NextRequest, NextResponse, after } from 'next/server';
import { getNextPendingJobs, processJobChunk } from '@/lib/job-processor';
import { kickHopOf, kickWorker } from '@/lib/worker-kick';

export const runtime = 'nodejs';
// 5 minutes max per invocation. Below LEASE_SECONDS in lib/job-processor.ts,
// which is what lets a lease that has run out be taken as abandoned.
export const maxDuration = 300;

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
 * Worker endpoint: kicked whenever work is queued, and called by Vercel Cron
 * once an hour as the safety net (STA-77, `lib/worker-kick.ts`).
 * Processes multiple jobs in parallel for faster queue clearing.
 *
 * A kicked request (it carries `x-worker-kick`) is answered 202 at once and
 * worked in `after()`, so the caller never waits for the run. A run that leaves
 * work behind and made progress kicks its successor, so a long job or a seed
 * backlog drains without waiting for the hourly tick. A run that made no
 * progress does not, or a job that cannot move would spin a chain of empty
 * invocations; the hourly tick retries it.
 *
 * The only lookup pipeline since STA-44: every job the submit route's kick
 * did not finish is continued here. Each admitted job is worked slice after
 * slice while `INVOCATION_BUDGET_MS` lasts, so one tick usually finishes it.
 * Vercel can start the next tick while this one still runs, which is safe
 * because `processJobChunk` claims each slice with a lease; the candidate
 * read skips held jobs, and a job claimed between that read and the claim
 * comes back `busy` without being worked.
 */
export async function POST(request: NextRequest) {
  // Verify cron secret in production
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      { error: 'Database not configured' },
      { status: 500 }
    );
  }

  const hop = kickHopOf(request.headers);
  if (hop !== null) {
    after(async () => {
      const outcome = await workQueue(hop);
      console.log('Kicked worker run:', outcome.body.message ?? outcome.body);
    });
    return NextResponse.json({ accepted: true, hop }, { status: 202 });
  }

  const outcome = await workQueue(null);
  return NextResponse.json(outcome.body, { status: outcome.status });
}

/**
 * One run over the queue. `hop` is the kick chain position, or null for the
 * hourly cron or a manual call; either way a run that leaves work behind kicks
 * the next one at `hop + 1`.
 */
async function workQueue(
  hop: number | null
): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    // Get multiple pending jobs to process in parallel
    const candidates = await getNextPendingJobs(PARALLEL_JOB_LIMIT);

    if (candidates.length === 0) {
      return {
        status: 200,
        body: {
          message: 'No pending jobs',
          processed: false,
          jobCount: 0,
        },
      };
    }

    /**
     * Resume before you start. `getNextPendingJobs` returns every pending job
     * ahead of every in-progress one, so a job part-way through sits at the end
     * of the list. Admitting in that order while a budget is in force starves
     * it: during a seed-cron backlog the large pending jobs would spend the
     * whole budget every tick, and a customer's half-finished lookup would wait
     * behind cron work, for longer than it did before the budget existed.
     *
     * A job in `processing` has already consumed API calls and holds a partial
     * result. Finishing it releases a customer; deferring a `pending` job costs
     * that customer only a minute.
     */
    const ordered = [...candidates].sort((a, b) => {
      const aRunning = a.status === 'processing' ? 0 : 1;
      const bRunning = b.status === 'processing' ? 0 : 1;
      if (aRunning !== bRunning) return aRunning - bRunning;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

    // Admit in that order until the wallet budget is spent. Anything left stays
    // queued, and this run kicks the next one to take it.
    const jobs: typeof candidates = [];
    let walletsInFlight = 0;
    for (const job of ordered) {
      const size = job.wallets.length - job.processedCount;
      // Always admit the first, so one huge job cannot stall the queue forever.
      if (jobs.length > 0 && walletsInFlight + size > MAX_WALLETS_IN_FLIGHT)
        break;
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
        console.log(
          `Processing job ${job.id}: ${job.processedCount}/${job.wallets.length} wallets`
        );
        try {
          const result = await processJobChunk(job.id);
          console.log(`Job ${job.id} chunk complete:`, result);
          return {
            jobId: job.id,
            walletCount: job.wallets.length,
            progressed:
              result.completed || result.processedCount > job.processedCount,
            ...result,
          };
        } catch (error) {
          console.error(`Job ${job.id} failed:`, error);
          return {
            jobId: job.id,
            walletCount: job.wallets.length,
            progressed: false,
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

    const totalProcessed = results.reduce(
      (sum, r) => sum + (r.processedCount || 0),
      0
    );
    const completedCount = results.filter((r) => r.completed).length;

    // Work left behind: a deferred job, one this run advanced but did not
    // finish, or a full page of candidates, which means more may be queued
    // behind it (Bugbot on PR #430). A `busy` job is another run's, and that
    // run, or the submit route holding it, hands on when it is done.
    const pageWasFull = candidates.length >= PARALLEL_JOB_LIMIT;
    const leftBehind =
      deferred > 0 ||
      pageWasFull ||
      results.some((r) => !r.completed && !r.busy);
    const progressed = results.some((r) => r.progressed);
    const kicked =
      leftBehind && progressed
        ? await kickWorker('/api/jobs/worker', (hop ?? -1) + 1)
        : false;

    return {
      status: 200,
      body: {
        message: `Processed ${jobs.length} jobs (${completedCount} completed)`,
        jobCount: jobs.length,
        totalProcessed,
        completedCount,
        kickedNext: kicked,
        results,
      },
    };
  } catch (error) {
    console.error('Worker error:', error);
    return {
      status: 500,
      body: {
        error: error instanceof Error ? error.message : 'Worker failed',
      },
    };
  }
}

// Also support GET for manual triggering in dev
export async function GET(request: NextRequest) {
  return POST(request);
}
