/**
 * The consent screen, and the validation that has to happen before one can be
 * shown.
 *
 * Two shapes arrive here and they are different requests wearing one URL.
 *
 * **A fresh authorization request** carries the OAuth parameters. Everything is
 * checked, the request is written to a row, and the browser is redirected to
 * the second shape. Nothing a client supplied survives into the URL.
 *
 * **`?req=<id>`** carries one opaque id. This is the shape a person can be sent
 * back to after a detour through their mailbox, and the reason the split
 * exists: with the client's `redirect_uri` and `state` already stored and
 * validated, there is no attacker-supplied value for the sign-in round trip to
 * carry, which is the usual way a consent screen becomes an open redirect.
 *
 * ## Refusing before a redirect, and after
 *
 * A parameter error is answered one of three ways, and the distinction is the
 * single most important rule on this page.
 *
 * 1. Until `redirect_uri` has been checked against the client's own declared
 *    list, it is a string a stranger typed. Those failures render here.
 * 2. A redirect the client declared but nobody vetted still renders here.
 *    Anybody can register a client, or publish a metadata document, naming
 *    their own page, and sending a browser there without a person choosing it
 *    is the redirect attack RFC 9700 section 4.11.2 describes.
 * 3. A declared redirect that is trusted (`redirectIsTrusted`: loopback, or a
 *    known origin such as claude.ai) gets the error delivered there, because
 *    that is where the client is waiting and a page it never sees is a hung
 *    connection.
 *
 * ## The limit
 *
 * A fresh request is counted per address, 30 an hour under `/oauth/authorize`,
 * once both parameters it cannot do without are present and before the client
 * is resolved, because resolving can mean fetching a metadata document and
 * every fresh request writes a row. The page opens in the person's own
 * browser, so the address is theirs whichever client sent them. Over the
 * limit it renders a refusal and never redirects: at that point `redirect_uri`
 * is still a string nobody has checked, which is rule 1 above. The consent
 * step (`?req=`) is not counted, so one connection costs one unit.
 */
import { redirect } from 'next/navigation';
import { cookies, headers } from 'next/headers';
import type { Metadata } from 'next';
import { PageShell } from '@/components/ui/page-shell';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth';
import { checkIpRateLimit, clientIpFromHeaders } from '@/lib/ip-rate-limiter';
import {
  CimdError,
  resolveClient,
  redirectUriAllowed,
  redirectIsTrusted,
  consentView,
  type ResolvedClient,
} from '@/lib/oauth/clients';
import {
  createAuthorizationRequest,
  loadPendingRequest,
} from '@/lib/oauth/requests';
import {
  MCP_SCOPE,
  OFFLINE_SCOPE,
  SUPPORTED_SCOPES,
  mcpResource,
  issuer,
} from '@/lib/oauth/metadata';
import { repeatedParam, resourcesAreOurs } from '@/lib/oauth/params';
import { ConsentScreen } from './ConsentScreen';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Connect an application',
  robots: { index: false, follow: false },
};

type Params = Record<string, string | string[] | undefined>;

