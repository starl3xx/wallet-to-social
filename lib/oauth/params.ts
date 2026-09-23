/**
 * Rules for the parameters of an authorization request that are easier to
 * test as plain functions than inside the page that applies them.
 */

/**
 * Parameters that may appear once (OAuth 2.1 section 3.1). `client_id` and
 * `redirect_uri` are refused earlier, before any client lookup; `resource`
 * may repeat (RFC 8707 section 2) and is checked value by value instead.
 */
export const ONCE_PARAMS = [
  'response_type',
  'code_challenge',
  'code_challenge_method',
  'state',
  'scope',
] as const;

/** The first parameter in ONCE_PARAMS that appears more than once, or null. */
export function repeatedParam(
  params: Record<string, string | string[] | undefined>
): string | null {
  return ONCE_PARAMS.find((key) => Array.isArray(params[key])) ?? null;
}

/**
 * Compare a requested `resource` against ours.
 *
 * RFC 8707 section 2 makes the resource a URI, so a trailing slash and the case
 * of the scheme and host are not differences a client should be refused over,
 * while the path is. A user who typed the MCP URL with a trailing slash gets a
 * working connection; a token requested for some other server does not.
 */
export function sameResource(requested: string, ours: string): boolean {
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

/**
 * Whether every requested resource is ours. A request naming ours and
 * another server's would otherwise get a token scoped to ours while the
 * client believes it is good for both, which is the leak that audience
 * restriction exists to prevent.
 */
export function resourcesAreOurs(
  requested: string | string[] | undefined,
  ours: string
): boolean {
  const values =
    requested === undefined
      ? []
      : Array.isArray(requested)
        ? requested
        : [requested];
  return values.every((r) => sameResource(r, ours));
}
