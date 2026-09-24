/**
 * The two questions asked about a JSON-RPC body before the MCP layer sees it.
 *
 * They live here rather than beside the handler for one reason: a Next.js route
 * file may export only its handlers and its config, so a predicate defined
 * there cannot be imported by `scripts/check-invariants.ts`. The gate is the
 * part of the MCP server most worth asserting against, and an assertion that
 * cannot reach the code it is about is not an assertion.
 *
 * The two questions look similar and are opposites, which is the thing to hold
 * on to when editing either.
 */

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function methodsIn(raw: string): string[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const calls = Array.isArray(parsed) ? parsed : [parsed];
  return calls.map((call) => {
    const method = asObject(call)?.method;
    return typeof method === 'string' ? method : '';
  });
}

/**
 * The only JSON-RPC methods that reach something which meters.
 *
 * An allowlist of the metered side, deliberately, because the first version
 * allowlisted the other side and that was the wrong way round. It named the
 * handshake methods and bounded those, so every method it had not thought of,
 * `resources/read`, `prompts/get`, `notifications/cancelled` and any string a
 * caller invented, fell through to the unbounded branch. The MCP layer refuses
 * all of those, which means they reach no meter at all, which is exactly the
 * surface the limit exists to cover.
 *
 * Listing what is metered cannot fail that way. A method missing from this set
 * is bounded, which is the safe direction, and adding one is a deliberate act
 * by somebody who has checked that it reaches a handler that charges for it.
 */
export const METERED_METHODS = new Set(['tools/call']);

/**
 * Whether every call in this body reaches a per-key meter, and may therefore
 * skip the IP limit.
 *
 * `every`, not `some`. A batch of ninety-nine `tools/list` calls with one
 * `tools/call` appended would otherwise buy the whole batch a free pass, and
 * the appended call costs an attacker nothing when the key is junk. A mixed
 * batch is therefore bounded, which costs a real client one count out of 120
 * an hour and costs that attacker the entire budget.
 *
 * A body that is not JSON, or carries no method, is not metered either: it is
 * refused before it reaches a handler, so it belongs on the bounded side.
 */
export function isMetered(raw: string): boolean {
  const methods = methodsIn(raw);
  if (methods === null || methods.length === 0) return false;
  return methods.every((method) => METERED_METHODS.has(method));
}

/**
 * Whether this body contains a `tools/call`, and therefore needs a credential.
 *
 * The opposite quantifier to `isMetered`, on purpose. That one asks whether
 * *every* call is metered so it can decide about the IP limit; this asks
 * whether *any* is, so it can decide about the 401. A batch mixing `tools/list`
 * with a `tools/call` has to be challenged, or the challenge is skipped by
 * appending a handshake method to it, which is the same mistake in the other
 * direction.
 *
 * Both are safe: a mixed batch is bounded by the IP limit *and* challenged.
 */
export function callsATool(raw: string): boolean {
  const methods = methodsIn(raw);
  if (methods === null) return false;
  return methods.some((method) => METERED_METHODS.has(method));
}

/**
 * What the MCP route knows about the credential a request carried, once it
 * has looked.
 *
 * - `none`: no Authorization header at all.
 * - `account`: a credential that works, and the account it belongs to.
 * - `dead-token`: an OAuth access token that no longer works. The ordinary
 *   case, not the exceptional one: access tokens last an hour.
 * - `unverified`: anything else. A string that is neither kind of credential,
 *   a `wts_live_` key that does not validate, or a key the route did not look
 *   up because the body is all tool calls and the v1 handler validates it
 *   anyway. None of these names an account, so none buys the account bucket.
 */
export type McpCredential =
  | { kind: 'none' }
  | { kind: 'unverified' }
  | { kind: 'account'; userId: string }
  | {
      kind: 'dead-token';
      reason: 'unknown' | 'expired' | 'revoked' | 'audience';
    };

export type GateDecision =
  | {
      action: 'challenge';
      error: 'invalid_token' | undefined;
      description: string;
    }
  | { action: 'pass' }
  | {
      action: 'limit';
      subject: string;
      endpoint: '/api/mcp' | '/api/mcp:account';
    };

/**
 * The challenge for a tool call with no credential. The machine path rides
 * along: for an autonomous caller a refusal without a remedy is a dead end,
 * not a prompt. No double quotes, since it is embedded in a quoted
 * WWW-Authenticate parameter.
 */
