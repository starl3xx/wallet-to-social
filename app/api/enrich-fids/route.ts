import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { fetchFidsByUsernames, isNeynarConfigured } from '@/lib/neynar';
import { SESSION_COOKIE_NAME, validateSession } from '@/lib/auth';
import {
  checkIpRateLimit,
  formatRateLimitHeaders,
  getClientIp,
} from '@/lib/ip-rate-limiter';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * POST /api/enrich-fids
 * Takes a list of Farcaster usernames and returns their FIDs
 * Used to enrich old lookups that don't have fc_fid stored
 */
export async function POST(request: NextRequest) {
  try {
    const { usernames } = await request.json();

    if (!Array.isArray(usernames) || usernames.length === 0) {
      return NextResponse.json(
        { error: 'usernames array required' },
        { status: 400 }
      );
    }

    // Limit to 100 usernames per request to prevent abuse
    const limitedUsernames = usernames.slice(0, 100);

    /**
     * Everyone is bounded here, because every username in the body becomes
     * one upstream request billed to our own provider credential, and this
     * endpoint shipped with no bound at all: an open proxy for a credit pool
     * that has already been exhausted once this year.
     *
     * A missing or expired cookie is an anonymous caller, not an error, same
     * as `/api/reverse`. The session picks WHICH bucket, not whether one
     * applies: a signed-in history view legitimately sends thousands of
     * usernames in 100-name batches, and an account is free to mint, so a
     * session alone cannot mean unbounded. The buckets count usernames, not
     * requests, which is why the body is read first.
     */
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    const session = token ? await validateSession(token) : { user: null };

    const limit = await checkIpRateLimit(
      getClientIp(request),
      session.user ? '/api/enrich-fids:user' : '/api/enrich-fids',
      limitedUsernames.length
    );
    if (!limit.allowed) {
      return NextResponse.json(
        {
          error: session.user
            ? 'Enrichment limit reached for this hour. It resumes on its own.'
            : 'Too many requests. Sign in, or try again later.',
        },
        { status: 429, headers: formatRateLimitHeaders(limit) }
      );
    }

    if (!isNeynarConfigured()) {
      return NextResponse.json(
        { error: 'Neynar not configured' },
        { status: 503 }
      );
    }

    const apiKey = process.env.NEYNAR_API_KEY!;

    const fidMap = await fetchFidsByUsernames(limitedUsernames, apiKey);

    // Convert Map to plain object for JSON response
    const fids: Record<string, number> = {};
    for (const [username, fid] of fidMap) {
      fids[username] = fid;
    }

    return NextResponse.json({ fids });
  } catch (error) {
    console.error('Error enriching FIDs:', error);
    return NextResponse.json(
      { error: 'Failed to fetch FIDs' },
      { status: 500 }
    );
  }
}
