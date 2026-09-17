import { eq, and, inArray, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { ipRateLimitBuckets } from '@/db/schema';
import { NextRequest } from 'next/server';
import { ANON_MATCHES_PER_DAY } from '@/lib/match-gate';

// Rate limits for unauthenticated UI endpoints (strict to prevent scraping)
export const IP_RATE_LIMITS = {
  '/api/jobs': { limit: 3, windowHours: 1 },
  /**
   * Far looser than a lookup, because it costs incomparably less: one indexed
   * read of a table we already hold, no external request, no credits. The limit
   * is here to stop the endpoint being used to enumerate the index, not to
   * ration a scarce resource, and a stranger checking a dozen handles they know
   * is exactly the behaviour it exists for.
   */
  '/api/reachability': { limit: 60, windowHours: 1 },
  /**
   * FID enrichment for old saved lookups, which is the one endpoint here that
   * spends our own provider credits on the caller's behalf: each username in
   * the body becomes one upstream request, so these two buckets count
   * USERNAMES, not requests, via the limiter's `units` argument. A
   * request-shaped bound understated the exposure by the batch factor: 20
   * requests an hour reads as small and is 2,000 upstream calls.
   *
   * It shipped with no bound at all, which made it an open proxy for a
   * credential we pay for. Two buckets because the two callers differ by two
   * orders of magnitude, not in kind: an anonymous stranger checking a page
   * of names fits comfortably in 300; a signed-in account enriching a large
   * saved lookup legitimately sends thousands (the history view batches 100
   * a request), and 2,000 an hour lets that finish across a couple of views
   * while capping what a scripted signup can drain. Signing up is free, so a
   * session cannot mean unbounded.
   */
  '/api/enrich-fids': { limit: 300, windowHours: 1 },
  '/api/enrich-fids:user': { limit: 2000, windowHours: 1 },
  /**
   * The reverse lookup's free branch, which discloses exactly what
   * `/api/reachability` discloses: how many wallets carry a handle, never
   * which ones. Same cost, same disclosure, same bound.
   *
   * Only unentitled callers land here. A caller spending credits is already
   * bounded by the credits, and charging them an address-shaped limit as well
   * would refuse a paying customer for sharing an office with a stranger.
   */
  '/api/reverse': { limit: 60, windowHours: 1 },
  /**
   * The keyless single-wallet lookup behind the free tool page.
   *
   * Tighter than `/api/reachability` (60) because this one discloses the
   * identity rather than a count, and that identity is what a pack is sold on.
   * Loose enough that a person trying a handful of addresses they know never
   * meets it. Misses count too: a miss still costs a query and still tells a
   * prober the address is absent, so a bound that only counted hits would be a
   * bound on being right rather than on asking.
   */
  '/api/wallet-socials': { limit: 20, windowHours: 1 },
  /**
   * The MCP server, and only its keyless traffic.
   *
   * Every tool there passes the caller's own bearer key into a v1 handler,
   * which meters it per key exactly as the REST surface does. What that leaves
   * uncovered is the discovery handshake: `initialize` and `tools/list` reach
   * no handler, deliberately, so a client with no key or an empty balance can
   * still see what the server offers rather than meeting a 402 and concluding
   * the server is broken.
   *
   * That is a real unauthenticated endpoint, so it gets a real bound. 120 an
   * hour is generous for a handshake a client performs once per session and
   * mean for anything trying to use it as a free surface.
   *
   * The route decides which requests land here by JSON-RPC method, never by
   * whether an Authorization header is present. Gating on the header was the
   * first version and it was wrong: `Bearer hunter2` is not a key, and
   * treating any string in that header as evidence of metering left discovery
   * uncapped to anyone who sent one.
   *
   * Everything lands here except a body whose calls are all `tools/call`. That
   * one skips it because it reaches a handler that meters per key, and
   * charging it twice would refuse a paying caller for sharing an address with
   * a stranger. The allowlist is on the metered side on purpose: a version
   * that listed the handshake methods instead let every method nobody had
   * thought of through unbounded.
   */
  '/api/mcp': { limit: 120, windowHours: 1 },
  /**
   * The onchain rail's unauthenticated surface: the key-recovery challenge and
   * the signature that redeems it.
   *
   * Not the buy endpoint, which is bounded by the fact that every call costs a
   * real USDC payment. Recovery costs nothing to ask for, so it gets a bound of
   * its own: 30 an hour is far more than a person who has lost a key needs and
   * far less than is useful for grinding signatures at an address.
   */
  '/api/x402': { limit: 30, windowHours: 1 },
  /**
   * Dynamic client registration, which is an unauthenticated write.
   *
   * RFC 7591 is a table anybody may insert into by design, so the bound is
   * what stops it becoming a place to store arbitrary strings for free. Ten an
   * hour is far more than any real client needs: a client registers once and
   * then reuses its `client_id` forever, and Claude does not register at all
   * when it can read a metadata document instead, which it can here.
   */
  '/api/oauth/register': { limit: 10, windowHours: 1 },
  /**
   * The token endpoint, bounded per address because the credential it checks
   * is not a key we issued to the caller.
   *
   * An authorization code is guessable only at 2^256, so this is not what
   * stops a code being brute forced. It is what stops the endpoint being a
   * free oracle: every failure here reads a row and returns a distinguishable
   * error, and the refresh-reuse path writes. 120 an hour comfortably clears a
   * client refreshing hourly on several devices.
   */
  '/api/oauth/token': { limit: 120, windowHours: 1 },
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
 * The sliding-window estimate over two adjacent hourly buckets.
 *
 * A bare hourly bucket resets on the calendar hour, which doubles the burst
 * at the boundary: "3 an hour" was really "3 before :00 and 3 more after".
 * Measured, not hypothetical: on 2026-09-15 one IP pushed 6 lookup jobs
 * through in 17 minutes by hitting the wall at 14:58 and getting a fresh
 * bucket at 15:00. The estimate counts the previous hour's bucket at the
 * fraction of it still inside the rolling window, which is the standard
 * approximation: exact at the boundary, linear decay across the hour, and
 * never more permissive than a true rolling log by more than the
 * within-hour distribution error.
 */
export function slidingWindowCount(
  previousCount: number,
  currentCount: number,
  now: Date = new Date()
): number {
  const elapsedFraction =
    (now.getUTCMinutes() * 60 + now.getUTCSeconds()) / 3600;
  return previousCount * (1 - elapsedFraction) + currentCount;
}

/**
 * Seconds until one more request would be ALLOWED, assuming the caller
 * sends nothing in between.
 *
 * The naive answer, "the top of the next hour", lies in both directions
 * under a rolling window: the previous bucket can still carry enough
 * weight just after the boundary to refuse a caller who waited as told,
 * and a current bucket inflated by refused attempts (every attempt
 * counts, deliberately, so hammering is not free) keeps refusing PAST the
 * boundary while it decays as next hour's previous bucket. This solves
 * the decay for the actual admission moment across three regimes: within
 * this hour, within the next (when today's bucket is the decaying one),
 * and the boundary after that, by which both buckets have left the
 * window entirely.
 */
export function secondsUntilNextAllowed(
  previousCount: number,
  currentCount: number,
  limit: number,
  now: Date = new Date(),
  /**
   * What the retry will cost. Not always 1: `/api/enrich-fids` counts
   * USERNAMES, so a client retrying the same body spends its whole batch
   * again. Solving for 1 unit and handing that number to a hundred-unit
   * caller advises a retry that is refused on arrival, and since every
   * attempt counts against the bucket, the too-early retry inflates the
   * very number it is waiting on. The caller passes the same `units` it
   * was charged.
   */
  cost: number = 1
): number {
  const secOfHour = now.getUTCMinutes() * 60 + now.getUTCSeconds();

  // Within this hour: prev decays, cur stands, the retry lands as `cost`.
  if (currentCount + cost <= limit) {
    if (previousCount <= 0) return 0;
    const fNeeded =
      (previousCount + currentCount + cost - limit) / previousCount;
    if (fNeeded <= 0) return 0;
    if (fNeeded <= 1) {
      return Math.max(0, Math.ceil(fNeeded * 3600) - secOfHour);
    }
  }

  // The next hour: this hour's bucket is the decaying one, the retry is
  // `cost` against an empty current bucket.
  if (cost <= limit && currentCount > 0) {
    const fNext = 1 - (limit - cost) / currentCount;
    if (fNext <= 1) {
      return (
        3600 + Math.min(3600, Math.ceil(Math.max(0, fNext) * 3600)) - secOfHour
      );
    }
  }

  /**
   * Two boundaries out, both buckets have left the window entirely. Also
   * where a request larger than the whole limit lands: no wait admits it,
   * and this is the point past which the answer stops improving, which is
   * the most honest thing a Retry-After can say about it.
   */
  return 2 * 3600 - secOfHour;
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
  // Trust ONLY headers a caller can't forge. Previously this returned the
  // FIRST x-forwarded-for hop, which is fully client-controlled: sending a
  // random X-Forwarded-For per request minted a fresh bucket every time and
  // the "3/hour to prevent scraping" limits never fired.
  //
  // On Vercel, x-vercel-forwarded-for is set by the platform to the real
  // client IP and overwrites anything the caller sent — it is authoritative.
  const vercelForwardedFor = request.headers.get('x-vercel-forwarded-for');
  if (vercelForwardedFor) {
    // Single trusted value, but split defensively and take the first entry
    return vercelForwardedFor.split(',')[0]?.trim() || 'unknown';
  }

  // Cloudflare sets a single unspoofable connecting-IP value
  const cfConnectingIp = request.headers.get('cf-connecting-ip');
  if (cfConnectingIp) return cfConnectingIp.trim();

  // Generic x-forwarded-for: the LAST hop is the one appended by our own
  // trusted proxy; the leftmost entries are caller-supplied and unsafe.
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const hops = forwardedFor
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean);
    if (hops.length) return hops[hops.length - 1];
  }

  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp.trim();

  return 'unknown';
}

