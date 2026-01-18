import { createHash, randomBytes } from 'crypto';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { apiKeys, apiPlans, type ApiKey, type ApiPlan } from '@/db/schema';

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

  const plans: Array<{
    id: string;
    name: string;
    priceMonthly: number;
    requestsPerMinute: number;
    requestsPerDay: number;
    requestsPerMonth: number;
    maxBatchSize: number;
  }> = [
    {
      id: 'developer',
      name: 'Developer',
      priceMonthly: 4900, // $49
      requestsPerMinute: 60,
      requestsPerDay: 5000,
      requestsPerMonth: 50000,
      maxBatchSize: 50,
    },
    {
      id: 'startup',
      name: 'Startup',
      priceMonthly: 19900, // $199
      requestsPerMinute: 300,
      requestsPerDay: 50000,
      requestsPerMonth: 500000,
      maxBatchSize: 200,
    },
    {
      id: 'enterprise',
      name: 'Enterprise',
      priceMonthly: 79900, // $799
      requestsPerMinute: 1000,
      requestsPerDay: -1, // unlimited
      requestsPerMonth: -1, // unlimited
      maxBatchSize: 1000,
    },
  ];

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
