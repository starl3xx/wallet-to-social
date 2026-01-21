import { eq, and, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { rateLimitBuckets, type ApiKey, type ApiPlan } from '@/db/schema';

export type BucketType = 'minute' | 'day' | 'month';

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: Date;
  retryAfter?: number; // seconds until retry
}

export interface RateLimitHeaders {
  [key: string]: string | undefined;
  'X-RateLimit-Limit': string;
  'X-RateLimit-Remaining': string;
  'X-RateLimit-Reset': string;
  'Retry-After'?: string;
}

/**
 * Gets the current bucket key for a given bucket type
 */
function getBucketKey(type: BucketType, date: Date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hour = String(date.getUTCHours()).padStart(2, '0');
  const minute = String(date.getUTCMinutes()).padStart(2, '0');

  switch (type) {
    case 'minute':
      return `${year}-${month}-${day}T${hour}:${minute}`;
    case 'day':
      return `${year}-${month}-${day}`;
    case 'month':
      return `${year}-${month}`;
  }
}

/**
 * Gets the reset time for a given bucket type
 */
function getResetTime(type: BucketType, date: Date = new Date()): Date {
  const reset = new Date(date);

  switch (type) {
    case 'minute':
      reset.setUTCSeconds(0, 0);
      reset.setUTCMinutes(reset.getUTCMinutes() + 1);
      break;
    case 'day':
      reset.setUTCHours(0, 0, 0, 0);
      reset.setUTCDate(reset.getUTCDate() + 1);
      break;
    case 'month':
      reset.setUTCHours(0, 0, 0, 0);
      reset.setUTCDate(1);
      reset.setUTCMonth(reset.getUTCMonth() + 1);
      break;
  }

  return reset;
}

/**
 * Gets the limit for a bucket type from key/plan
 */
function getLimit(type: BucketType, key: ApiKey, plan: ApiPlan): number {
  switch (type) {
    case 'minute':
      return key.rateLimit ?? plan.requestsPerMinute;
    case 'day':
      return key.dailyLimit ?? plan.requestsPerDay;
    case 'month':
      return key.monthlyLimit ?? plan.requestsPerMonth;
  }
}

/**
 * Checks rate limit for a single bucket type
 * Returns null if unlimited (-1)
 * Uses atomic UPSERT to prevent race conditions under concurrent load
 */
async function checkBucket(
  apiKeyId: string,
  type: BucketType,
  limit: number,
  increment: number = 1
): Promise<RateLimitResult | null> {
  // -1 means unlimited
  if (limit === -1) {
    return null;
  }

  const db = getDb();
  if (!db) {
    // Fail open if DB unavailable
    return null;
  }

  const bucketKey = getBucketKey(type);
  const resetAt = getResetTime(type);

  let count: number;

  if (increment > 0) {
    // Use atomic UPSERT to prevent race conditions
    // ON CONFLICT updates count atomically, preventing undercounting under concurrency
    const result = await db
      .insert(rateLimitBuckets)
      .values({
        apiKeyId,
        bucketType: type,
        bucketKey,
        count: increment,
      })
      .onConflictDoUpdate({
        target: [rateLimitBuckets.apiKeyId, rateLimitBuckets.bucketType, rateLimitBuckets.bucketKey],
        set: {
          count: sql`${rateLimitBuckets.count} + ${increment}`,
          updatedAt: new Date(),
        },
      })
      .returning();

    count = result[0]?.count ?? increment;
  } else {
    // Just reading, no increment needed
    const [existingBucket] = await db
      .select()
      .from(rateLimitBuckets)
      .where(
        and(
          eq(rateLimitBuckets.apiKeyId, apiKeyId),
          eq(rateLimitBuckets.bucketType, type),
          eq(rateLimitBuckets.bucketKey, bucketKey)
        )
      )
      .limit(1);

    count = existingBucket?.count ?? 0;
  }

  const remaining = Math.max(0, limit - count);
  const allowed = count <= limit;

  return {
    allowed,
    limit,
    remaining,
    resetAt,
    retryAfter: allowed ? undefined : Math.ceil((resetAt.getTime() - Date.now()) / 1000),
  };
}

/**
 * Checks all rate limits for an API key
 * Returns the most restrictive limit that failed, or success if all pass
 */
export async function checkRateLimit(
  key: ApiKey,
  plan: ApiPlan,
  credits: number = 1
): Promise<{ allowed: boolean; result: RateLimitResult; headers: RateLimitHeaders }> {
  const bucketTypes: BucketType[] = ['minute', 'day', 'month'];

  // Check each bucket type, starting with most restrictive (minute)
  for (const type of bucketTypes) {
    const limit = getLimit(type, key, plan);
    const result = await checkBucket(key.id, type, limit, credits);

    if (result && !result.allowed) {
      return {
        allowed: false,
        result,
        headers: formatHeaders(result),
      };
    }
  }

  // All checks passed - return minute bucket info for headers
  const minuteLimit = getLimit('minute', key, plan);
  const minuteResult = await checkBucket(key.id, 'minute', minuteLimit, 0); // 0 to just read

  const result: RateLimitResult = minuteResult ?? {
    allowed: true,
    limit: minuteLimit,
    remaining: minuteLimit,
    resetAt: getResetTime('minute'),
  };

  return {
    allowed: true,
    result,
    headers: formatHeaders(result),
  };
}

/**
 * Preview rate limit status without incrementing
 */
export async function getRateLimitStatus(
  key: ApiKey,
  plan: ApiPlan
): Promise<{
  minute: RateLimitResult | null;
  day: RateLimitResult | null;
  month: RateLimitResult | null;
}> {
  const db = getDb();
  if (!db) {
    return { minute: null, day: null, month: null };
  }

  const bucketTypes: BucketType[] = ['minute', 'day', 'month'];
  const results: Record<BucketType, RateLimitResult | null> = {
    minute: null,
    day: null,
    month: null,
  };

  for (const type of bucketTypes) {
    const limit = getLimit(type, key, plan);
    if (limit === -1) {
      continue;
    }

    const bucketKey = getBucketKey(type);
    const resetAt = getResetTime(type);

    const [bucket] = await db
      .select()
      .from(rateLimitBuckets)
      .where(
        and(
          eq(rateLimitBuckets.apiKeyId, key.id),
          eq(rateLimitBuckets.bucketType, type),
          eq(rateLimitBuckets.bucketKey, bucketKey)
        )
      )
      .limit(1);

    const count = bucket?.count ?? 0;
    results[type] = {
      allowed: count < limit,
      limit,
      remaining: Math.max(0, limit - count),
      resetAt,
    };
  }

  return results;
}

/**
 * Formats rate limit headers
 */
function formatHeaders(result: RateLimitResult): RateLimitHeaders {
  const headers: RateLimitHeaders = {
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(Math.floor(result.resetAt.getTime() / 1000)),
  };

  if (result.retryAfter) {
    headers['Retry-After'] = String(result.retryAfter);
  }

  return headers;
}

/**
 * Cleans up old rate limit buckets (call periodically via cron)
 */
export async function cleanupOldBuckets(olderThanDays: number = 7): Promise<number> {
  const db = getDb();
  if (!db) return 0;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - olderThanDays);

  const result = await db
    .delete(rateLimitBuckets)
    .where(sql`${rateLimitBuckets.createdAt} < ${cutoff}`)
    .returning();

  return result.length;
}
