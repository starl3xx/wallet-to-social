import { NextRequest, NextResponse } from 'next/server';
import { getNextPendingJob, processJobChunk } from '@/lib/job-processor';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes max per invocation

/**
 * Cron worker endpoint - called by Vercel Cron every minute.
 * Processes one job at a time, up to 2000 wallets per invocation.
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

    // Get next job to process
    const job = await getNextPendingJob();

    if (!job) {
      return NextResponse.json({
        message: 'No pending jobs',
        processed: false,
      });
    }

    console.log(`Processing job ${job.id}: ${job.processedCount}/${job.wallets.length} wallets`);

    // Process a chunk of the job
    const result = await processJobChunk(job.id);

    console.log(`Job ${job.id} chunk complete:`, result);

    return NextResponse.json({
      jobId: job.id,
      ...result,
      message: result.completed
        ? 'Job completed'
        : `Processed ${result.processedCount} of ${job.wallets.length} wallets`,
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
