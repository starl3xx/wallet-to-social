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

// GET: List completed jobs for activity feed management
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
    const limit = parseInt(searchParams.get('limit') || '50', 10);

    const jobs = await db
      .select({
        id: lookupJobs.id,
        walletCount: sql<number>`jsonb_array_length(${lookupJobs.wallets})`,
        twitterFound: lookupJobs.twitterFound,
        farcasterFound: lookupJobs.farcasterFound,
        anySocialFound: lookupJobs.anySocialFound,
        completedAt: lookupJobs.completedAt,
        hidden: lookupJobs.hidden,
      })
      .from(lookupJobs)
      .where(eq(lookupJobs.status, 'completed'))
      .orderBy(desc(lookupJobs.completedAt))
      .limit(limit);

    return NextResponse.json({ jobs });
  } catch (error) {
    console.error('Activity fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch activity' }, { status: 500 });
  }
}

// PATCH: Toggle hidden status of a job
export async function PATCH(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getDb();
  if (!db) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
  }

  try {
    const body = await request.json();
    const { id, hidden } = body;

    if (!id || typeof hidden !== 'boolean') {
      return NextResponse.json({ error: 'ID and hidden status required' }, { status: 400 });
    }

    const [updated] = await db
      .update(lookupJobs)
      .set({ hidden })
      .where(eq(lookupJobs.id, id))
      .returning({ id: lookupJobs.id, hidden: lookupJobs.hidden });

    if (!updated) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, job: updated });
  } catch (error) {
    console.error('Activity update error:', error);
    return NextResponse.json({ error: 'Failed to update job' }, { status: 500 });
  }
}

// DELETE: Delete a completed job
export async function DELETE(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getDb();
  if (!db) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
  }

  try {
    const searchParams = request.nextUrl.searchParams;
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'ID required' }, { status: 400 });
    }

    const [deleted] = await db
      .delete(lookupJobs)
      .where(eq(lookupJobs.id, id))
      .returning({ id: lookupJobs.id });

    if (!deleted) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Activity delete error:', error);
    return NextResponse.json({ error: 'Failed to delete job' }, { status: 500 });
  }
}
