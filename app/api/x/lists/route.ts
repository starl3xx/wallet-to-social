/**
 * Describe an X list, and get the consent URL that authorizes building it.
 *
 * This route creates the job and nothing else. It does not talk to X, it does
 * not hold a credential, and the row it writes cannot do anything: it is born
 * `awaiting_auth` with no token, and only the callback can move it out of that
 * state.
 *
 * ## Why the row exists before the consent screen
 *
 * The intent has to survive a round trip through x.com, and a row is the only
 * thing here that does. The alternative is packing the list name and every
 * member into a cookie, which is both too large and wrong in a specific way:
 * with two tabs open, the second flow overwrites the first one's cookie and the
 * person authorizes one list and builds the other.
 *
 * ## What is checked, and what is deliberately not
 *
 * Entitlement is `hasPaidAccess`, never `tier`: a pack purchase leaves
 * `users.tier` at `free`, and gating on the tier refuses the people who have
 * just paid. Nothing is metered. Building a list spends our own prepaid X
 * credits at roughly half a cent per member, and at present volumes a meter
 * would be the thing decision 16 was deferred for: machinery built before there
 * is anybody to charge.
 *
 * The member list arrives from the caller and is NOT trusted to be reachable.
 * The X ids are re-read from `x_accounts` here, so a client cannot hand us an
 * id for an account the index never resolved, and a handle whose id we do not
 * hold is dropped rather than guessed at.
 */
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { randomBytes, createHash } from 'crypto';
import { sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth';
import { hasPaidAccess } from '@/lib/credits';
import { isConfigured as boxConfigured } from '@/lib/secret-box';
import {
  isConfigured as xConfigured,
  clientId,
  redirectUri,
  X_AUTHORIZE_URL,
  X_SCOPES,
  X_LIST_NAME_MAX,
  X_LIST_DESCRIPTION_MAX,
  X_LIST_MEMBER_MAX,
} from '@/lib/x-oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The client half of PKCE. The server half lives in lib/oauth/requests.ts. */
function s256Challenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export async function POST(request: NextRequest) {
  /**
   * Configuration first, before anything is written.
   *
   * Two separate refusals because they fail for different reasons and a person
   * reading the log needs to know which. Without the X client there is no
   * consent screen to send anyone to; without the box there is no way to store
   * the token that comes back, and starting a flow whose result we would have
   * to drop is worse than refusing at the door.
   */
  if (!xConfigured()) {
    return NextResponse.json(
      { error: 'x_not_configured', message: 'X list building is unavailable.' },
      { status: 503 }
    );
  }
  if (!boxConfigured()) {
    return NextResponse.json(
      {
        error: 'storage_not_configured',
        message: 'X list building is unavailable.',
      },
      { status: 503 }
    );
  }

  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await validateSession(token) : null;
  if (!session?.user) {
    return NextResponse.json(
      { error: 'unauthenticated', message: 'Sign in to build an X list.' },
      { status: 401 }
    );
  }

  const db = getDb();
  if (!db) {
    return NextResponse.json(
      { error: 'unavailable', message: 'X list building is unavailable.' },
      { status: 503 }
    );
  }

  const entitled = await hasPaidAccess(
    session.user.id,
    session.user.tier as Parameters<typeof hasPaidAccess>[1]
  );
  if (!entitled) {
    return NextResponse.json(
      {
        error: 'payment_required',
        message: 'Building an X list needs credits.',
      },
      { status: 402 }
    );
  }

  let body: {
    name?: unknown;
    description?: unknown;
    isPrivate?: unknown;
    handles?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'invalid_body', message: 'Expected a JSON body.' },
      { status: 400 }
    );
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > X_LIST_NAME_MAX) {
    return NextResponse.json(
      {
        error: 'invalid_name',
        message: `A list name is 1 to ${X_LIST_NAME_MAX} characters.`,
      },
      { status: 400 }
    );
  }

  const description =
    typeof body.description === 'string' ? body.description.trim() : '';
  if (description.length > X_LIST_DESCRIPTION_MAX) {
    return NextResponse.json(
      {
        error: 'invalid_description',
        message: `A description is at most ${X_LIST_DESCRIPTION_MAX} characters.`,
      },
      { status: 400 }
    );
  }

  const handles = Array.isArray(body.handles)
    ? [
        ...new Set(
          body.handles
            .filter((h): h is string => typeof h === 'string')
            .map((h) => h.toLowerCase().replace(/^@/, ''))
            .filter(Boolean)
        ),
      ]
    : [];
  if (handles.length === 0) {
    return NextResponse.json(
      { error: 'no_handles', message: 'No X handles to add.' },
      { status: 400 }
    );
  }

  /**
   * The ids come from our own index, never from the caller.
   *
   * `x_accounts.user_id` is who holds the handle now, which is the id the add
   * endpoint wants and the only one it accepts. Restricting to `status = live`
   * does the work of three separate refusals at once: a suspended or vacated
   * handle has no account to add, and a handle whose id belongs to somebody
   * else after a rename is precisely the row that must not go in a list
   * described as this community.
   */
  const rows = (await db.execute(sql`
    SELECT handle, user_id
    FROM x_accounts
    WHERE handle = ANY(${sql.param(handles)}::text[])
      AND status = 'live'
      AND user_id IS NOT NULL
  `)) as unknown as { rows: Array<{ handle: string; user_id: string }> };

  const members = rows.rows.map((r) => ({ id: r.user_id, handle: r.handle }));
  if (members.length === 0) {
    return NextResponse.json(
      {
        error: 'no_resolvable_handles',
        message: 'None of those handles resolve to a live X account.',
      },
      { status: 400 }
    );
  }

  /**
   * Truncated rather than refused, with the count said out loud.
   *
   * A holder list above X's cap is a real thing a customer will bring, and the
   * failure this reports is the one the docs rule warns about: building 5,000
   * of 8,000 and calling it the community is the number you set out to get
   * rather than the number that came back.
   */
  const capped = members.slice(0, X_LIST_MEMBER_MAX);

  const verifier = randomBytes(32).toString('base64url');
  const nonce = randomBytes(16).toString('base64url');

  const inserted = (await db.execute(sql`
    INSERT INTO x_list_jobs
      (user_id, list_name, list_description, is_private, members,
       code_verifier, state_nonce, status)
    VALUES (
      ${session.user.id},
      ${name},
      ${description || null},
      ${body.isPrivate === true},
      ${JSON.stringify(capped)}::jsonb,
      ${verifier},
      ${nonce},
      'awaiting_auth'
    )
    RETURNING id
  `)) as unknown as { rows: Array<{ id: string }> };

  const jobId = inserted.rows[0]?.id;
  if (!jobId) {
    return NextResponse.json(
      { error: 'unavailable', message: 'The list job could not be recorded.' },
      { status: 503 }
    );
  }

  const authorize = new URL(X_AUTHORIZE_URL);
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('client_id', clientId());
  authorize.searchParams.set('redirect_uri', redirectUri());
  authorize.searchParams.set('scope', X_SCOPES.join(' '));
  authorize.searchParams.set('state', `${jobId}.${nonce}`);
  authorize.searchParams.set('code_challenge', s256Challenge(verifier));
  authorize.searchParams.set('code_challenge_method', 'S256');

  return NextResponse.json({
    job_id: jobId,
    authorize_url: authorize.toString(),
    members: capped.length,
    // Said rather than implied: the caller asked for more than X allows, and
    // the list will be short by this many.
    dropped: members.length - capped.length,
    unresolved: handles.length - members.length,
  });
}