function one(params: Params, key: string): string | null {
  const value = params[key];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function Refusal({ title, detail }: { title: string; detail: string }) {
  return (
    <PageShell>
      <div className="mx-auto max-w-[52ch] py-16">
        <h1 className="text-2xl font-semibold tracking-[var(--tracking-title)]">
          {title}
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">{detail}</p>
        <p className="mt-6 text-sm text-muted-foreground">
          Nothing was shared, and no connection was made. If you started this
          from an application, close this page and try connecting again from
          there.
        </p>
      </div>
    </PageShell>
  );
}

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const params = await searchParams;
  const requestId = one(params, 'req');

  // A repeated client_id or redirect_uri leaves no single answer to which
  // application is asking or where the reply goes, so it renders before any
  // client is looked up (OAuth 2.1 section 3.1: parameters MUST NOT repeat).
  if (Array.isArray(params.client_id) || Array.isArray(params.redirect_uri)) {
    return (
      <Refusal
        title="This connection request is ambiguous"
        detail="It named the application, or the address to reply to, more than once. There is no safe way to choose between them."
      />
    );
  }

  if (requestId) return renderConsent(requestId);

  // --- a fresh authorization request ---------------------------------------

  const clientId = one(params, 'client_id');
  const redirectUri = one(params, 'redirect_uri');
  const responseType = one(params, 'response_type');
  const codeChallenge = one(params, 'code_challenge');
  const challengeMethod = one(params, 'code_challenge_method');
  const state = one(params, 'state');
  const resource = one(params, 'resource');
  const requestedScope = one(params, 'scope');

  if (!clientId || !redirectUri) {
    return (
      <Refusal
        title="This connection request is incomplete"
        detail="It arrived without naming the application asking, or without saying where to send the reply. Both are required, so there is nowhere safe to send a result."
      />
    );
  }

  // Counted before the client is resolved; rendered, never redirected (see
  // the header).
  const limit = await checkIpRateLimit(
    clientIpFromHeaders(await headers()),
    '/oauth/authorize'
  );
  if (!limit.allowed) {
    const minutes = Math.max(1, Math.ceil((limit.retryAfter ?? 60) / 60));
    return (
      <Refusal
        title="Too many connection requests"
        detail={`More connection requests came from this network in the last hour than we accept. Try again in ${minutes === 1 ? 'a minute' : `${minutes} minutes`}.`}
      />
    );
  }

  /**
   * Only a `CimdError`'s `publicMessage` reaches the page. A metadata document
   * that loaded and is wrong keeps its specific reason, which the client's
   * developer needs; every failure to load one shows the same phrase
   * (`CIMD_UNREACHABLE`), and anything else shows a generic one. The whole
   * error goes to the server log.
   */
  let client: ResolvedClient | null = null;
  let clientError: string | null = null;
  try {
    client = await resolveClient(clientId);
  } catch (error) {
    console.error('The client_id could not be resolved:', error);
    clientError =
      error instanceof CimdError
        ? error.publicMessage
        : 'something failed on our side';
  }

  if (!client) {
    return (
      <Refusal
        title="We could not identify the application"
        detail={
          clientError
            ? `Its identity document could not be read: ${clientError}.`
            : 'It is not registered here, and it published no identity document we could read.'
        }
      />
    );
  }

  /**
   * The gate. Everything above rendered a refusal; everything below may
   * redirect, because from here the reply address is one the application
   * itself declared.
   */
  if (!redirectUriAllowed(redirectUri, client.redirectUris)) {
    return (
      <Refusal
        title="That reply address does not belong to this application"
        detail="The address this request asked us to send the result to is not one the application published. That is what a stolen authorization code looks like, so nothing was issued."
      />
    );
  }

  /**
   * Errors are collected, not thrown: the first one found is answered below,
   * before anything is stored. `redirect()` used to end the function on the
   * spot; a collector does not, which is why `if (problem) return` has to come
   * before the request is written.
   */
  type Problem = { error: string; description: string };
  let problem = null as Problem | null;
  const bounce = (error: string, description: string) => {
    problem ??= { error, description };
  };
  const deliverError = (p: Problem) => {
    if (redirectIsTrusted(redirectUri)) {
      const url = new URL(redirectUri);
      url.searchParams.set('error', p.error);
      url.searchParams.set('error_description', p.description);
      url.searchParams.set('iss', issuer());
      if (state) url.searchParams.set('state', state);
      redirect(url.toString());
    }
    return (
      <Refusal
        title="This connection request could not be completed"
        detail={`${p.description} (${p.error}) We send a browser on to an application automatically only at addresses we know, and ${new URL(redirectUri).hostname} is not one of them, so the answer is shown here.`}
      />
    );
  };

  // Every parameter but `resource` may appear once; `resource` may repeat
  // (RFC 8707 section 2), and every value is checked below.
  const repeated = repeatedParam(params);
  if (repeated) bounce('invalid_request', `${repeated} may appear only once.`);

  if (responseType !== 'code') {
    bounce(
      'unsupported_response_type',
      'This server issues authorization codes only.'
    );
  }
  if (!codeChallenge) {
    bounce(
      'invalid_request',
      'code_challenge is required. Every client here is public, so PKCE is not optional.'
    );
  }
  if (challengeMethod !== 'S256') {
    bounce(
      'invalid_request',
      'code_challenge_method must be S256. The plain method is not accepted.'
    );
  }
  if (!resourcesAreOurs(params.resource, mcpResource())) {
    bounce(
      'invalid_target',
      `This server issues tokens for ${mcpResource()} only.`
    );
  }

  /**
   * Scope is narrowed to what we grant, never widened to what was asked.
   *
   * A client asking for something unknown gets the intersection rather than an
   * error, which is what OAuth 2.1 permits and what keeps a client that guessed
   * at a scope name from being unable to connect at all. What it cannot do is
   * receive a scope it did not ask for, which is why the read scope is only
   * added when the request named it or named nothing.
   */
  const asked = requestedScope
    ? requestedScope.split(/\s+/).filter(Boolean)
    : null;
  const granted = asked
    ? SUPPORTED_SCOPES.filter((s) => asked.includes(s))
    : [MCP_SCOPE];
  if (!granted.includes(MCP_SCOPE)) {
    /**
     * The refusal is right and the old wording was not.
     *
     * Bouncing here follows the rule stated above: a client cannot receive a
     * scope it did not ask for, so a request naming only `offline_access`
     * cannot quietly be upgraded to include the read scope. What it is asking
     * for is a refresh token and no access, which is not a thing to grant.
     *
     * But the message said "the only scope this server grants is wallet:read",
     * and that is untrue: `SUPPORTED_SCOPES` holds both, and `redeemCode`
     * returns a refresh token precisely when `offline_access` was granted. A
     * client told the server grants one scope, by a server that advertises two
     * in its own metadata, learns nothing except that one of the two is lying.
     * Say which scope is required, and how to ask for the other.
     */
    bounce(
      'invalid_scope',
      `Every connection needs the ${MCP_SCOPE} scope. Ask for "${MCP_SCOPE}", ` +
        `or "${MCP_SCOPE} ${OFFLINE_SCOPE}" to also receive a refresh token, ` +
        `or omit the scope parameter entirely.`
    );
  }

  if (problem) return deliverError(problem);

  const id = await createAuthorizationRequest({
    clientId,
    redirectUri,
    codeChallenge: codeChallenge!,
    scope: granted.join(' '),
    // `resource=` counts as absent (OAuth 2.1 section 3.1), as it did above.
    resource: resource || mcpResource(),
    state,
  });
  if (!id) {
    return deliverError({
      error: 'server_error',
      description:
        'The authorization request could not be recorded. Try again.',
    });
  }

  redirect(`/oauth/authorize?req=${id}`);
}

