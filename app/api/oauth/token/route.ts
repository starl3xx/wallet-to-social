/**
 * The token endpoint: an authorization code becomes credentials, and a refresh
 * token becomes fresh ones.
 *
 * Form encoded, not JSON. RFC 6749 section 4.1.3 requires it, Claude sends it
 * that way for both the initial exchange and every refresh, and a framework
 * that only parses JSON answers 415 to a request that is entirely correct.
 * That failure is invisible in a browser and shows up as intermittent broken
 * connections, so the parser is explicit here rather than inherited.
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkIpRateLimit, getClientIp } from '@/lib/ip-rate-limiter';
import { consumeCode, loadCode, pkceMatches } from '@/lib/oauth/requests';
import {
  issueInitialTokens,
  refreshGrant,
  revokeGrant,
} from '@/lib/oauth/grants';
import { mcpResource } from '@/lib/oauth/metadata';

export const runtime = 'nodejs';

const NO_STORE = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };

/**
 * The error codes here are the RFC 6749 ones, spelled exactly.
 *
 * Not pedantry: a client refreshing against a dead refresh token retries
 * forever unless it is told `invalid_grant`, because every other code reads as
 * "something went wrong, try again" rather than "start over, the user must
 * consent". `invalid_request` on a dead refresh token is the single most common
 * way a connector ends up in a refresh loop.
 */
function oauthError(
  error: string,
  description: string,
  status = 400
): NextResponse {
  return NextResponse.json(
    { error, error_description: description },
    { status, headers: NO_STORE }
  );
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const limit = await checkIpRateLimit(
    getClientIp(request),
    '/api/oauth/token'
  );
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: 'temporarily_unavailable',
        error_description: 'Too many token requests from this address.',
      },
      {
        status: 429,
        headers: limit.retryAfter
          ? { ...NO_STORE, 'Retry-After': String(limit.retryAfter) }
          : NO_STORE,
      }
    );
  }

  let form: URLSearchParams;
  try {
    form = new URLSearchParams(await request.text());
  } catch {
    return oauthError(
      'invalid_request',
      'The request body must be application/x-www-form-urlencoded.'
    );
  }

  const grantType = form.get('grant_type');
  if (grantType === 'authorization_code') {
    return exchangeCode(form);
  }
  if (grantType === 'refresh_token') {
    return exchangeRefresh(form);
  }
  return oauthError(
    'unsupported_grant_type',
    'Supported grant types are authorization_code and refresh_token.'
  );
}

/**
 * Exchange an authorization code.
 *
 * The order is load, validate, consume, and it is not the order this was first
 * written in. Consuming first meant a single attempt with a wrong verifier
 * burned the code and made the real client's retry look like a replay, which
 * revoked the grant: anybody who could see a code could destroy the connection
 * behind it without holding anything else. Nothing below spends or revokes
 * until the caller has proved it is the client the code was issued to.
 */
