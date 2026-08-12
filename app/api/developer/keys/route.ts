import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { users, apiPlans } from '@/db/schema';
import { createApiKey, listApiKeys } from '@/lib/api-keys';
import { requireDeveloperAccess } from '@/lib/developer-auth';

export const runtime = 'nodejs';

/**
 * GET /api/developer/keys
 * List all API keys for a user
 */
export async function GET(request: NextRequest) {
  const requested = request.nextUrl.searchParams.get('email');

  const auth = await requireDeveloperAccess(requested);
  if (!auth.ok) return auth.response;
  const email = auth.identity.email;

  const db = getDb();
  if (!db) {
    return NextResponse.json(
      { error: 'Database not configured' },
      { status: 503 }
    );
  }

  // Get user by email
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);

  if (!user) {
    return NextResponse.json(
      { error: 'User not found' },
      { status: 404 }
    );
  }

  // List API keys
  const keys = await listApiKeys(user.id);

  // Return keys without the hashed key value
  const safeKeys = keys.map((key) => ({
    id: key.id,
    name: key.name,
    prefix: key.keyPrefix,
    plan: key.plan,
    is_active: key.isActive,
    created_at: key.createdAt.toISOString(),
    last_used_at: key.lastUsedAt?.toISOString(),
    expires_at: key.expiresAt?.toISOString(),
    revoked_at: key.revokedAt?.toISOString(),
  }));

  return NextResponse.json({ keys: safeKeys });
}

/**
 * POST /api/developer/keys
 * Create a new API key for a user
 */
export async function POST(request: NextRequest) {
  let body: { email: string; name: string; plan: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 }
    );
  }

  const { email: requested, name, plan } = body;

  const auth = await requireDeveloperAccess(requested);
  if (!auth.ok) return auth.response;
  const email = auth.identity.email;

  if (!name || !plan) {
    return NextResponse.json(
      { error: 'Missing required fields: name, plan' },
      { status: 400 }
    );
  }

  const db = getDb();
  if (!db) {
    return NextResponse.json(
      { error: 'Database not configured' },
      { status: 503 }
    );
  }

  // Verify plan exists
  const [planRecord] = await db
    .select()
    .from(apiPlans)
    .where(eq(apiPlans.id, plan))
    .limit(1);

  if (!planRecord) {
    return NextResponse.json(
      { error: `Invalid plan: ${plan}. Valid plans: developer, startup, enterprise` },
      { status: 400 }
    );
  }

  // Look up the session's own account
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);

  if (!user) {
    // Previously this created an account for whatever email was posted, which
    // was how an anonymous caller could mint a key for an address they did not
    // own. A session is now required, so the account must already exist.
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  // Create API key
  const result = await createApiKey(user.id, name, plan);

  if (!result) {
    return NextResponse.json(
      { error: 'Failed to create API key' },
      { status: 500 }
    );
  }

  // Return the new key - this is the ONLY time the raw key is shown
  return NextResponse.json(
    {
      message: 'API key created successfully. Store this key securely - it will not be shown again.',
      key: {
        id: result.key.id,
        name: result.key.name,
        prefix: result.key.keyPrefix,
        plan: result.key.plan,
        api_key: result.rawKey, // Only shown on creation!
        created_at: result.key.createdAt.toISOString(),
      },
    },
    { status: 201 }
  );
}
