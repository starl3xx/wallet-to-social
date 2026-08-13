import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { users, apiPlans } from '@/db/schema';
import { createApiKey, listApiKeys } from '@/lib/api-keys';
import { requireDeveloperAccess, apiPlanForTier } from '@/lib/developer-auth';

export const runtime = 'nodejs';

// Max active (non-revoked) keys per account. Caps the mint-more-keys vector:
// with account-level quotas now enforced in the rate limiter, extra keys no
// longer multiply the allowance, but bounding the count also bounds the
// blast radius of any one leaked key and keeps the account-usage sum cheap.
const MAX_ACTIVE_KEYS_PER_ACCOUNT = 10;

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
  let body: { email: string; name: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 }
    );
  }

  const { email: requested, name } = body;

  const auth = await requireDeveloperAccess(requested);
  if (!auth.ok) return auth.response;
  const email = auth.identity.email;

  if (!name) {
    return NextResponse.json(
      { error: 'Missing required field: name' },
      { status: 400 }
    );
  }

  // Derived from the tier, never taken from the request body. A caller-supplied
  // plan would let a Pro account request 'enterprise' limits.
  const plan = apiPlanForTier(auth.identity.tier);
  if (!plan) {
    return NextResponse.json(
      { error: 'API access is available on Pro and Unlimited', upgradeRequired: true },
      { status: 403 }
    );
  }

  const db = getDb();
  if (!db) {
    return NextResponse.json(
      { error: 'Database not configured' },
      { status: 503 }
    );
  }

  // The plan is derived from the tier, so a miss here is a seeding problem, not caller error
  const [planRecord] = await db
    .select()
    .from(apiPlans)
    .where(eq(apiPlans.id, plan))
    .limit(1);

  if (!planRecord) {
    return NextResponse.json(
      { error: `Configured plan '${plan}' is missing from api_plans` },
      { status: 500 }
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

  // Cap active keys per account
  const existingKeys = await listApiKeys(user.id);
  const activeKeys = existingKeys.filter((k) => k.isActive && !k.revokedAt);
  if (activeKeys.length >= MAX_ACTIVE_KEYS_PER_ACCOUNT) {
    return NextResponse.json(
      {
        error: `Maximum of ${MAX_ACTIVE_KEYS_PER_ACCOUNT} active API keys per account. Revoke an existing key to create a new one.`,
        code: 'KEY_LIMIT_REACHED',
      },
      { status: 409 }
    );
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
