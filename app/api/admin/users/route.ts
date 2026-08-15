import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { users } from '@/db/schema';
import { eq, desc } from 'drizzle-orm';
import { requireAdmin } from '@/lib/admin-auth';

export const runtime = 'nodejs';

// GET: List all users with optional tier filter
export async function GET(request: NextRequest) {
  const authError = requireAdmin(request);
  if (authError) return authError;

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
        // Returned so the admin table has something to show when no Customer
        // exists. Historic sales have no `stripe_customer_id` at all, and the
        // payment intent is the id that actually identifies the sale in Stripe.
        stripePaymentId: users.stripePaymentId,
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
  const authError = requireAdmin(request);
  if (authError) return authError;

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
      .returning();

    if (!updated) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, user: updated });
  } catch (error) {
    console.error('User update error:', error);
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
  }
}
