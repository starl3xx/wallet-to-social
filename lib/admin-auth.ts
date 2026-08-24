import { NextRequest, NextResponse } from 'next/server';
import { createHash, timingSafeEqual } from 'crypto';

/**
 * Shared admin authentication for /api/admin/* routes.
 *
 * Replaces ~17 copies of `password === process.env.ADMIN_PASSWORD`, which had
 * three problems: the `===`/`!==` comparison is not constant-time (it leaks a
 * timing side-channel on length and first-difference), there was no attempt
 * limiting, and one route (seed-plans) had no check at all.
 *
 * The comparison is done over SHA-256 digests so it is always fixed-length
 * (length never leaks) and timingSafeEqual never short-circuits. A simple
 * per-IP lockout blunts online brute force; it is in-memory (per serverless
 * instance) which is imperfect across instances but far better than unlimited
 * guesses, and cheap. For anything stronger this should become session +
 * admin-role auth.
 */

const MAX_ATTEMPTS = 10;
const LOCKOUT_MS = 15 * 60 * 1000;

interface Attempts {
  count: number;
  firstAt: number;
}
const failuresByIp = new Map<string, Attempts>();

function clientIp(request: NextRequest): string {
  // Vercel sets x-vercel-forwarded-for to the real client IP; fall back to the
  // last XFF hop (nearest trusted proxy) rather than the spoofable first hop.
  const vercel = request.headers.get('x-vercel-forwarded-for');
  if (vercel) return vercel.trim();
  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    const hops = xff
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean);
    if (hops.length) return hops[hops.length - 1];
  }
  return 'unknown';
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

function isLockedOut(ip: string, now: number): boolean {
  const record = failuresByIp.get(ip);
  if (!record) return false;
  if (now - record.firstAt > LOCKOUT_MS) {
    failuresByIp.delete(ip);
    return false;
  }
  return record.count >= MAX_ATTEMPTS;
}

function recordFailure(ip: string, now: number): void {
  const record = failuresByIp.get(ip);
  if (!record || now - record.firstAt > LOCKOUT_MS) {
    failuresByIp.set(ip, { count: 1, firstAt: now });
  } else {
    record.count += 1;
  }
}

/**
 * Returns null when the caller is an authorized admin, or a 401/403/503
 * NextResponse to return directly otherwise.
 */
export function requireAdmin(request: NextRequest): NextResponse | null {
  const expected = process.env.ADMIN_PASSWORD;
  // Fail closed if unconfigured — never allow an empty-secret bypass
  if (!expected) {
    return NextResponse.json(
      { error: 'Admin access not configured' },
      { status: 503 }
    );
  }

  const ip = clientIp(request);
  const now = Date.now();

  if (isLockedOut(ip, now)) {
    return NextResponse.json(
      { error: 'Too many attempts. Try again later.' },
      { status: 429 }
    );
  }

  const provided = request.headers.get('x-admin-password') ?? '';
  // Fixed-length digests: timingSafeEqual requires equal lengths, and hashing
  // guarantees that regardless of input length, so nothing about the secret's
  // length or content leaks through timing.
  const ok = timingSafeEqual(sha256(provided), sha256(expected));

  if (!ok) {
    recordFailure(ip, now);
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  failuresByIp.delete(ip);
  return null;
}

/** Boolean form for call sites that branch inline. */
export function isAdmin(request: NextRequest): boolean {
  return requireAdmin(request) === null;
}
