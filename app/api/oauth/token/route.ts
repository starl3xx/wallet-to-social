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
import { loadCode, pkceMatches } from '@/lib/oauth/requests';
import { redeemCode, refreshGrant, revokeGrant } from '@/lib/oauth/grants';
import { mcpResource } from '@/lib/oauth/metadata';
import { repeatedFormParam, resourcesAreOurs } from '@/lib/oauth/params';

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

  // Every parameter but `resource` may appear once (OAuth 2.1 section 3.2). A
  // second client_id would otherwise pass whichever check read the first.
  const repeated = repeatedFormParam(form);
  if (repeated) {
    return oauthError('invalid_request', `${repeated} may appear only once.`);
  }

  // One catch for every database call either grant type makes, so a failure
  // anywhere answers the same 503. `return await`, not `return`: a promise
  // returned unawaited rejects after the try has already been left.
  const grantType = form.get('grant_type');
  try {
    if (grantType === 'authorization_code') return await exchangeCode(form);
    if (grantType === 'refresh_token') return await exchangeRefresh(form);
  } catch (error) {
    console.error(
      `Token request (${grantType}) failed on /api/oauth/token:`,
      error
    );
    return tokenServiceUnavailable();
  }
  return oauthError(
    'unsupported_grant_type',
    'Supported grant types are authorization_code and refresh_token.'
  );
}

/**
 * A database failure inside a code exchange or a refresh.
 *
 * Not the client's fault. The code and the refresh token are each spent in one
 * statement with what they buy, so a failure leaves them unspent and a retry
 * with the same one works, unless the statement committed and only the reply
 * was lost. `temporarily_unavailable` is defined for the authorization
 * endpoint, not this one (OAuth 2.1 section 3.2.4); it is used deliberately,
 * as the 429 above already does.
 *
 * On a refresh it matters to the MCP SDK, which reads it as an error to retry
 * with the tokens it holds; a bare 500 makes it start consent over. On a code
 * exchange the SDK surfaces either one as an error and retries nothing, so
 * there the 503 only tells a client that does retry that the code is still
 * good.
 *
 * A failure that repeats keeps answering 503. Consent would not mend a token
 * service that cannot write, so the log line is where a persistent one is
 * noticed, not the person's browser.
 */
function tokenServiceUnavailable(): NextResponse {
  return NextResponse.json(
    {
      error: 'temporarily_unavailable',
      error_description: 'The token service is briefly unavailable. Try again.',
    },
    { status: 503, headers: { ...NO_STORE, 'Retry-After': '5' } }
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
    return oauthError('invalid_grant', 'The authorization code is unknown.');
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
   * quietly given the first one. Every value is checked, by the comparison the
   * authorization request and a refresh use, so a trailing slash on one side
   * and not the other does not strand a connection halfway.
   */
  if (
    row.resource !== null &&
    !resourcesAreOurs(form.getAll('resource'), row.resource)
  ) {
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
   *
   * The spend and the credentials are one statement, so a failure here leaves
   * the code unspent and the client's retry works; see `tokenServiceUnavailable`.
   */
  const spent = await redeemCode(code);

  if (spent.outcome === 'replayed') {
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

  if (spent.outcome === 'inactive') {
    // Spent on a grant revoked since consent. Nothing to revoke, nothing issued.
    return oauthError(
      'invalid_grant',
      'The consent behind this code is no longer active.'
    );
  }

  if (spent.outcome !== 'issued') {
    /**
     * Expired, or gone between the read and the write. Neither is a replay and
     * neither revokes anything.
     *
     * Telling this apart from a replay is the whole reason `unspentCodeReason`
     * returns three outcomes instead of a boolean. A boolean made every failure
     * a replay, so a first exchange arriving a moment past the window was
     * answered by revoking the connection it was trying to establish, and the
     * only clock that could disagree with itself was the one deciding.
     */
    return oauthError(
      'invalid_grant',
      'The authorization code has expired. Start a new connection.'
    );
  }

  const { tokens } = spent;
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

  const result = await refreshGrant({
    refreshToken: token,
    // Sent without a value is omitted (OAuth 2.1 section 3.2): `client_id=`
    // is a refresh with no client_id, not one from a client named ''.
    clientId: form.get('client_id') || null,
    resources: form.getAll('resource'),
  });

  if (!result.ok) {
    if (result.reason === 'wrong_resource') {
      return oauthError(
        'invalid_target',
        'resource does not match the one this connection was made for.'
      );
    }
    if (result.reason === 'just_rotated') {
      /**
       * A parallel refresh lost the race to another request carrying the same
       * token, moments ago. Not `invalid_grant`: the MCP SDK answers that by
       * deleting its stored tokens, which by now are the winner's good ones.
       * `temporarily_unavailable` it surfaces as an error on this one call and
       * keeps the store, so the next call uses what the winner received.
       *
       * No `Retry-After`, unlike the other 503 here: this one must not be
       * retried with the same refresh token, which after the window revokes
       * the connection. `token_rotated` tells a client which 503 this is.
       */
      return NextResponse.json(
        {
          error: 'temporarily_unavailable',
          error_description:
            'This refresh token was rotated by another request moments ago. Use the tokens that request received; do not send this refresh token again.',
          token_rotated: true,
        },
        { status: 503, headers: NO_STORE }
      );
    }
    /**
     * Every other failure answers `invalid_grant`, and the descriptions differ
     * only in what they tell the person reading a log.
     *
     * A reused refresh token has already revoked the grant inside
     * `refreshGrant`, so there is nothing here to decide. What matters is that
     * the code is `invalid_grant` in every case: it is the one code that makes
     * a client stop retrying and ask for consent again. That includes a grant
     * made for another server: `invalid_target` there would leave a client
     * holding tokens it can never use, retrying forever.
     */
    const description =
      result.reason === 'reused'
        ? 'This refresh token was already exchanged. The connection has been revoked; start a new one.'
        : result.reason === 'expired'
          ? 'This refresh token has expired. Start a new connection.'
          : result.reason === 'wrong_client'
            ? 'This refresh token was issued to a different client.'
            : result.reason === 'wrong_grant_resource'
              ? 'This connection was made for a different server. Start a new one.'
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
