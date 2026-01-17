import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { users } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';

export const runtime = 'nodejs';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

function isAuthorized(request: NextRequest): boolean {
  if (!ADMIN_PASSWORD) return false;
  const password = request.headers.get('x-admin-password');
  return password === ADMIN_PASSWORD;
}

// GET: List all users with optional tier filter
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
    const tier = searchParams.get('tier');
    const limit = parseInt(searchParams.get('limit') || '100', 10);

    let query = db
      .select({
        id: users.id,
        email: users.email,
        tier: users.tier,
        stripeCustomerId: users.stripeCustomerId,
        paidAt: users.paidAt,
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(desc(users.createdAt))
      .limit(limit);

    // Apply tier filter if provided
    if (tier) {
      query = query.where(eq(users.tier, tier)) as typeof query;
    }

    const userList = await query;

    return NextResponse.json({ users: userList });
  } catch (error) {
    console.error('Users fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
  }
}

// PATCH: Update user tier
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
    const { id, tier } = body;

    if (!id || !tier) {
      return NextResponse.json({ error: 'ID and tier required' }, { status: 400 });
    }

    const validTiers = ['free', 'pro', 'unlimited'];
    if (!validTiers.includes(tier)) {
      return NextResponse.json({ error: 'Invalid tier' }, { status: 400 });
    }

    const [updated] = await db
      .update(users)
      .set({ tier })
      .where(eq(users.id, id))
      .returning({ id: users.id, email: users.email, tier: users.tier });

    if (!updated) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, user: updated });
  } catch (error) {
    console.error('User update error:', error);
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
  }
}
