import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { lookupJobs } from '@/db/schema';
import { eq, desc, sql } from 'drizzle-orm';

export const runtime = 'nodejs';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

function isAuthorized(request: NextRequest): boolean {
  if (!ADMIN_PASSWORD) return false;
  const password = request.headers.get('x-admin-password');
  return password === ADMIN_PASSWORD;
}

// GET: List all jobs with optional status filter, or get single job with results
export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getDb();
  if (!db) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
  }

  try {
    const searchParams = request.nextUrl.searchParams;
    const jobId = searchParams.get('id');
    const status = searchParams.get('status');
    const limit = parseInt(searchParams.get('limit') || '100', 10);

    // If specific job ID requested, return full job with results
    if (jobId) {
      const [job] = await db
        .select()
        .from(lookupJobs)
        .where(eq(lookupJobs.id, jobId))
        .limit(1);

      if (!job) {
        return NextResponse.json({ error: 'Job not found' }, { status: 404 });
      }

      return NextResponse.json({
        job: {
          id: job.id,
          status: job.status,
          walletCount: job.wallets?.length || 0,
          processedCount: job.processedCount,
          currentStage: job.currentStage,
          twitterFound: job.twitterFound,
          farcasterFound: job.farcasterFound,
          anySocialFound: job.anySocialFound,
          cacheHits: job.cacheHits,
          userId: job.userId,
          createdAt: job.createdAt,
          startedAt: job.startedAt,
          completedAt: job.completedAt,
          errorMessage: job.errorMessage,
          retryCount: job.retryCount,
          results: job.partialResults || [],
        },
      });
    }

    let query = db
      .select({
        id: lookupJobs.id,
        status: lookupJobs.status,
        walletCount: sql<number>`jsonb_array_length(${lookupJobs.wallets})`,
        processedCount: lookupJobs.processedCount,
        currentStage: lookupJobs.currentStage,
        twitterFound: lookupJobs.twitterFound,
        farcasterFound: lookupJobs.farcasterFound,
        userId: lookupJobs.userId,
        createdAt: lookupJobs.createdAt,
        startedAt: lookupJobs.startedAt,
        completedAt: lookupJobs.completedAt,
        errorMessage: lookupJobs.errorMessage,
        retryCount: lookupJobs.retryCount,
      })
      .from(lookupJobs)
      .orderBy(desc(lookupJobs.createdAt))
      .limit(limit);

    // Apply status filter if provided
    if (status) {
      query = query.where(eq(lookupJobs.status, status)) as typeof query;
    }

    const jobs = await query;

    return NextResponse.json({ jobs });
  } catch (error) {
    console.error('Jobs fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch jobs' }, { status: 500 });
  }
}

// POST: Retry or cancel a job
export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getDb();
  if (!db) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
  }

  try {
    const body = await request.json();
    const { id, action } = body;

    if (!id || !action) {
      return NextResponse.json({ error: 'ID and action required' }, { status: 400 });
    }

    if (action === 'retry' || action === 'rerun') {
      // Get original job to merge options
      const [originalJob] = await db
        .select({ options: lookupJobs.options })
        .from(lookupJobs)
        .where(eq(lookupJobs.id, id))
        .limit(1);

      if (!originalJob) {
        return NextResponse.json({ error: 'Job not found' }, { status: 404 });
      }

      // Merge current access defaults into original options
      // This ensures reruns use latest provider settings (e.g., Neynar now enabled for free users)
      const originalOptions = originalJob.options as Record<string, unknown>;
      const updatedOptions = {
        ...originalOptions,
        canUseNeynar: true, // All tiers now have Neynar access
      };

      // Reset failed or completed job to pending to reprocess
      const [updated] = await db
        .update(lookupJobs)
        .set({
          status: 'pending',
          errorMessage: null,
          processedCount: 0,
          currentStage: null,
          partialResults: null,
          twitterFound: 0,
          farcasterFound: 0,
          anySocialFound: 0,
          cacheHits: 0,
          startedAt: null,
          completedAt: null,
          updatedAt: new Date(),
          options: updatedOptions,
        })
        .where(eq(lookupJobs.id, id))
        .returning();

      if (!updated) {
        return NextResponse.json({ error: 'Job not found' }, { status: 404 });
      }

      return NextResponse.json({ success: true, job: updated });
    }

    if (action === 'cancel') {
      // Cancel processing or pending job
      const [updated] = await db
        .update(lookupJobs)
        .set({
          status: 'failed',
          errorMessage: 'Cancelled by admin',
          updatedAt: new Date(),
        })
        .where(eq(lookupJobs.id, id))
        .returning();

      if (!updated) {
        return NextResponse.json({ error: 'Job not found' }, { status: 404 });
      }

      return NextResponse.json({ success: true, job: updated });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('Job action error:', error);
    return NextResponse.json({ error: 'Failed to update job' }, { status: 500 });
  }
}
