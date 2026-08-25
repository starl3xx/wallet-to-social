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
 * A parameter error is answered one of two ways, and the distinction is the
 * single most important rule on this page. Until `redirect_uri` has been
 * checked against the client's own declared list, it is a string a stranger
 * typed, and redirecting to it would make this an open redirect that reports
 * OAuth errors. Those failures render here instead. Once the redirect is known
 * to belong to the client, an error is delivered there, because that is where
 * the client is waiting and a rendered page it never sees is a hung connection.
 */
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import type { Metadata } from 'next';
import { PageShell } from '@/components/ui/page-shell';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth';
import {
  resolveClient,
  redirectUriAllowed,
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

/**
 * Compare a requested `resource` against ours.
 *
 * RFC 8707 section 2 makes the resource a URI, so a trailing slash and the case
 * of the scheme and host are not differences a client should be refused over,
 * while the path is. A user who typed the MCP URL with a trailing slash gets a
 * working connection; a token requested for some other server does not.
 */
function sameResource(requested: string, ours: string): boolean {
  try {
    const a = new URL(requested);
    const b = new URL(ours);
    return (
      a.protocol === b.protocol &&
      a.host.toLowerCase() === b.host.toLowerCase() &&
      a.pathname.replace(/\/+$/, '') === b.pathname.replace(/\/+$/, '')
    );
  } catch {
    return false;
  }
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

  let client: ResolvedClient | null = null;
  let clientError: string | null = null;
  try {
    client = await resolveClient(clientId);
  } catch (error) {
    clientError = error instanceof Error ? error.message : 'unknown';
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

  const bounce = (error: string, description: string) => {
    const url = new URL(redirectUri);
    url.searchParams.set('error', error);
    url.searchParams.set('error_description', description);
    url.searchParams.set('iss', issuer());
    if (state) url.searchParams.set('state', state);
    redirect(url.toString());
  };

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
  if (resource && !sameResource(resource, mcpResource())) {
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
    bounce(
      'invalid_scope',
      `The only scope this server grants is ${MCP_SCOPE}.`
    );
  }

  const id = await createAuthorizationRequest({
    clientId,
    redirectUri,
    codeChallenge: codeChallenge!,
    scope: granted.join(' '),
    resource: resource ?? mcpResource(),
    state,
  });
  if (!id) {
    bounce(
      'server_error',
      'The authorization request could not be recorded. Try again.'
    );
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

  const sessionToken = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const session = sessionToken ? await validateSession(sessionToken) : null;

  return (
    <PageShell>
      <ConsentScreen
        requestId={requestId}
        displayHost={client.displayHost}
        claimedName={client.claimedName}
        verified={client.isCimd}
        email={session?.user?.email ?? null}
        keepsAccess={pending.scope.split(' ').includes(OFFLINE_SCOPE)}
      />
    </PageShell>
  );
}