export const NO_CREDENTIAL_DESCRIPTION =
  'This tool needs a walletlink.social account. Connect one, or set an Authorization header carrying an API key. An agent holding a wallet can buy a key with USDC at POST https://walletlink.social/api/x402/buy, documented at https://docs.walletlink.social/agent-pack.';

export function deadTokenDescription(
  reason: 'unknown' | 'expired' | 'revoked' | 'audience'
): string {
  return reason === 'expired'
    ? 'This access token has expired. Refresh it.'
    : reason === 'audience'
      ? 'This access token was issued for a different server. Connect again.'
      : reason === 'revoked'
        ? 'This connection was revoked. Connect again.'
        : 'This access token is not recognized.';
}

/**
 * What the MCP route does with a request, before the MCP layer sees it.
 *
 * Pure, so the whole policy can be asserted without a request or a database.
 * The order is the policy:
 *
 * 1. **A dead access token is challenged, on every method.** The MCP
 *    authorization spec says an invalid or expired token MUST get a 401, and
 *    it says so of every request, not only of tool calls. Answering the
 *    handshake with 200 left a client with an expired token believing it was
 *    connected. Challenged before any bucket is charged: tokens expire hourly
 *    for every hosted user, and charging the refusal would refill the very
 *    bucket this change takes them out of.
 * 2. **A tool call with no credential is challenged.** Lazy authentication:
 *    `initialize` and `tools/list` still answer anonymously, so a client can
 *    connect and see the tools, and the challenge arrives only when one is
 *    called.
 * 3. **A body of nothing but tool calls passes.** It reaches a v1 handler that
 *    meters it per key, and a key that is wrong is told so there, in words. A
 *    mistyped `wts_live_` key is never challenged: a 401 would answer a typo
 *    with a consent screen.
 * 4. **Everything else is bounded.** Per account when the credential works,
 *    because hosted clients share one outbound address. Per address
 *    otherwise, and "otherwise" includes any string that merely looks like a
 *    credential: `Bearer hunter2` names no account and buys nothing.
 */
export function decide(
  body: string | undefined,
  cred: McpCredential,
  ip: string
): GateDecision {
  if (cred.kind === 'dead-token') {
    return {
      action: 'challenge',
      error: 'invalid_token',
      description: deadTokenDescription(cred.reason),
    };
  }
  if (body !== undefined && callsATool(body) && cred.kind === 'none') {
    return {
      action: 'challenge',
      error: undefined,
      description: NO_CREDENTIAL_DESCRIPTION,
    };
  }
  if (body !== undefined && isMetered(body)) return { action: 'pass' };
  if (cred.kind === 'account') {
    return {
      action: 'limit',
      subject: `user:${cred.userId}`,
      endpoint: '/api/mcp:account',
    };
  }
  return { action: 'limit', subject: ip, endpoint: '/api/mcp' };
}

/**
 * The three 429 texts, one per kind of caller, each naming the limit it hit.
 *
 * The old single text told every caller to configure an API key, including
 * callers who had one and OAuth users who cannot use one, and configuring a
 * key never lifted the limit anyway. Each text now says what the caller can
 * actually do. The numbers are passed in from `IP_RATE_LIMITS`, never
 * written here.
 */
export function anonDiscoveryLimited(limit: number): string {
  return `Too many requests from this address without a credential: the limit is ${limit} an hour. Connect a walletlink.social account through your client’s sign-in, or send Authorization: Bearer wts_live_… with an API key, and requests are counted against your account instead.`;
}

export function unverifiedCredentialLimited(limit: number): string {
  return `Too many requests from this address. The Authorization header did not carry a working walletlink.social credential, so this request counted against the limit of ${limit} an hour per address. Check the key, or connect your account again.`;
}

export function accountDiscoveryLimited(limit: number): string {
  return `This account sent more than ${limit} connection and listing requests in the last hour. Tool calls are not counted. Try again after the time in Retry-After.`;
}

export function refusalFor(
  cred: McpCredential,
  limits: { anonymous: number; account: number }
): string {
  if (cred.kind === 'account') return accountDiscoveryLimited(limits.account);
  if (cred.kind === 'unverified') {
    return unverifiedCredentialLimited(limits.anonymous);
  }
  return anonDiscoveryLimited(limits.anonymous);
}

/**
 * The JSON-RPC id to answer a refusal with: the request's own, when the body
 * is a single call that carries one, and null otherwise, as the spec asks
 * when the id cannot be determined.
 */
export function requestIdOf(body: string | undefined): string | number | null {
  if (body === undefined) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  const id = asObject(parsed)?.id;
  return typeof id === 'string' || typeof id === 'number' ? id : null;
}
