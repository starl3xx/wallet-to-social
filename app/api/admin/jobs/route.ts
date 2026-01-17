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

// GET: List all jobs with optional status filter
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
    const status = searchParams.get('status');
    const limit = parseInt(searchParams.get('limit') || '100', 10);

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

    if (action === 'retry') {
      // Reset failed job to pending
      const [updated] = await db
        .update(lookupJobs)
        .set({
          status: 'pending',
          errorMessage: null,
          processedCount: 0,
          currentStage: null,
          partialResults: null,
          startedAt: null,
          completedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(lookupJobs.id, id))
        .returning({ id: lookupJobs.id, status: lookupJobs.status });

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
        .returning({ id: lookupJobs.id, status: lookupJobs.status });

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
