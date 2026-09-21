import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth';
import { getUserAccess } from '@/lib/access';
import { apiPlanForTier, TIER_API_PLAN } from '@/lib/api-plans';
import { hasPaidAccess } from '@/lib/credits';

// Re-exported so existing importers keep working.
export { apiPlanForTier, TIER_API_PLAN };

/**
 * Guard for the /api/developer/* routes.
 *
 * These routes previously took an `email` from the query string or request body
 * and trusted it completely — no session, no ownership check, no tier check, and
 * no middleware in front of them. `POST /api/developer/keys` would create a user
 * record for an arbitrary email and return a live API key to an anonymous caller.
 *
 * The guard enforces the two things that were missing and still matter:
 *
 *  1. a valid session must exist;
 *  2. the session's email must match the email being acted on, so nobody can
 *     read or mint keys belonging to someone else.
 *
 * It carried a third until 2026-09-21, that the account hold live credits or
 * a legacy tier, and that one is gone. It refused a key to accounts the
 * OAuth path was already minting keys for, and it did not protect a single
 * credit, because what a key may spend is decided per call and not here. The
 * reasoning is kept in full beside `hasCredits` below.
 */

export interface DeveloperIdentity {
  email: string;
  tier: string;
  /** Whether live credits are backing this account, independent of tier. */
  hasCredits: boolean;
}

type GuardResult =
  | { ok: true; identity: DeveloperIdentity }
  | { ok: false; response: NextResponse };

/**
 * Resolve and authorise the caller.
 *
 * `requestedEmail` is whatever the route was asked to act on. It is only ever
 * accepted when it matches the session, and the mismatch is reported as 403
 * rather than 404 so the response does not reveal whether that account exists.
 */
export async function requireDeveloperAccess(
  requestedEmail?: string | null
): Promise<GuardResult> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!token) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      ),
    };
  }

  const session = await validateSession(token);
  if (!session.user) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Invalid or expired session' },
        { status: 401 }
      ),
    };
  }

  const sessionEmail = session.user.email.toLowerCase();

  if (requestedEmail && requestedEmail.toLowerCase() !== sessionEmail) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'You can only manage API keys for your own account' },
        { status: 403 }
      ),
    };
  }

  const access = await getUserAccess(sessionEmail);

  /**
   * Whether a live lot is backing this account, which is reported and no
   * longer gates anything here.
   *
   * ## The refusal this used to carry, and why it is gone
   *
   * Until 2026-09-21 a free account was refused a key outright, on the
   * reasoning that `getBalance().available` is up to 100 inside the free
   * window so honoring it "would let every signup mint a key". Two things
   * were wrong with that, and the second is the one that cost us.
   *
   * Every signup could already mint one. `mintAccessToken` in
   * `lib/oauth/grants.ts` writes an `api_keys` row on `CREDIT_API_PLAN` with
   * no credit test, so any free account that connects an OAuth client has
   * held a working key since the day that path shipped. The rule was enforced
   * on one of two doors.
   *
   * And a key is not a spend. Nothing a key does is authorised here: every
   * call draws on the same balance through `trackApiUsage`, so a key on an
   * empty balance resolves 100 matches per rolling 30 days and then answers
   * NO_CREDITS, which is exactly what the same person gets by pasting the
   * addresses into the web app. The refusal protected no revenue. What it did
   * protect was a contradiction: our own Apify listing had been telling
   * strangers to "get a free API key" since 2026-09-17, and the endpoint it
   * sent them to answered 403.
   *
   * `hasPaidAccess` is still the right question for anything that really is a
   * spend, and it still decides those. It stopped deciding this one.
   */
  const hasCredits = await hasPaidAccess(session.user.id, access.tier);

  return {
    ok: true,
    identity: { email: sessionEmail, tier: access.tier, hasCredits },
  };
}
