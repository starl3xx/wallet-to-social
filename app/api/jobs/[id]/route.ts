import { NextRequest, NextResponse } from 'next/server';
import { getJob } from '@/lib/job-processor';
import type { WalletSocialResult } from '@/lib/types';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!process.env.DATABASE_URL) {
      return NextResponse.json(
        { error: 'Database not configured' },
        { status: 500 }
      );
    }

    const job = await getJob(id);

    if (!job) {
      return NextResponse.json(
        { error: 'Job not found' },
        { status: 404 }
      );
    }

    const response: {
      id: string;
      status: string;
      progress: {
        processed: number;
        total: number;
        stage: string | null;
      };
      stats: {
        twitterFound: number;
        farcasterFound: number;
        cacheHits: number;
      };
      results?: WalletSocialResult[];
      error?: string;
      createdAt: Date;
      completedAt?: Date | null;
    } = {
      id: job.id,
      status: job.status,
      progress: {
        processed: job.processedCount,
        total: job.wallets.length,
        stage: job.currentStage,
      },
      stats: {
        twitterFound: job.twitterFound,
        farcasterFound: job.farcasterFound,
        cacheHits: job.cacheHits,
      },
      createdAt: job.createdAt,
      completedAt: job.completedAt,
    };

    // Include results only when complete
    if (job.status === 'completed' && job.partialResults) {
      response.results = job.partialResults as WalletSocialResult[];
    }

    // Include error message if failed
    if (job.status === 'failed' && job.errorMessage) {
      response.error = job.errorMessage;
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error('Job status error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to get job status' },
      { status: 500 }
    );
  }
}
