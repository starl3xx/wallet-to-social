/**
 * RFC 7009 token revocation.
 *
 * Answers 200 whether or not the token existed, which the specification
 * requires and which is also the only honest behaviour: the caller is a public
 * client that authenticates with nothing, so telling it whether a string was a
 * live token would make this an oracle for guessing them.
 *
 * Revoking either credential ends the whole grant. A client that revokes its
 * access token and keeps refreshing has not revoked anything, and a person who
 * clicks disconnect means the connection, not one of the two strings it is
 * currently made of.
 *
 * ## The limit, and why it is read before the lookup
 *
 * A string that is neither token shape is answered 200 before any read: no
 * row can match it. A well-formed token that names nothing is counted per
 * address under `/api/oauth/revoke`; one that names a grant is never counted,
 * because hosted clients revoke from their provider's shared outbound
 * addresses when a person disconnects.
 *
 * The bucket is read before the lookup and charged after it, only on a miss.
 * While it is spent the answer is 503 with `Retry-After` (RFC 7009 section
 * 2.2.1), given before any lookup, so a live token and a dead one are refused
 * alike. A refusal decided after the lookup would answer the two differently,
 * which is the distinction the paragraph above rules out.
 */
import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { apiKeys } from '@/db/schema';
import { hashApiKey } from '@/lib/api-keys';
import {
  checkIpRateLimit,
  getClientIp,
  getIpRateLimitStatus,
} from '@/lib/ip-rate-limiter';
import {
  grantIdForRefreshToken,
  isWellFormedAccessToken,
  isWellFormedRefreshToken,
  revokeGrant,
} from '@/lib/oauth/grants';

export const runtime = 'nodejs';

const OK = new NextResponse(null, {
  status: 200,
  headers: { 'Cache-Control': 'no-store' },
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  let token: string | null = null;
  try {
    token = new URLSearchParams(await request.text()).get('token');
  } catch {
    return OK;
  }
  if (!token) return OK;

  // Neither shape we mint, so no row can match it. RFC 7009 section 2.2
  // answers an invalid token with 200, and this one costs nothing to answer.
  const isRefresh = isWellFormedRefreshToken(token);
  if (!isRefresh && !isWellFormedAccessToken(token)) return OK;

  const ip = getClientIp(request);
  const status = await getIpRateLimitStatus(ip, '/api/oauth/revoke');
  if (!status.allowed) {
    return NextResponse.json(
      {
        error: 'temporarily_unavailable',
        error_description:
          'Too many revocation requests from this address. Try again later.',
      },
      {
        status: 503,
        headers: {
          'Cache-Control': 'no-store',
          'Retry-After': String(status.retryAfter ?? 60),
        },
      }
    );
  }

  const db = getDb();
  if (!db) return OK;

  let grantId: string | null;
  if (isRefresh) {
    // A refresh token, current, already rotated, or rotated out in the
    // latest burst: the match a refresh makes. The rotated cases matter: a
    // client revoking the token it holds should succeed even if it refreshed
    // in between, and revoking is not an operation worth failing closed on.
    grantId = await grantIdForRefreshToken(token);
  } else {
    // An access token, which is an api_keys row carrying the grant id.
    const [key] = await db
      .select({ grantId: apiKeys.oauthGrantId })
      .from(apiKeys)
      .where(eq(apiKeys.key, hashApiKey(token)))
      .limit(1);
    grantId = key?.grantId ?? null;
  }

  if (grantId) {
    await revokeGrant(grantId, 'revoked by the client');
    return OK;
  }

  // Named nothing: the one outcome that is counted.
  await checkIpRateLimit(ip, '/api/oauth/revoke');
  return OK;
}
