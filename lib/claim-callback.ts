/**
 * The X half of a claim: read the account once, keep the id, drop the token.
 *
 * Lives beside `app/api/x/callback/route.ts` rather than inside it because
 * that route is the list flow and has its own long argument about tokens,
 * nonces and sixteen-minute jobs. Two flows sharing one registered redirect
 * URI is forced by X; two flows sharing one function body is not.
 *
 * ## What makes this different from the list callback
 *
 * That one stores a sealed access token, because it spends the next sixteen
 * minutes adding members. This one has nothing to do after the read: it wants
 * a numeric account id and a handle, and then the credential is a liability
 * rather than an asset. So the token is never written anywhere, and there is
 * no column for it to be written to.
 *
 * ## The refusals are the list callback's refusals
 *
 * Deliberately, and they are not restated with different reasoning: the nonce
 * is compared in constant time and cleared on use, the session must be the
 * account that opened the claim, and every distinguishable failure answers
 * `not_found`, because telling "no such claim" from "not your claim" is what
 * turns a uuid in a URL into a probe.
 */
import { sql } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth';
import { secretEquals } from '@/lib/secret-box';
import {
  isConfigured as xConfigured,
  basicAuthHeader,
  clientId,
  redirectUri,
  X_TOKEN_URL,
  X_API_BASE,
} from '@/lib/x-oauth';
import { getSiteUrl } from '@/lib/site-url';

/** Bounded, for the reason lib/x-accounts.ts gives about undici's default. */
const TOKEN_TIMEOUT_MS = 10_000;

function back(outcome: string, claimId?: string): NextResponse {
  const url = new URL(getSiteUrl());
  url.pathname = '/claim';
  url.searchParams.set('claim', outcome);
  if (claimId) url.searchParams.set('claim_id', claimId);
  return NextResponse.redirect(url.toString());
}

export async function completeClaimCallback(input: {
  code: string | null;
  id: string;
  nonce: string;
  /** X's own refusal, echoed back with the state. */
  denied: string | null;
}): Promise<NextResponse> {
  /**
   * This flow's own refusals, answered on this flow's own page.
   *
   * They live here rather than in the shared route because X echoes `state`
   * on an error too: handling them upstream sent somebody who cancelled a
   * claim to the homepage carrying the list flow's vocabulary.
   *
   * `access_denied` is somebody pressing Cancel, which is a decision rather
   * than a fault and does not deserve a scary page.
   */
  if (input.denied) {
    return back(
      input.denied === 'access_denied' ? 'cancelled' : 'refused',
      input.id
    );
  }

  /**
   * Only the X client, deliberately NOT the secret box.
   *
   * The box seals a list's access token. This flow stores no token, so
   * requiring the key here would refuse a working claim for a missing secret
   * it never touches, which is exactly what the shared gate upstream used to
   * do.
   */
  if (!xConfigured()) return back('unavailable', input.id);

  if (!input.code) return back('invalid', input.id);

  const db = getDb();
  if (!db) return back('unavailable');

  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await validateSession(token) : null;
  if (!session?.user) return back('signed_out', input.id);

  /**
   * The thirty minutes is enforced HERE, at the read, for the reason the list
   * callback spells out: a TTL that lives only in a sweep is a claim the code
   * does not keep, and a consent tab left open overnight would authorize
   * successfully and then fail underneath a cleanup pass. Postgres decides,
   * not Node.
   */
  const found = (await db.execute(sql`
    SELECT id, user_id, state_nonce, code_verifier, status, wallet
    FROM identity_attestations
    WHERE id = ${input.id}::uuid
      AND created_at > now() - interval '30 minutes'
  `)) as unknown as {
    rows: Array<{
      id: string;
      user_id: string;
      state_nonce: string | null;
      code_verifier: string | null;
      status: string;
      wallet: string;
    }>;
  };

  const claim = found.rows[0];
  if (
    !claim ||
    claim.user_id !== session.user.id ||
    claim.status !== 'awaiting_x' ||
    !claim.state_nonce ||
    !claim.code_verifier ||
    !secretEquals(claim.state_nonce, input.nonce)
  ) {
    return back('not_found');
  }

  // --- exchange -------------------------------------------------------------

  let accessToken: string;
  try {
    const res = await fetch(X_TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: basicAuthHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: input.code!,
        redirect_uri: redirectUri(),
        code_verifier: claim.code_verifier,
        client_id: clientId(),
      }),
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error('claim token exchange failed:', res.status);
      return back('exchange_failed', claim.id);
    }
    const json = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
    };
    if (typeof json.access_token !== 'string') {
      return back('exchange_failed', claim.id);
    }
    /**
     * A refresh token should not be here: `offline_access` is not requested.
     * If one arrives the scope set has drifted, and the right response is to
     * notice loudly rather than quietly hold a standing credential this design
     * says it does not keep. Dropped by never being read.
     */
    if (json.refresh_token) {
      console.error(
        'X returned a refresh token for a claim that did not request offline_access; dropping it'
      );
    }
    accessToken = json.access_token;
  } catch (error) {
    console.error('claim token exchange error:', error);
    return back('exchange_failed', claim.id);
  }

  // --- who authorized -------------------------------------------------------

  let xUserId: string;
  let handle: string;
  try {
    const res = await fetch(`${X_API_BASE}/users/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    });
    if (!res.ok) {
      /**
       * A 403 here is the scope set being wrong, which is worth saying in the
       * log rather than leaving as a generic failure: `/2/users/me` needs
       * `users.read` AND `tweet.read`, and a set missing the second one fails
       * only at this exact point, after a real person has finished consenting.
       */
      console.error(`claim identity lookup failed: ${res.status}`);
      return back('identity_failed', claim.id);
    }
    const json = (await res.json()) as {
      data?: { id?: string; username?: string };
    };
    if (!json.data?.id || !json.data.username) {
      return back('identity_failed', claim.id);
    }
    xUserId = json.data.id;
    handle = json.data.username;
  } catch (error) {
    console.error('claim identity lookup error:', error);
    return back('identity_failed', claim.id);
  }

  /**
   * The verifier and the nonce are cleared in the same statement that records
   * the account, so the pair cannot be replayed even within the same second,
   * and the status moves out of `awaiting_x`.
   *
   * Conditional on the status still being `awaiting_x`: two callbacks racing
   * must not both succeed.
   *
   * `access_token` appears nowhere. There is no column for it and nothing to
   * put in one: the read above is the only thing this flow ever needed the
   * credential for, and it is finished.
   */
  await db.execute(sql`
    UPDATE identity_attestations
    SET x_user_id     = ${xUserId},
        x_handle      = ${handle.toLowerCase()},
        code_verifier = NULL,
        state_nonce   = NULL,
        status        = 'completed',
        completed_at  = now(),
        updated_at    = now()
    WHERE id = ${claim.id}::uuid
      AND status = 'awaiting_x'
  `);

  return back('completed', claim.id);
}
