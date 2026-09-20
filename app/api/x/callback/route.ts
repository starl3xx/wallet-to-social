/**
 * Where X sends someone back after they authorize a list.
 *
 * This is the only place in the codebase that receives a third-party
 * credential, and the only place that writes one. Everything it does is in
 * service of two claims: the person finishing this flow is the person who
 * started it, and the token that arrives is stored as ciphertext or not at all.
 *
 * ## Why the job row is the state
 *
 * `state` is `<jobId>.<nonce>`. The id says which job, and the nonce is what
 * makes the pair unguessable: an id alone is a bare uuid travelling in a URL,
 * and a stranger who learned one could complete the flow with their own X
 * account and attach it to somebody else's job. The nonce is compared in
 * constant time and cleared the moment it is used, so the pair is good for
 * exactly one callback.
 *
 * The session is checked as well, and it has to be the same account that
 * created the row. Two independent facts rather than one: the nonce proves this
 * callback belongs to this job, and the session proves the browser finishing it
 * is the customer whose credits paid for it.
 *
 * ## Failure is a redirect, not JSON
 *
 * A person is looking at this. Every refusal goes back to the app with a
 * `x_list` query parameter naming what happened, and none of them says anything
 * an attacker could use to tell "no such job" from "not your job": both are
 * `not_found`, because the difference is exactly the oracle a bare uuid in a URL
 * would otherwise provide.
 */
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth';
import {
  seal,
  secretEquals,
  isConfigured as boxConfigured,
} from '@/lib/secret-box';
import {
  isConfigured as xConfigured,
  redirectUri,
  basicAuthHeader,
  clientId,
  X_TOKEN_URL,
  X_API_BASE,
  parseCallbackState,
} from '@/lib/x-oauth';
import { completeClaimCallback } from '@/lib/claim-callback';
import { getSiteUrl } from '@/lib/site-url';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Bounded, for the reason lib/x-accounts.ts gives: without it the request
 * inherits undici's 300s header timeout, which is longer than the route may
 * run and turns a slow provider into a hung page.
 */
const TOKEN_TIMEOUT_MS = 10_000;

function back(outcome: string, jobId?: string): NextResponse {
  const url = new URL(getSiteUrl());
  url.searchParams.set('x_list', outcome);
  if (jobId) url.searchParams.set('x_list_job', jobId);
  return NextResponse.redirect(url.toString());
}

