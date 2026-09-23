/**
 * The connected applications a person can see and disconnect.
 *
 * Session-authenticated, not token-authenticated: this is the account holder
 * managing their own connections from a browser, so it is the sign-in cookie
 * that matters here and never a bearer token. A token that could revoke its own
 * grant is `/api/oauth/revoke`, which is a different endpoint for a different
 * caller.
 *
 * Not behind `requireDeveloperAccess`, which until 2026-09-21 also required
 * live credits: somebody on the free allowance can connect Claude, so they
 * must be able to disconnect it, and an account whose credits ran out must
 * not lose the ability to cut off an application it no longer trusts.
 *
 * That credit requirement is gone, so the two routes no longer disagree. This
 * one still resolves its own session rather than borrowing the guard, because
 * the guard's ownership check is written around an email a caller passes and
 * there is nothing to pass here.
 */
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { users } from '@/db/schema';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth';
import { listGrants, revokeGrant } from '@/lib/oauth/grants';

export const runtime = 'nodejs';

async function accountId(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  const { user } = await validateSession(token);
  if (!user) return null;
  const db = getDb();
  if (!db) return null;
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, user.email.toLowerCase()))
    .limit(1);
  return row?.id ?? null;
}

export async function GET(): Promise<NextResponse> {
  const userId = await accountId();
  if (!userId) {
    return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  }
  const grants = await listGrants(userId);
  return NextResponse.json({
    connections: grants.map((g) => ({
      id: g.id,
      label: g.clientLabel,
      // A metadata-document client's host, with its self-declared name in
      // front when it gave one; a registered client's reply host at approval.
      // `client_id` itself is not returned: for a registered client it is an
      // opaque string that tells a person nothing.
      connected_at: g.createdAt.toISOString(),
      last_used_at: g.lastUsedAt?.toISOString() ?? null,
    })),
  });
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const userId = await accountId();
  if (!userId) {
    return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  }

  const id = request.nextUrl.searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'Which connection?' }, { status: 400 });
  }

  /**
   * Ownership is checked by listing this account's own grants and looking for
   * the id, rather than by revoking on the id alone.
   *
   * `revokeGrant` takes an id and does not know whose it is, which is correct
   * for a function called from the token endpoint after a replay. Here the
   * caller supplies the id, so it has to be one of theirs, and an id that is
   * not gets the same answer as an id that does not exist.
   */
  const grants = await listGrants(userId);
  if (!grants.some((g) => g.id === id)) {
    return NextResponse.json({ error: 'No such connection.' }, { status: 404 });
  }

  await revokeGrant(id, 'disconnected by the account holder');
  return NextResponse.json({ ok: true });
}