async function renderConsent(requestId: string) {
  const pending = await loadPendingRequest(requestId);
  if (!pending) {
    return (
      <Refusal
        title="This connection request has expired"
        detail="A request waits half an hour for an answer, and this one has been waiting longer, or it has already been answered."
      />
    );
  }

  const client = await resolveClient(pending.clientId).catch(() => null);
  if (!client) {
    return (
      <Refusal
        title="We could not identify the application"
        detail="It was registered when the request arrived and is not now."
      />
    );
  }

  // Checked again before anything is shown: a metadata document can change
  // in the half hour a request waits, and the POST refuses that case anyway.
  if (!redirectUriAllowed(pending.redirectUri, client.redirectUris)) {
    return (
      <Refusal
        title="That reply address does not belong to this application"
        detail="The address this request asked us to send the result to is not one the application published. That is what a stolen authorization code looks like, so nothing was issued."
      />
    );
  }
  const view = consentView(client, pending.redirectUri);
  if (!view) {
    return (
      <Refusal
        title="That reply address could not be read"
        detail="The address this request asked us to send the result to is not a valid URL, so nothing was issued."
      />
    );
  }

  const sessionToken = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const session = sessionToken ? await validateSession(sessionToken) : null;

  return (
    <PageShell>
      <ConsentScreen
        requestId={requestId}
        {...view}
        email={session?.user?.email ?? null}
        keepsAccess={pending.scope.split(' ').includes(OFFLINE_SCOPE)}
      />
    </PageShell>
  );
}