/**
 * Check and increment IP rate limit for an endpoint
 * Uses atomic UPSERT to prevent race conditions under concurrent load
 *
 * `units` is what one request costs against the bucket, default 1. An endpoint
 * whose cost scales with its body (enrich-fids: one upstream call per
 * username) passes the body size, so the configured limit bounds the actual
 * work rather than the number of envelopes it arrived in.
 */
export async function checkIpRateLimit(
  ipAddress: string,
  endpoint: RateLimitedEndpoint,
  units: number = 1
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

  const now = new Date();
  const bucketKey = getHourlyBucketKey(now);
  const previousBucketKey = getHourlyBucketKey(
    new Date(now.getTime() - 60 * 60 * 1000)
  );
  const resetAt = getResetTime(now);

  try {
    // Use atomic UPSERT to increment and return new count
    // This prevents race conditions where concurrent requests could exceed limits
    const result = await db
      .insert(ipRateLimitBuckets)
      .values({
        ipAddress,
        endpoint,
        bucketKey,
        count: units,
      })
      .onConflictDoUpdate({
        target: [
          ipRateLimitBuckets.ipAddress,
          ipRateLimitBuckets.endpoint,
          ipRateLimitBuckets.bucketKey,
        ],
        set: {
          count: sql`${ipRateLimitBuckets.count} + ${units}`,
          updatedAt: new Date(),
        },
      })
      .returning();

    const count = result[0]?.count ?? units;

    // The previous hour still counts for the fraction of it inside the
    // rolling window; see slidingWindowCount.
    const [previousBucket] = await db
      .select({ count: ipRateLimitBuckets.count })
      .from(ipRateLimitBuckets)
      .where(
        and(
          eq(ipRateLimitBuckets.ipAddress, ipAddress),
          eq(ipRateLimitBuckets.endpoint, endpoint),
          eq(ipRateLimitBuckets.bucketKey, previousBucketKey)
        )
      )
      .limit(1);

    const previousCount = previousBucket?.count ?? 0;
    const effective = slidingWindowCount(previousCount, count, now);
    const remaining = Math.max(0, Math.floor(config.limit - effective));
    const allowed = effective <= config.limit;

    // On refusal, resetAt and retryAfter state the actual admission
    // moment, not the hour boundary: a rolling window has no single reset,
    // and the boundary lies in both directions (see secondsUntilNextAllowed).
    const retryAfterSeconds = allowed
      ? undefined
      : Math.max(
          1,
          secondsUntilNextAllowed(
            previousCount,
            count,
            config.limit,
            now,
            units
          )
        );

    return {
      allowed,
      limit: config.limit,
      remaining,
      resetAt: retryAfterSeconds
        ? new Date(now.getTime() + retryAfterSeconds * 1000)
        : resetAt,
      retryAfter: retryAfterSeconds,
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
    const now = new Date();
    const previousBucketKey = getHourlyBucketKey(
      new Date(now.getTime() - 60 * 60 * 1000)
    );
    const rows = await db
      .select({
        bucketKey: ipRateLimitBuckets.bucketKey,
        count: ipRateLimitBuckets.count,
      })
      .from(ipRateLimitBuckets)
      .where(
        and(
          eq(ipRateLimitBuckets.ipAddress, ipAddress),
          eq(ipRateLimitBuckets.endpoint, endpoint),
          inArray(ipRateLimitBuckets.bucketKey, [bucketKey, previousBucketKey])
        )
      );

    const count = rows.find((r) => r.bucketKey === bucketKey)?.count ?? 0;
    const previousCount =
      rows.find((r) => r.bucketKey === previousBucketKey)?.count ?? 0;
    const effective = slidingWindowCount(previousCount, count, now);
    const remaining = Math.max(0, Math.floor(config.limit - effective));

    return {
      // The question status answers is "would a request succeed now", so it
      // predicts exactly what checkIpRateLimit computes after its
      // increment: effective plus one unit. A bare `effective < limit`
      // disagreed in the fractional gap under one unit.
      allowed: effective + 1 <= config.limit,
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
export function formatRateLimitHeaders(
  result: IpRateLimitResult
): Record<string, string> {
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
export async function cleanupOldIpBuckets(
  olderThanHours: number = 24
): Promise<number> {
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

/* ------------------------------------------------------------------ *
 * The anonymous match meter
 * ------------------------------------------------------------------ */

/**
 * A FIXED DAILY CAP, not a sliding window, and the difference is deliberate.
 *
 * Everything above this point buckets hourly and decays the previous bucket
 * across the current one. That maths is hour-bound in its bones: `3600` is
 * hardcoded in both `slidingWindowCount` and `secondsUntilNextAllowed`, and the
 * elapsed fraction is read off `getUTCMinutes`. `windowHours` in the config
 * above is therefore decorative: every entry says 1 because 1 is the only value
 * the code implements, and an invariant now asserts that so the field cannot
 * quietly start lying.
 *
 * Generalising that decay to a 24-hour window would be a real refactor of the
 * abuse path to buy a property a demo allowance does not need. A day's
 * allowance wants a hard edge that resets at midnight UTC, which a person can
 * predict and a script cannot smear. So this keeps the same table and takes its
 * own day-shaped key.
 *
 * ## Charged on offer, not on delivery
 *
 * The budget is spent when the job is ACCEPTED, for the size of the gate it is
 * granted, not for the matches it turns out to deliver. The gate is decided in
 * the request, where the IP is known; delivery happens later in a worker that
 * has no request and no IP. Carrying the address into the job to settle up
 * afterwards would mean storing a visitor's IP on a long-lived row, which is a
 * worse trade than a coarser meter.
 *
 * The practical effect is that a list matching three wallets still spends the
 * gate it reserved. That is the honest reading of "one demo a day", and it is
 * stated in the refusal the caller sees.
 */
const ANON_MATCH_ENDPOINT = 'jobs:anon-matches';

/**
 * Single lookups the free tool page can always answer, even when the day's
 * anonymous allowance is gone.
 *
 * The two share one bucket so total anonymous exposure does not double by
 * adding a second door into it. Sharing has one bad edge: the jobs path
 * reserves its whole gate up front, so a visitor who ran the list demo first
 * would arrive at the marketing page with nothing left and meet a 429 on a page
 * whose entire job is to answer. This is the reserve that edge case eats into.
 *
 * Small on purpose. Five answers is enough to see the product work and useless
 * as a free API.
 */
export const FREE_LOOKUP_FLOOR_PER_DAY = 5;

/** Midnight-to-midnight UTC, so the reset is a time a person can predict. */
function getDailyBucketKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export interface AnonMatchBudget {
  /** Matches this IP may still be offered today. */
  remaining: number;
  /** The whole daily allowance. */
  limit: number;
  /** When the allowance resets. */
  resetAt: Date;
}

function nextUtcMidnight(now: Date): Date {
  const d = new Date(now);
  d.setUTCHours(24, 0, 0, 0);
  return d;
}

/**
 * How much anonymous allowance this address has left today.
 *
 * Fails OPEN when the database is unavailable, matching every other limiter
 * here: a meter that refuses a stranger because our own database is down turns
 * an outage into a wall, and the exposure is one day of one IP.
 */
export async function getAnonMatchBudget(
  ipAddress: string,
  now: Date = new Date(),
  /**
   * `floor` raises the day's allowance for ONE caller without raising it for
   * the shared bucket: the tool page passes `FREE_LOOKUP_FLOOR_PER_DAY` so it
   * still answers after the list demo has spent everything. Omitted everywhere
   * else, which is what keeps the jobs rail at the flat cap.
   */
  options?: { floor?: number }
): Promise<AnonMatchBudget> {
  /**
   * ADDED to the shared cap, not maxed against it, and the difference is the
   * whole point. `Math.max(50, 5)` is 50, which is no floor at all: the tool
   * would still read zero the moment the jobs rail drained the day. Adding it
   * means that once the shared 50 is spent, this caller still sees `floor`
   * remaining, which is exactly the reserve the marketing page needs.
   */
  const limit = ANON_MATCHES_PER_DAY + (options?.floor ?? 0);
  const resetAt = nextUtcMidnight(now);
  const db = getDb();
  if (!db) return { remaining: limit, limit, resetAt };

  try {
    const rows = await db
      .select({ count: ipRateLimitBuckets.count })
      .from(ipRateLimitBuckets)
      .where(
        and(
          eq(ipRateLimitBuckets.ipAddress, ipAddress),
          eq(ipRateLimitBuckets.endpoint, ANON_MATCH_ENDPOINT),
          eq(ipRateLimitBuckets.bucketKey, getDailyBucketKey(now))
        )
      );
    const used = rows[0]?.count ?? 0;
    return { remaining: Math.max(0, limit - used), limit, resetAt };
  } catch (error) {
    console.error('Anon match budget read failed:', error);
    return { remaining: limit, limit, resetAt };
  }
}

/**
 * Spend `units` of today's anonymous allowance for this address.
 *
 * Upserts with an atomic `count = count + units`, so two jobs submitted at once
 * from one address cannot both read the same remainder and both spend it. The
 * read above is advisory; this is the number that binds.
 */
export async function consumeAnonMatchBudget(
  ipAddress: string,
  units: number,
  now: Date = new Date()
): Promise<void> {
  if (units <= 0) return;
  const db = getDb();
  if (!db) return;

  try {
    await db
      .insert(ipRateLimitBuckets)
      .values({
        ipAddress,
        endpoint: ANON_MATCH_ENDPOINT,
        bucketKey: getDailyBucketKey(now),
        count: units,
      })
      .onConflictDoUpdate({
        target: [
          ipRateLimitBuckets.ipAddress,
          ipRateLimitBuckets.endpoint,
          ipRateLimitBuckets.bucketKey,
        ],
        set: {
          count: sql`${ipRateLimitBuckets.count} + ${units}`,
          updatedAt: new Date(),
        },
      });
  } catch (error) {
    // Never fail a submission because the meter could not be written: the job
    // is already valid and the exposure is one day of one address.
    console.error('Anon match budget write failed:', error);
  }
}
