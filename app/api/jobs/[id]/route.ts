import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getJob } from '@/lib/job-processor';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth';
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

    // Require authenticated session
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;

    if (!sessionToken) {
      return NextResponse.json(
        { error: 'Login required' },
        { status: 401 }
      );
    }

    const session = await validateSession(sessionToken);
    if (!session.user) {
      return NextResponse.json(
        { error: 'Invalid or expired session' },
        { status: 401 }
      );
    }

    const job = await getJob(id);

    // Return 404 for both "not found" and "not owned" (prevents enumeration)
    if (!job || job.userId !== session.user.id) {
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
