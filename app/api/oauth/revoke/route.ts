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
 */
import { NextRequest, NextResponse } from 'next/server';
import { eq, or } from 'drizzle-orm';
import { getDb } from '@/db';
import { apiKeys, oauthGrants } from '@/db/schema';
import { hashApiKey } from '@/lib/api-keys';
import { sha256 } from '@/lib/oauth/requests';
import { revokeGrant } from '@/lib/oauth/grants';

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

  const db = getDb();
  if (!db) return OK;

  // A refresh token, current or already rotated. The rotated case matters:
  // a client revoking the token it holds should succeed even if it refreshed
  // in between, and revoking is not an operation worth failing closed on.
  const refreshHash = sha256(token);
  const [grant] = await db
    .select({ id: oauthGrants.id })
    .from(oauthGrants)
    .where(
      or(
        eq(oauthGrants.refreshTokenHash, refreshHash),
        eq(oauthGrants.previousRefreshTokenHash, refreshHash)
      )
    )
    .limit(1);

  if (grant) {
    await revokeGrant(grant.id, 'revoked by the client');
    return OK;
  }

  // Or an access token, which is an api_keys row carrying the grant id.
  const [key] = await db
    .select({ grantId: apiKeys.oauthGrantId })
    .from(apiKeys)
    .where(eq(apiKeys.key, hashApiKey(token)))
    .limit(1);

  if (key?.grantId) {
    await revokeGrant(key.grantId, 'revoked by the client');
  }

  return OK;
}
