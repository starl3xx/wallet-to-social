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

    // Check for authenticated session (optional — unauthenticated users can
    // poll jobs they created by proving ownership via userId query param)
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    const session = sessionToken
      ? await validateSession(sessionToken)
      : { user: null };

    const job = await getJob(id);

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    // Verify ownership: authenticated users by session, others by userId param.
    // `isOwner` gates the wallet-level results below. A job with a null userId
    // (system jobs — the seed cron and refresh-stale) has no owner anyone can
    // prove, so its resolved wallet lists must never be returned to a caller;
    // only its progress/stats are public. Previously a null userId skipped both
    // branches and fell through to returning full partialResults to anyone.
    let isOwner = false;
    if (session.user) {
      if (job.userId && job.userId !== session.user.id) {
        return NextResponse.json({ error: 'Job not found' }, { status: 404 });
      }
      isOwner = !!job.userId && job.userId === session.user.id;
    } else if (job.userId) {
      const queryUserId = request.nextUrl.searchParams.get('userId');
      if (!queryUserId || queryUserId !== job.userId) {
        return NextResponse.json({ error: 'Job not found' }, { status: 404 });
      }
      isOwner = true;
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

    // Include resolved wallet results only for the job's owner. Anonymous
    // callers and non-owners (including anyone hitting a system job) get
    // progress/stats but never the wallet-level social data.
    if (isOwner && job.status === 'completed' && job.partialResults) {
      response.results = job.partialResults as WalletSocialResult[];
    }

    // Include a generic failure signal — never the raw errorMessage, which can
    // carry database/driver internals, to an unauthenticated caller
    if (job.status === 'failed') {
      response.error =
        isOwner && job.errorMessage ? job.errorMessage : 'Job failed';
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error('Job status error:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to get job status',
      },
      { status: 500 }
    );
  }
}
