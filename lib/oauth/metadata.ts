/**
 * The two discovery documents that make the MCP server an OAuth resource.
 *
 * A client that reaches `/api/mcp` without a credential gets a 401 naming the
 * protected resource metadata; that document names this authorization server;
 * that document names the endpoints. Nothing is hard-coded on the client side,
 * which is the point of the chain.
 *
 * Every URL here is built from `getSiteUrl()`, so a preview deployment
 * advertises itself and not production. That matters more than it sounds:
 * a preview that advertised the production issuer would send a tester's
 * consent to production and hand back a token minted for the wrong resource.
 */
import { getSiteUrl } from '@/lib/site-url';

/**
 * The one scope, and it is one on purpose.
 *
 * The obvious second scope is an account-reading one covering the balance
 * tool, and it would be a lie. An access token issued here is an `api_keys`
 * row, so it reaches `/v1/usage` over plain REST whatever this string says.
 * A scope that the REST surface does not enforce is a consent screen making a
 * promise no code keeps, and this repo has already shipped four comments that
 * asserted a security property with nothing able to contradict them.
 *
 * So: one scope, covering everything the token can actually reach, on both
 * surfaces. Splitting it is a change to `lib/api-auth.ts` first and to this
 * constant second, never the other way round.
 */
export const MCP_SCOPE = 'wallet:read';

/**
 * Requested by clients that want a refresh token, and honoured rather than
 * ignored: `lib/oauth/grants.ts` issues one only when this is in the granted
 * scope. Advertised in the authorization server metadata and deliberately not
 * in the protected resource metadata, because a refresh token is not something
 * the resource requires. The MCP specification says exactly that.
 */
export const OFFLINE_SCOPE = 'offline_access';

export const SUPPORTED_SCOPES = [MCP_SCOPE, OFFLINE_SCOPE];

/** The canonical resource identifier, RFC 8707 section 2: no fragment, no trailing slash. */
export function mcpResource(): string {
  return `${getSiteUrl()}/api/mcp`;
}

export function issuer(): string {
  return getSiteUrl();
}

/**
 * RFC 9728. Served at both `/.well-known/oauth-protected-resource` and the
 * path-suffixed `/.well-known/oauth-protected-resource/api/mcp`, because a
 * client whose 401 pointer went missing probes the suffixed form first.
 *
 * `resource` must equal the MCP URL exactly as a user types it into their
 * client, which is why it carries the `/api/mcp` path rather than the bare
 * origin.
 */
export function protectedResourceMetadata(): Record<string, unknown> {
  return {
    resource: mcpResource(),
    authorization_servers: [issuer()],
    bearer_methods_supported: ['header'],
    scopes_supported: [MCP_SCOPE],
    resource_name: 'walletlink.social MCP server',
    resource_documentation: 'https://docs.walletlink.social/mcp-server',
  };
}

/**
 * RFC 8414.
 *
 * `client_id_metadata_document_supported` and `"none"` in
 * `token_endpoint_auth_methods_supported` must both be present or a Claude
 * client silently falls back to dynamic registration, which would register a
 * fresh client on every connection. Both are here, and
 * `scripts/check-invariants.ts` asserts the pair rather than trusting this
 * comment.
 *
 * `registration_endpoint` stays advertised anyway, for clients that do not
 * implement metadata documents.
 */
export function authorizationServerMetadata(): Record<string, unknown> {
  const site = getSiteUrl();
  return {
    issuer: issuer(),
    authorization_endpoint: `${site}/oauth/authorize`,
    token_endpoint: `${site}/api/oauth/token`,
    registration_endpoint: `${site}/api/oauth/register`,
    revocation_endpoint: `${site}/api/oauth/revoke`,
    scopes_supported: SUPPORTED_SCOPES,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
    service_documentation: 'https://docs.walletlink.social/mcp-server',
  };
}

/**
 * The `WWW-Authenticate` value on a 401 from the MCP endpoint.
 *
 * Naming `scope` here is what stops a client asking for everything in
 * `scopes_supported`. With one scope the two agree, but the header is still
 * the authoritative one for the operation, so it is the one that is built.
 */
export function wwwAuthenticate(
  error?: 'invalid_token' | 'insufficient_scope',
  description?: string
): string {
  const parts = [`Bearer realm="walletlink.social"`];
  if (error) parts.push(`error="${error}"`);
  if (description) parts.push(`error_description="${description}"`);
  parts.push(
    `resource_metadata="${getSiteUrl()}/.well-known/oauth-protected-resource/api/mcp"`
  );
  parts.push(`scope="${MCP_SCOPE}"`);
  return parts.join(', ');
}
