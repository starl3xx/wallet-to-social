import { eq, and, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { ipRateLimitBuckets } from '@/db/schema';
import { NextRequest } from 'next/server';

// Rate limits for unauthenticated UI endpoints (strict to prevent scraping)
export const IP_RATE_LIMITS = {
  '/api/lookup': { limit: 3, windowHours: 1 },
  '/api/jobs': { limit: 3, windowHours: 1 },
} as const;

export type RateLimitedEndpoint = keyof typeof IP_RATE_LIMITS;

export interface IpRateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: Date;
  retryAfter?: number; // seconds until retry
}

/**
 * Gets the hourly bucket key for rate limiting
 * Format: YYYY-MM-DDTHH (hourly granularity)
 */
function getHourlyBucketKey(date: Date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hour = String(date.getUTCHours()).padStart(2, '0');
  return `${year}-${month}-${day}T${hour}`;
}

/**
 * Gets the reset time (start of next hour)
 */
function getResetTime(date: Date = new Date()): Date {
  const reset = new Date(date);
  reset.setUTCMinutes(0, 0, 0);
  reset.setUTCHours(reset.getUTCHours() + 1);
  return reset;
}

/**
 * Extracts the client IP from a Next.js request
 * Handles various proxy headers and falls back to connection IP
 */
export function getClientIp(request: NextRequest): string {
  // Check standard proxy headers in order of preference
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    // x-forwarded-for can contain multiple IPs: client, proxy1, proxy2
    // The first one is the original client
    const firstIp = forwardedFor.split(',')[0]?.trim();
    if (firstIp) return firstIp;
  }

  // Vercel-specific header
  const vercelForwardedFor = request.headers.get('x-vercel-forwarded-for');
  if (vercelForwardedFor) {
    return vercelForwardedFor.split(',')[0]?.trim() || 'unknown';
  }

  // Real IP header (nginx, cloudflare)
  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp;

  // CF-Connecting-IP (Cloudflare)
  const cfConnectingIp = request.headers.get('cf-connecting-ip');
  if (cfConnectingIp) return cfConnectingIp;

  // Fallback
  return 'unknown';
}

/**
 * Check and increment IP rate limit for an endpoint
 * Uses atomic UPSERT to prevent race conditions under concurrent load
 */
export async function checkIpRateLimit(
  ipAddress: string,
  endpoint: RateLimitedEndpoint
): Promise<IpRateLimitResult> {
  const config = IP_RATE_LIMITS[endpoint];
  const db = getDb();

  // Fail open if DB unavailable (allow request but log warning)
  if (!db) {
    console.warn('IP rate limiter: Database not available, allowing request');
    return {
      allowed: true,
      limit: config.limit,
      remaining: config.limit,
      resetAt: getResetTime(),
    };
  }

  const bucketKey = getHourlyBucketKey();
  const resetAt = getResetTime();

  try {
    // Use atomic UPSERT to increment and return new count
    // This prevents race conditions where concurrent requests could exceed limits
    const result = await db
      .insert(ipRateLimitBuckets)
      .values({
        ipAddress,
        endpoint,
        bucketKey,
        count: 1,
      })
      .onConflictDoUpdate({
        target: [
          ipRateLimitBuckets.ipAddress,
          ipRateLimitBuckets.endpoint,
          ipRateLimitBuckets.bucketKey,
        ],
        set: {
          count: sql`${ipRateLimitBuckets.count} + 1`,
          updatedAt: new Date(),
        },
      })
      .returning();

    const count = result[0]?.count ?? 1;
    const remaining = Math.max(0, config.limit - count);
    const allowed = count <= config.limit;

    return {
      allowed,
      limit: config.limit,
      remaining,
      resetAt,
      retryAfter: allowed ? undefined : Math.ceil((resetAt.getTime() - Date.now()) / 1000),
    };
  } catch (error) {
    // Fail open on errors but log them
    console.error('IP rate limiter error:', error);
    return {
      allowed: true,
      limit: config.limit,
      remaining: config.limit,
      resetAt,
    };
  }
}

/**
 * Get current rate limit status without incrementing (for debugging/monitoring)
 */
export async function getIpRateLimitStatus(
  ipAddress: string,
  endpoint: RateLimitedEndpoint
): Promise<IpRateLimitResult> {
  const config = IP_RATE_LIMITS[endpoint];
  const db = getDb();

  if (!db) {
    return {
      allowed: true,
      limit: config.limit,
      remaining: config.limit,
      resetAt: getResetTime(),
    };
  }

  const bucketKey = getHourlyBucketKey();
  const resetAt = getResetTime();

  try {
    const [bucket] = await db
      .select()
      .from(ipRateLimitBuckets)
      .where(
        and(
          eq(ipRateLimitBuckets.ipAddress, ipAddress),
          eq(ipRateLimitBuckets.endpoint, endpoint),
          eq(ipRateLimitBuckets.bucketKey, bucketKey)
        )
      )
      .limit(1);

    const count = bucket?.count ?? 0;
    const remaining = Math.max(0, config.limit - count);

    return {
      allowed: count < config.limit,
      limit: config.limit,
      remaining,
      resetAt,
    };
  } catch (error) {
    console.error('IP rate limit status check error:', error);
    return {
      allowed: true,
      limit: config.limit,
      remaining: config.limit,
      resetAt,
    };
  }
}

/**
 * Format rate limit headers for HTTP responses
 */
export function formatRateLimitHeaders(result: IpRateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
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
 * Cleanup old IP rate limit buckets (call periodically via cron)
 * Keeps only recent buckets to prevent table bloat
 */
export async function cleanupOldIpBuckets(olderThanHours: number = 24): Promise<number> {
  const db = getDb();
  if (!db) return 0;

  const cutoff = new Date();
  cutoff.setHours(cutoff.getHours() - olderThanHours);

  try {
    const result = await db
      .delete(ipRateLimitBuckets)
      .where(sql`${ipRateLimitBuckets.createdAt} < ${cutoff}`)
      .returning();

    return result.length;
  } catch (error) {
    console.error('IP rate limit cleanup error:', error);
    return 0;
  }
}
