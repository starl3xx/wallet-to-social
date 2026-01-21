import { NextRequest, NextResponse } from 'next/server';
import { getNextPendingJobs, processJobChunk } from '@/lib/job-processor';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes max per invocation

// Process up to 5 jobs in parallel to clear queue faster
const PARALLEL_JOB_LIMIT = 5;

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
    const jobs = await getNextPendingJobs(PARALLEL_JOB_LIMIT);

    if (jobs.length === 0) {
      return NextResponse.json({
        message: 'No pending jobs',
        processed: false,
        jobCount: 0,
      });
    }

    console.log(`Processing ${jobs.length} jobs in parallel`);

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
