import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { lookupHistory } from '@/db/schema';
import { eq, desc, like } from 'drizzle-orm';

export const runtime = 'nodejs';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

function isAuthorized(request: NextRequest): boolean {
  if (!ADMIN_PASSWORD) return false;
  const password = request.headers.get('x-admin-password');
  return password === ADMIN_PASSWORD;
}

// GET: List lookup history with optional user filter
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
    const userId = searchParams.get('userId');
    const limit = parseInt(searchParams.get('limit') || '100', 10);

    let query = db
      .select({
        id: lookupHistory.id,
        name: lookupHistory.name,
        userId: lookupHistory.userId,
        walletCount: lookupHistory.walletCount,
        twitterFound: lookupHistory.twitterFound,
        farcasterFound: lookupHistory.farcasterFound,
        createdAt: lookupHistory.createdAt,
        inputSource: lookupHistory.inputSource,
      })
      .from(lookupHistory)
      .orderBy(desc(lookupHistory.createdAt))
      .limit(limit);

    // Apply user filter if provided
    if (userId) {
      query = query.where(like(lookupHistory.userId, `%${userId}%`)) as typeof query;
    }

    const entries = await query;

    return NextResponse.json({ entries });
  } catch (error) {
    console.error('History fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch history' }, { status: 500 });
  }
}

// DELETE: Delete a history entry
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
      .delete(lookupHistory)
      .where(eq(lookupHistory.id, id))
      .returning();

    if (!deleted) {
      return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('History delete error:', error);
    return NextResponse.json({ error: 'Failed to delete entry' }, { status: 500 });
  }
}
