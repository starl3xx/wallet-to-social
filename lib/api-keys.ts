import { createHash, randomBytes } from 'crypto';
import { eq, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { apiKeys, apiPlans, type ApiKey, type ApiPlan } from '@/db/schema';
import { API_PLANS } from '@/lib/api-plans';

// Key format: wts_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx (32 random chars)
const KEY_PREFIX = 'wts_live_';
const KEY_LENGTH = 32;

/**
 * Generates a cryptographically secure API key
 * Returns both the raw key (to show user once) and the hash (to store)
 */
export function generateApiKey(): { rawKey: string; hashedKey: string; prefix: string } {
  const randomPart = randomBytes(KEY_LENGTH).toString('base64url').slice(0, KEY_LENGTH);
  const rawKey = `${KEY_PREFIX}${randomPart}`;
  const hashedKey = hashApiKey(rawKey);
  const prefix = rawKey.slice(0, 12); // 'wts_live_xxx' for identification

  return { rawKey, hashedKey, prefix };
}

/**
 * Hashes an API key using SHA-256
 */
export function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

/**
 * Creates a new API key for a user
 */
export async function createApiKey(
  userId: string,
  name: string,
  planId: string
): Promise<{ key: ApiKey; rawKey: string } | null> {
  const db = getDb();
  if (!db) return null;

  const { rawKey, hashedKey, prefix } = generateApiKey();

  const [key] = await db
    .insert(apiKeys)
    .values({
      key: hashedKey,
      keyPrefix: prefix,
      name,
      userId,
      plan: planId,
    })
    .returning();

  return { key, rawKey };
}

/**
 * Atomically create a key only if the account is under its active-key cap.
 *
 * A read-then-insert in the route raced: concurrent POSTs could each see the
 * count under the cap and all insert. This does the count and the insert in a
 * single statement, and the `FOR UPDATE` lock on the account's users row
 * serializes concurrent creates for the same account (the second blocks, then
 * counts the first's key). The neon-http driver runs each statement as its own
 * transaction, so the lock is held for the statement's duration — no
 * interactive transaction needed.
 *
 * Returns { capReached: true } when the cap is hit (no row inserted).
 */
export async function createApiKeyIfUnderCap(
  userId: string,
  name: string,
  planId: string,
  maxActiveKeys: number
): Promise<{ key: ApiKey; rawKey: string } | { capReached: true } | null> {
  const db = getDb();
  if (!db) return null;

  const { rawKey, hashedKey, prefix } = generateApiKey();

  const result = (await db.execute(sql`
    WITH acct AS (
      SELECT id FROM users WHERE id = ${userId} FOR UPDATE
    ),
    active_count AS (
      SELECT count(*)::int AS n FROM api_keys
      WHERE user_id = ${userId} AND is_active = true AND revoked_at IS NULL
    )
    INSERT INTO api_keys (key, key_prefix, name, user_id, plan)
    SELECT ${hashedKey}, ${prefix}, ${name}, ${userId}, ${planId}
    FROM active_count, acct
    WHERE active_count.n < ${maxActiveKeys}
    RETURNING id, key, key_prefix, name, user_id, plan, is_active,
              rate_limit, daily_limit, monthly_limit, last_used_at,
              created_at, expires_at, revoked_at
  `)) as unknown as { rows: Array<Record<string, unknown>> };

  const row = result.rows[0];
  if (!row) return { capReached: true };

  const key: ApiKey = {
    id: row.id as string,
    key: row.key as string,
    keyPrefix: row.key_prefix as string,
    name: row.name as string,
    userId: row.user_id as string,
    plan: row.plan as string,
    rateLimit: (row.rate_limit as number | null) ?? null,
    dailyLimit: (row.daily_limit as number | null) ?? null,
    monthlyLimit: (row.monthly_limit as number | null) ?? null,
    isActive: row.is_active as boolean,
    lastUsedAt: row.last_used_at ? new Date(row.last_used_at as string) : null,
    createdAt: new Date(row.created_at as string),
    expiresAt: row.expires_at ? new Date(row.expires_at as string) : null,
    revokedAt: row.revoked_at ? new Date(row.revoked_at as string) : null,
  };

  return { key, rawKey };
}

/**
 * Validates an API key and returns the key record with plan details
 * Returns null if key is invalid, inactive, or expired
 */
export async function validateApiKey(
  rawKey: string
): Promise<{ key: ApiKey; plan: ApiPlan } | null> {
  const db = getDb();
  if (!db) return null;

  // Quick format check
  if (!rawKey.startsWith(KEY_PREFIX)) {
    return null;
  }

  const hashedKey = hashApiKey(rawKey);

  const result = await db
    .select({
      key: apiKeys,
      plan: apiPlans,
    })
    .from(apiKeys)
    .innerJoin(apiPlans, eq(apiKeys.plan, apiPlans.id))
    .where(eq(apiKeys.key, hashedKey))
    .limit(1);

  if (result.length === 0) {
    return null;
  }

  const { key, plan } = result[0];

  // Check if key is active
  if (!key.isActive) {
    return null;
  }

  // Check if key has been revoked
  if (key.revokedAt) {
    return null;
  }

  // Check if key has expired
  if (key.expiresAt && key.expiresAt < new Date()) {
    return null;
  }

  // Update last used timestamp (fire and forget)
  db.update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, key.id))
    .catch(console.error);

  return { key, plan };
}

