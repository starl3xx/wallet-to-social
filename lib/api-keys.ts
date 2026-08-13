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
 * Create a key only if the account is under its active-key cap, correct under
 * concurrency.
 *
 * A count-then-insert races, and so does a single statement that both counts
 * and inserts: under READ COMMITTED each concurrent statement's count snapshot
 * predates the others' inserts, so a `FOR UPDATE` lock serializes the writes
 * but every statement still sees the pre-insert total. Verified empirically —
 * a 20-way burst overshot a cap of 3 to 14. The neon-http driver has no
 * interactive transactions, so we can't lock-then-conditionally-insert either.
 *
 * Instead: insert unconditionally, then self-heal. Rank this key among the
 * account's currently-active keys by the fixed `(created_at, id)` order and
 * revoke it if its rank exceeds the cap. This converges to exactly `cap`
 * survivors no matter how the inserts interleave: the lowest-`cap` keys always
 * see rank ≤ cap (nothing ordered before them ever revokes), and every excess
 * key always sees rank ≥ cap+1 (the cap survivors are always counted ahead of
 * it), so it revokes itself. Stale snapshots only ever inflate the count-ahead,
 * which can never make an excess key wrongly survive.
 *
 * Returns { capReached: true } when this key was over the cap and revoked.
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

  // 1. Insert unconditionally.
  const [key] = await db
    .insert(apiKeys)
    .values({ key: hashedKey, keyPrefix: prefix, name, userId, plan: planId })
    .returning();
  if (!key) return null;

  // 2. Self-heal: revoke this key if it is beyond the cap by rank order.
  const healed = (await db.execute(sql`
    WITH ranked AS (
      SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn
      FROM api_keys
      WHERE user_id = ${userId} AND is_active = true AND revoked_at IS NULL
    )
    UPDATE api_keys
    SET is_active = false, revoked_at = now()
    WHERE id = ${key.id}
      AND (SELECT rn FROM ranked WHERE ranked.id = ${key.id}) > ${maxActiveKeys}
    RETURNING id
  `)) as unknown as { rows: Array<{ id: string }> };

  if (healed.rows.length > 0) {
    return { capReached: true };
  }

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
