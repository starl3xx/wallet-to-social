/**
 * The consent decision.
 *
 * The authorization request itself was validated and stored by
 * `app/oauth/authorize/page.tsx` before this endpoint could be reached, so the
 * only thing arriving here is an opaque request id and a yes or a no. That is
 * the whole reason the flow is split in two: nothing a client supplied is
 * re-parsed at the moment a person clicks a button.
 *
 * ## Why there is no CSRF token
 *
 * The session cookie is `sameSite: 'lax'`, which browsers do not attach to a
 * cross-site POST. A page on another origin can therefore submit this form and
 * it arrives unauthenticated, which is refused below like any other signed-out
 * request. The protection is the cookie policy, checked in `lib/auth.ts`, not a
 * hidden field nobody validates. `scripts/check-invariants.ts` asserts the
 * policy rather than trusting this paragraph, because that is exactly the shape
 * of comment this repository has shipped wrong four times.
 */
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth';
import { getOrCreateUser } from '@/lib/access';
import { loadPendingRequest, issueCode } from '@/lib/oauth/requests';
import { createGrant } from '@/lib/oauth/grants';
import { resolveClient, redirectUriAllowed } from '@/lib/oauth/clients';
import { issuer } from '@/lib/oauth/metadata';

export const runtime = 'nodejs';

function fail(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Build the redirect back to the client.
 *
 * `iss` is on every response including the error ones, per RFC 9207, and the
 * authorization server metadata advertises that it is. A client that records
 * our issuer and compares it here cannot be talked into sending its code to a
 * different server that answered first.
 */
function clientRedirect(
  redirectUri: string,
  params: Record<string, string | null>
): string {
  const url = new URL(redirectUri);
  url.searchParams.set('iss', issuer());
  for (const [key, value] of Object.entries(params)) {
    if (value !== null) url.searchParams.set(key, value);
  }
  return url.toString();
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail('Malformed request.', 400);
  }
  const input = body as { req?: unknown; approve?: unknown };
  if (typeof input.req !== 'string' || typeof input.approve !== 'boolean') {
    return fail('Malformed request.', 400);
  }

  const sessionToken = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!sessionToken) return fail('Sign in first.', 401);
  const { user } = await validateSession(sessionToken);
  if (!user) return fail('Sign in first.', 401);

  const pending = await loadPendingRequest(input.req);
  if (!pending) {
    return fail('This authorization request has expired. Start again.', 410);
  }

  const client = await resolveClient(pending.clientId).catch(() => null);
  if (!client) return fail('This application is no longer registered.', 400);

  /**
   * The redirect is checked a second time, here, against the client's current
   * declared list.
   *
   * The page checked it when the request was stored, which was up to half an
   * hour ago. A metadata document can change in that time, and the check that
   * matters is the one immediately before a code is put on the wire.
   */
  if (!redirectUriAllowed(pending.redirectUri, client.redirectUris)) {
    return fail('This application changed where it receives replies.', 400);
  }

  if (!input.approve) {
    return NextResponse.json({
      redirect: clientRedirect(pending.redirectUri, {
        error: 'access_denied',
        error_description: 'The person declined.',
        state: pending.state,
      }),
    });
  }

  // The session carries an email, and `users.id` is what a grant is keyed on.
  const account = await getOrCreateUser(user.email);

  const grant = await createGrant({
    userId: account.id,
    clientId: pending.clientId,
    clientLabel: client.isCimd
      ? (client.claimedName ?? client.displayHost)
      : `${client.displayHost} (unverified)`,
    scope: pending.scope,
    resource: pending.resource,
  });
  if (!grant) return fail('Could not record the approval.', 500);

  const code = await issueCode(pending.id, account.id, grant.id);
  if (!code) {
    // The request was answered between the load above and this update, which
    // means somebody clicked twice. One approval, one code: the second attempt
    // is told to start over rather than handed a second working code.
    return fail('This authorization request was already answered.', 409);
  }

  return NextResponse.json({
    redirect: clientRedirect(pending.redirectUri, {
      code,
      state: pending.state,
    }),
  });
}