/**
 * Revokes an API key
 */
export async function revokeApiKey(keyId: string, userId: string): Promise<boolean> {
  const db = getDb();
  if (!db) return false;

  const result = await db
    .update(apiKeys)
    .set({
      isActive: false,
      revokedAt: new Date(),
    })
    .where(eq(apiKeys.id, keyId))
    .returning();

  // Verify the key belonged to the user
  if (result.length === 0 || result[0].userId !== userId) {
    return false;
  }

  return true;
}

/**
 * Rotates an API key - revokes the old one and creates a new one with same settings
 */
export async function rotateApiKey(
  keyId: string,
  userId: string
): Promise<{ key: ApiKey; rawKey: string } | null> {
  const db = getDb();
  if (!db) return null;

  // Get the existing key
  const [existingKey] = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.id, keyId))
    .limit(1);

  if (!existingKey || existingKey.userId !== userId) {
    return null;
  }

  // Revoke the old key
  await db
    .update(apiKeys)
    .set({
      isActive: false,
      revokedAt: new Date(),
    })
    .where(eq(apiKeys.id, keyId));

  // Create new key with same settings
  const { rawKey, hashedKey, prefix } = generateApiKey();

  const [newKey] = await db
    .insert(apiKeys)
    .values({
      key: hashedKey,
      keyPrefix: prefix,
      name: existingKey.name,
      userId: existingKey.userId,
      plan: existingKey.plan,
      rateLimit: existingKey.rateLimit,
      dailyLimit: existingKey.dailyLimit,
      monthlyLimit: existingKey.monthlyLimit,
    })
    .returning();

  return { key: newKey, rawKey };
}

/**
 * Lists all API keys for a user (without exposing the actual key hash)
 */
export async function listApiKeys(userId: string): Promise<ApiKey[]> {
  const db = getDb();
  if (!db) return [];

  return db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.userId, userId))
    .orderBy(apiKeys.createdAt);
}

/**
 * Seeds the default API plans (run once on setup)
 */
export async function seedApiPlans(): Promise<void> {
  const db = getDb();
  if (!db) return;

  // Definitions live in lib/api-plans.ts so the seed, the tier mapping and the
  // pricing copy cannot drift apart.
  const plans = Object.values(API_PLANS);

  for (const plan of plans) {
    await db
      .insert(apiPlans)
      .values(plan)
      .onConflictDoUpdate({
        target: apiPlans.id,
        set: {
          name: plan.name,
          priceMonthly: plan.priceMonthly,
          requestsPerMinute: plan.requestsPerMinute,
          requestsPerDay: plan.requestsPerDay,
          requestsPerMonth: plan.requestsPerMonth,
          maxBatchSize: plan.maxBatchSize,
        },
      });
  }
}

/**
 * Gets all available API plans
 */
export async function getApiPlans(): Promise<ApiPlan[]> {
  const db = getDb();
  if (!db) return [];

  return db.select().from(apiPlans).orderBy(apiPlans.priceMonthly);
}
