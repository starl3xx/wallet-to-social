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
    /**
     * A missing or expired cookie is an anonymous caller, not an error, same
     * as `/api/reverse`. The session decides which bound applies, not whether
     * the endpoint answers.
     *
     * A signed-in caller passes: enriching a large saved lookup takes dozens
     * of batched calls from their own history view, and an account is already
     * something we can see and refuse individually. An anonymous caller gets
     * the IP bound, because every username in the body becomes one upstream
     * request billed to our credential, and this endpoint shipped with no
     * bound at all: an open proxy for a credit pool that has already been
     * exhausted once this year.
     */
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    const session = token ? await validateSession(token) : { user: null };

    if (!session.user) {
      const limit = await checkIpRateLimit(
        getClientIp(request),
        '/api/enrich-fids'
      );
      if (!limit.allowed) {
        return NextResponse.json(
          { error: 'Too many requests. Sign in, or try again later.' },
          { status: 429, headers: formatRateLimitHeaders(limit) }
        );
      }
    }

    const { usernames } = await request.json();

    if (!Array.isArray(usernames) || usernames.length === 0) {
      return NextResponse.json(
        { error: 'usernames array required' },
        { status: 400 }
      );
    }

    if (!isNeynarConfigured()) {
      return NextResponse.json(
        { error: 'Neynar not configured' },
        { status: 503 }
      );
    }

    const apiKey = process.env.NEYNAR_API_KEY!;

    // Limit to 100 usernames per request to prevent abuse
    const limitedUsernames = usernames.slice(0, 100);

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
