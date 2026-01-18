import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { users, apiKeys } from '@/db/schema';
import { revokeApiKey, rotateApiKey } from '@/lib/api-keys';

export const runtime = 'nodejs';

/**
 * DELETE /api/developer/keys/[id]
 * Revoke an API key
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: keyId } = await params;
  const email = request.nextUrl.searchParams.get('email');

  if (!email) {
    return NextResponse.json(
      { error: 'Email parameter required' },
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

  // Verify key belongs to user
  const [key] = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.id, keyId))
    .limit(1);

  if (!key) {
    return NextResponse.json(
      { error: 'API key not found' },
      { status: 404 }
    );
  }

  if (key.userId !== user.id) {
    return NextResponse.json(
      { error: 'Unauthorized to revoke this key' },
      { status: 403 }
    );
  }

  // Revoke the key
  const success = await revokeApiKey(keyId, user.id);

  if (!success) {
    return NextResponse.json(
      { error: 'Failed to revoke API key' },
      { status: 500 }
    );
  }

  return NextResponse.json({
    message: 'API key revoked successfully',
    key_id: keyId,
  });
}

/**
 * POST /api/developer/keys/[id]
 * Rotate an API key (revoke old, create new with same settings)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: keyId } = await params;

  let body: { email: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 }
    );
  }

  const { email } = body;

  if (!email) {
    return NextResponse.json(
      { error: 'Email field required in body' },
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

  // Verify key belongs to user
  const [key] = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.id, keyId))
    .limit(1);

  if (!key) {
    return NextResponse.json(
      { error: 'API key not found' },
      { status: 404 }
    );
  }

  if (key.userId !== user.id) {
    return NextResponse.json(
      { error: 'Unauthorized to rotate this key' },
      { status: 403 }
    );
  }

  // Rotate the key
  const result = await rotateApiKey(keyId, user.id);

  if (!result) {
    return NextResponse.json(
      { error: 'Failed to rotate API key' },
      { status: 500 }
    );
  }

  return NextResponse.json({
    message: 'API key rotated successfully. Store this new key securely - it will not be shown again.',
    old_key_id: keyId,
    new_key: {
      id: result.key.id,
      name: result.key.name,
      prefix: result.key.keyPrefix,
      plan: result.key.plan,
      api_key: result.rawKey, // Only shown on creation!
      created_at: result.key.createdAt.toISOString(),
    },
  });
}
