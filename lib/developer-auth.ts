import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth';
import { getUserAccess } from '@/lib/access';

/**
 * Guard for the /api/developer/* routes.
 *
 * These routes previously took an `email` from the query string or request body
 * and trusted it completely — no session, no ownership check, no tier check, and
 * no middleware in front of them. `POST /api/developer/keys` would create a user
 * record for an arbitrary email and return a live API key to an anonymous caller.
 *
 * The guard enforces three things that were all missing:
 *
 *  1. a valid session must exist;
 *  2. the session's email must match the email being acted on, so nobody can
 *     read or mint keys belonging to someone else;
 *  3. the account must be on a tier that includes API access.
 */

/** Tiers that include API access. */
const API_TIERS = ['pro', 'unlimited'] as const;

/**
 * Which api_plans row each paid tier is entitled to.
 *
 * The plan must be derived from the tier and never taken from the request.
 * The create endpoint used to read `plan` straight out of the body and only
 * checked that the row existed, so a Pro account could have asked for
 * 'enterprise' and received its limits.
 *
 * API access is bundled rather than metered because every v1 route reads only
 * from social_graph — no route calls an external provider — so the marginal
 * cost of a request is a Postgres read, not a Neynar or web3.bio call.
 */
export const TIER_API_PLAN: Record<string, string> = {
  pro: 'developer',
  unlimited: 'startup',
};

/** The api_plans id this account is entitled to, or null if it has no API access. */
export function apiPlanForTier(tier: string): string | null {
  return TIER_API_PLAN[tier] ?? null;
}

export interface DeveloperIdentity {
  email: string;
  tier: string;
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
  requestedEmail?: string | null,
  options: { requireApiTier?: boolean } = {},
): Promise<GuardResult> {
  const { requireApiTier = true } = options;

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!token) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Authentication required' }, { status: 401 }),
    };
  }

  const session = await validateSession(token);
  if (!session.user) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 }),
    };
  }

  const sessionEmail = session.user.email.toLowerCase();

  if (requestedEmail && requestedEmail.toLowerCase() !== sessionEmail) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'You can only manage API keys for your own account' },
        { status: 403 },
      ),
    };
  }

  const access = await getUserAccess(sessionEmail);

  if (requireApiTier && !API_TIERS.includes(access.tier as (typeof API_TIERS)[number])) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'API access is available on Pro and Unlimited',
          upgradeRequired: true,
          tier: access.tier,
        },
        { status: 403 },
      ),
    };
  }

  return { ok: true, identity: { email: sessionEmail, tier: access.tier } };
}
