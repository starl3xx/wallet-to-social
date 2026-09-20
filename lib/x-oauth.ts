/**
 * walletlink as an OAuth *client* of X, for writing a list to someone's own
 * account.
 *
 * Every other OAuth file in this repository is the other direction:
 * `lib/oauth/*` makes the MCP server a resource that other clients connect to.
 * This is the first place we are the client, and the difference is the whole
 * reason for the care around it. As a server we hand out credentials we can
 * revoke; as a client we hold somebody else's credential and can act as them
 * until it expires.
 *
 * ## The scopes, and the one that is missing
 *
 * `users.read tweet.read list.read list.write`, and deliberately NOT
 * `offline_access`.
 *
 * Omitting it is the design. With `offline_access` X returns a refresh token,
 * which is a standing ability to act as that person until they revoke it, and
 * storing one means a permanent store of recoverable third-party credentials:
 * rotation, reuse detection, an erase path that has to reach X before deleting,
 * and a suppression quarantine holding live tokens for its undo window. Without
 * it we get an access token that expires in two hours, which is longer than the
 * job needs and short enough that the worst case for a database leak is a
 * handful of tokens that die on their own.
 *
 * The visible cost is that a second list needs a second authorization. For a
 * once-per-collection action that is a fair trade, and it is reversible: adding
 * the scope later is a one-line change plus the storage that comes with it.
 *
 * `tweet.read` is required by X alongside `list.write` even though nothing here
 * reads a post. It is not optional and not an oversight.
 *
 * ## Configuration
 *
 *     X_OAUTH_CLIENT_ID       from the X developer portal
 *     X_OAUTH_CLIENT_SECRET   the same app's secret, confidential client
 *
 * `isConfigured()` is false when either is missing, and every caller answers
 * 503 rather than starting a flow it cannot finish, which is the pattern
 * `app/api/x402/recover/route.ts` already follows for its own secret.
 */
import { getSiteUrl } from './site-url';

/** X's own endpoints. Public URLs, not provenance: this is a named platform. */
export const X_AUTHORIZE_URL = 'https://x.com/i/oauth2/authorize';
export const X_TOKEN_URL = 'https://api.x.com/2/oauth2/token';
export const X_API_BASE = 'https://api.x.com/2';

/**
 * The scopes requested, in the order X documents them.
 *
 * `offline_access` is absent on purpose. See the module comment; it is the
 * single decision this file exists to record.
 */
export const X_SCOPES = [
  'users.read',
  'tweet.read',
  'list.read',
  'list.write',
] as const;

/**
 * X caps a list name at 25 characters and a description at 100.
 *
 * Here rather than at the call site because both are enforced twice: the table
 * has a CHECK on each, and a job that fails the CHECK is better than one that
 * runs for sixteen minutes and is refused by the API at the end.
 */
export const X_LIST_NAME_MAX = 25;
export const X_LIST_DESCRIPTION_MAX = 100;

/**
 * X's cap on members in a list.
 *
 * Not enforced by us as a refusal but as a truncation with a stated count: a
 * holder list above this is a real thing a customer will bring, and silently
 * building a partial list is the failure this number exists to make visible.
 */
export const X_LIST_MEMBER_MAX = 5000;

/**
 * Our own X account, added to every list the tool builds.
 *
 * The numeric id, not the handle, and that is the whole point of storing it
 * this way: a handle is a string its owner can change, and the one thing this
 * codebase keeps establishing is that an id survives a rename while a handle
 * does not. Hardcoding the handle would mean a rename quietly adding a
 * stranger to every customer list we build.
 *
 * Read from `x_accounts` on 2026-09-20, where it resolves live. The handle
 * beside it is for display and for the job row to be readable by a person;
 * nothing is looked up by it.
 */
export const WALLETLINK_X_USER_ID = '2014216494800936960';
export const WALLETLINK_X_HANDLE = 'walletlinketh';

/**
 * Member additions allowed per fifteen minutes on user auth, one member each.
 *
 * The worker's whole shape comes from this number. A 319-member list is 319
 * requests and crosses a window boundary, so the work cannot live in a request
 * handler and a part-built list has to resume rather than restart.
 */
export const X_MEMBER_ADDS_PER_WINDOW = 300;
export const X_RATE_WINDOW_MS = 15 * 60 * 1000;

export function clientId(): string {
  return process.env.X_OAUTH_CLIENT_ID ?? '';
}

export function clientSecret(): string {
  return process.env.X_OAUTH_CLIENT_SECRET ?? '';
}

export function isConfigured(): boolean {
  return Boolean(clientId() && clientSecret());
}

/**
 * Where X sends the person back.
 *
 * Derived from `getSiteUrl()` rather than an environment variable of its own,
 * so it cannot disagree with the origin the rest of the app believes it is on.
 * X matches this string exactly against the callback registered in the
 * developer portal, so a trailing slash or a wrong scheme is a refusal at the
 * consent screen rather than anything we can detect here.
 */
export function redirectUri(): string {
  return `${getSiteUrl().replace(/\/+$/, '')}/api/x/callback`;
}

/**
 * The Basic credential for the token endpoint.
 *
 * X requires HTTP Basic for a confidential client, and sending the secret in
 * the body instead is accepted by some providers and refused by this one.
 */
export function basicAuthHeader(): string {
  const raw = `${clientId()}:${clientSecret()}`;
  return `Basic ${Buffer.from(raw).toString('base64')}`;
}