async function exchangeCode(form: URLSearchParams): Promise<NextResponse> {
  const code = form.get('code');
  const verifier = form.get('code_verifier');
  const clientId = form.get('client_id');
  const redirectUri = form.get('redirect_uri');

  if (!code) return oauthError('invalid_request', 'code is required.');
  if (!clientId) return oauthError('invalid_request', 'client_id is required.');
  if (!verifier) {
    // PKCE is not optional here. Every client is public, so the code is the
    // only thing standing between an interception and a working token.
    return oauthError(
      'invalid_request',
      'code_verifier is required. This server issues codes to public clients only, so every exchange must complete the PKCE challenge.'
    );
  }
  if (!redirectUri) {
    /**
     * Required, because the authorization request always carried one.
     *
     * RFC 6749 section 4.1.3 makes `redirect_uri` mandatory on the exchange
     * whenever it was present on the authorization request, and ours is
     * present on every one. Comparing it only when the caller chose to send it
     * made the binding optional at the attacker's discretion, which is the
     * same as not having it: a stolen code plus a stolen verifier was
     * redeemable without ever proving which callback the code belonged to.
     */
    return oauthError(
      'invalid_request',
      'redirect_uri is required, and must be the one the authorization request used.'
    );
  }

  const loaded = await loadCode(code);
  if (!loaded.ok) {
    return oauthError(
      'invalid_grant',
      'The authorization code is unknown or has expired.'
    );
  }
  const row = loaded.row;

  /**
   * The code is bound to the client it was issued to.
   *
   * Without this, a code intercepted from one client's redirect is redeemable
   * by any other client that can guess a `client_id`, and PKCE would not stop
   * it: the attacker chose the verifier only if they also started the flow.
   */
  if (row.clientId !== clientId) {
    return oauthError(
      'invalid_grant',
      'This authorization code was issued to a different client.'
    );
  }

  if (redirectUri !== row.redirectUri) {
    return oauthError(
      'invalid_grant',
      'redirect_uri does not match the one this code was issued for.'
    );
  }

  if (!pkceMatches(verifier, row.codeChallenge)) {
    return oauthError(
      'invalid_grant',
      'The code_verifier does not match the code_challenge from the authorization request.'
    );
  }

  /**
   * RFC 8707: a `resource` on the token request must name the same resource the
   * authorization request did. A client that asked to reach the MCP server and
   * then asks for a token audienced somewhere else is refused rather than
   * quietly given the first one.
   */
  const resource = form.get('resource');
  if (resource !== null && row.resource !== null && resource !== row.resource) {
    return oauthError(
      'invalid_target',
      'resource does not match the one this code was issued for.'
    );
  }

  if (!row.grantId) {
    return oauthError(
      'invalid_grant',
      'This authorization code has no consent attached to it.'
    );
  }

  /**
   * Everything above passed, so whoever is calling holds the code, the
   * verifier, the client id and the redirect. Only now does spending it mean
   * anything, and only now does failing to spend it mean anything either.
   */
  if (!(await consumeCode(code))) {
    /**
     * The code was already spent, by somebody who also passed every check
     * above. That is a code in two places, which OAuth 2.1 answers by revoking
     * everything the code produced: the legitimate exchange has already
     * happened, so this attempt is either a stolen code or a client that has
     * lost track of its own state, and both are answered the same way.
     *
     * The revoke runs before the error is written, so the response cannot be
     * used as a signal to race it.
     */
    await revokeGrant(row.grantId, 'authorization code replayed');
    return oauthError(
      'invalid_grant',
      'This authorization code has already been used. The connection it created has been revoked; start a new one.'
    );
  }

  const tokens = await issueInitialTokens(row.grantId);
  if (!tokens) {
    return oauthError(
      'invalid_grant',
      'The consent behind this code is no longer active.'
    );
  }

  return NextResponse.json(
    {
      access_token: tokens.accessToken,
      token_type: 'Bearer',
      expires_in: tokens.expiresIn,
      refresh_token: tokens.refreshToken ?? undefined,
      scope: tokens.scope,
      resource: row.resource ?? mcpResource(),
    },
    { headers: NO_STORE }
  );
}

async function exchangeRefresh(form: URLSearchParams): Promise<NextResponse> {
  const token = form.get('refresh_token');
  if (!token) {
    return oauthError('invalid_request', 'refresh_token is required.');
  }

  const result = await refreshGrant(token);
  if (!result.ok) {
    /**
     * All three failures answer `invalid_grant`, and the descriptions differ
     * only in what they tell the person reading a log.
     *
     * A reused refresh token has already revoked the grant inside
     * `refreshGrant`, so there is nothing here to decide. What matters is that
     * the code is `invalid_grant` in every case: it is the one code that makes
     * a client stop retrying and ask for consent again.
     */
    const description =
      result.reason === 'reused'
        ? 'This refresh token was already exchanged. The connection has been revoked; start a new one.'
        : result.reason === 'expired'
          ? 'This refresh token has expired. Start a new connection.'
          : 'The refresh token is unknown.';
    return oauthError('invalid_grant', description);
  }

  return NextResponse.json(
    {
      access_token: result.tokens.accessToken,
      token_type: 'Bearer',
      expires_in: result.tokens.expiresIn,
      refresh_token: result.tokens.refreshToken ?? undefined,
      scope: result.tokens.scope,
    },
    { headers: NO_STORE }
  );
}
