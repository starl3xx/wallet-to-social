/**
 * Where the X account resolver lives, and the key for it.
 *
 * ## Why this is a module and not two string literals
 *
 * The endpoint used to be a hardcoded URL in `lib/x-accounts.ts` and again in
 * `lib/clanker.ts`, and the key was read under a name that spelled out the
 * supplier. This repository is public. CLAUDE.md's rule is that we describe
 * capability and evidence class in public, never provenance, and two literals
 * plus an env-var name defeated that rule more completely than any sentence of
 * copy could: anyone could read which supplier answers our identity questions
 * straight out of the source.
 *
 * Naming it once, neutrally, and reading both halves from the environment keeps
 * the capability visible (there is a paid resolver, it is called here, here is
 * exactly what we ask it) and the provenance out of the repository.
 *
 * ## Configuration
 *
 * Set both in Vercel and in any workflow that sweeps:
 *
 *     X_RESOLVER_API_BASE   the origin, no trailing slash
 *     X_RESOLVER_API_KEY    the API key, sent as x-api-key
 *
 * `isConfigured()` is false when either is missing, and every caller degrades
 * rather than throwing: the sweep refuses to start with a clear message, and
 * the Clanker adapter leaves account ids unresolved for the next run to pick
 * up. Neither invents data, which is the only behaviour that would be worse
 * than doing nothing.
 */

export function resolverBase(): string {
  return (process.env.X_RESOLVER_API_BASE ?? '').replace(/\/+$/, '');
}

export function resolverKey(): string {
  return process.env.X_RESOLVER_API_KEY ?? '';
}

export function isConfigured(): boolean {
  return Boolean(resolverBase() && resolverKey());
}

/** The header set every request to the resolver carries. */
export function resolverHeaders(): Record<string, string> {
  return { 'x-api-key': resolverKey() };
}

/**
 * Build a resolver URL from a path.
 *
 * Throws when unconfigured rather than returning a URL against an empty origin,
 * which would produce a request to a relative path and fail somewhere far from
 * the cause.
 */
export function resolverUrl(path: string): string {
  const base = resolverBase();
  if (!base) throw new Error('X_RESOLVER_API_BASE is not set');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}