export async function GET(request: NextRequest) {
  if (!xConfigured() || !boxConfigured()) return back('unavailable');

  const params = request.nextUrl.searchParams;

  /**
   * X's own refusal, passed through before anything else is read. The common
   * value is `access_denied`, which is somebody pressing Cancel and is not an
   * error worth a scary page.
   */
  const denied = params.get('error');
  if (denied) return back(denied === 'access_denied' ? 'cancelled' : 'refused');

  const code = params.get('code');
  const parsed = parseCallbackState(params.get('state') ?? '');
  if (!code || !parsed) return back('invalid');

  /**
   * One redirect URI, two flows, and the state says which.
   *
   * X matches the callback string exactly against what is registered in the
   * developer portal, so a second route would need an out-of-band change
   * nothing here can verify. The claim flow is handled in its own module and
   * returns its own redirect; this function stays the list flow it was.
   */
  if (parsed.flow === 'claim') {
    return completeClaimCallback({ code, id: parsed.id, nonce: parsed.nonce });
  }

  const jobId = parsed.id;
  const nonce = parsed.nonce;

  const db = getDb();
  if (!db) return back('unavailable');

  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await validateSession(token) : null;
  if (!session?.user) return back('signed_out', jobId);

  /**
   * The thirty minutes is enforced HERE, not only by the sweep.
   *
   * `cleanupAbandonedListJobs` runs from the daily cleanup cron, so a TTL that
   * lived only there was a claim the code did not keep: a row sat for up to a
   * day, and a confirmation tab left open overnight would authorize
   * successfully and then fail at X after the 04:00 pass cancelled it
   * underneath it. An expiry checked at read time is the same shape
   * `loadPendingRequest` uses on the inbound OAuth server, and it makes the
   * window true regardless of when the sweep happens to run. The sweep is then
   * what clears the payload, not what defines the deadline.
   *
   * Postgres decides, not Node: the same reasoning as `consumeCode`, whose
   * comment records what a clock comparison in the application cost.
   */
  const found = (await db.execute(sql`
    SELECT id, user_id, state_nonce, code_verifier, status
    FROM x_list_jobs
    WHERE id = ${jobId}::uuid
      AND created_at > now() - interval '30 minutes'
  `)) as unknown as {
    rows: Array<{
      id: string;
      user_id: string;
      state_nonce: string | null;
      code_verifier: string | null;
      status: string;
    }>;
  };

  const job = found.rows[0];
  /**
   * One answer for four different failures, on purpose. No such job, somebody
   * else's job, a job already authorized, and a job whose nonce was consumed
   * are all `not_found`: telling them apart is exactly what turns a uuid in a
   * URL into a probe.
   */
  if (
    !job ||
    job.user_id !== session.user.id ||
    job.status !== 'awaiting_auth' ||
    !job.state_nonce ||
    !job.code_verifier ||
    !secretEquals(job.state_nonce, nonce)
  ) {
    return back('not_found');
  }

  // --- exchange -------------------------------------------------------------

  let accessToken: string;
  let expiresIn: number;
  try {
    const res = await fetch(X_TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: basicAuthHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri(),
        code_verifier: job.code_verifier,
        client_id: clientId(),
      }),
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error('X token exchange failed:', res.status);
      return back('exchange_failed', jobId);
    }
    const json = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
      refresh_token?: string;
    };
    if (typeof json.access_token !== 'string') {
      return back('exchange_failed', jobId);
    }
    /**
     * A refresh token should not be here, because `offline_access` is not
     * requested. If one arrives anyway the scope set has drifted, and the
     * right response is to notice loudly rather than to quietly store a
     * standing credential this design says it does not hold. It is dropped by
     * simply never being read; the log is so the drift is visible.
     */
    if (json.refresh_token) {
      console.error(
        'X returned a refresh token for a flow that did not request offline_access; dropping it'
      );
    }
    accessToken = json.access_token;
    expiresIn = typeof json.expires_in === 'number' ? json.expires_in : 7200;
  } catch (error) {
    console.error('X token exchange error:', error);
    return back('exchange_failed', jobId);
  }

  // --- who authorized -------------------------------------------------------

  let xUserId: string;
  let handle: string;
  try {
    const res = await fetch(`${X_API_BASE}/users/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    });
    if (!res.ok) return back('identity_failed', jobId);
    const json = (await res.json()) as {
      data?: { id?: string; username?: string };
    };
    if (!json.data?.id || !json.data.username) {
      return back('identity_failed', jobId);
    }
    xUserId = json.data.id;
    handle = json.data.username;
  } catch (error) {
    console.error('X identity lookup error:', error);
    return back('identity_failed', jobId);
  }

  /**
   * Sealed before the write, and the write is refused if sealing fails.
   *
   * `seal` returns null rather than throwing precisely so this branch has to
   * exist: the alternative shape, a try/catch around a function that throws,
   * is the one where somebody later "simplifies" it into storing the plaintext.
   * A token we cannot seal is a token we do not keep.
   */
  const sealed = seal(accessToken);
  if (!sealed) {
    console.error('Sealing the X token failed; refusing to store it');
    return back('unavailable', jobId);
  }

  /**
   * The verifier and the nonce are cleared in the same statement that stores
   * the token, so the pair cannot be replayed even within the same second, and
   * the status moves to `pending` where the worker can claim it.
   *
   * Conditional on the status still being `awaiting_auth`: two callbacks
   * racing must not both succeed, and the loser writing second would overwrite
   * a token the worker may already be using.
   */
  await db.execute(sql`
    UPDATE x_list_jobs
    SET access_token      = ${sealed},
        access_expires_at = now() + make_interval(secs => ${expiresIn}),
        x_user_id         = ${xUserId},
        handle            = ${handle},
        code_verifier     = NULL,
        state_nonce       = NULL,
        status            = 'pending',
        updated_at        = now()
    WHERE id = ${jobId}::uuid
      AND status = 'awaiting_auth'
  `);

  return back('queued', jobId);
}
