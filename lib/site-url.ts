/**
 * The one place that decides what this site's public URL is.
 *
 * This existed in three places with three different fallbacks, and the
 * disagreement cost a real customer real money on 2026-08-15:
 *
 *   app/api/auth/verify   'https://walletlink.social'
 *   lib/email             'https://walletlink.social'
 *   lib/stripe            'http://localhost:3000'   <-- this one
 *
 * `NEXT_PUBLIC_URL` was never set in production, so Stripe Checkout was built
 * with `success_url: http://localhost:3000/success`. The buyer paid, Stripe
 * redirected them to a dead port on their own machine, they assumed the payment
 * had failed, and they paid a second time. Nothing errored anywhere: a localhost
 * fallback is indistinguishable from correct configuration until someone pays.
 *
 * So there is no localhost fallback here that production can reach. Local dev
 * gets localhost because it is genuinely local; a deployed environment resolves
 * to a real origin or throws.
 */

/**
 * The canonical production origin.
 *
 * The apex, and now genuinely so: as of 2026-08-15 Vercel serves
 * `walletlink.social` directly and 308-redirects `www` to it. Before that the
 * arrangement was reversed while `metadataBase`, `sitemap.ts`, `robots.ts` and
 * every canonical tag declared the apex, so each of those published a URL that
 * redirected.
 *
 * That split was not cosmetic. Stripe does not follow redirects, so a webhook
 * endpoint registered against the redirecting host failed every delivery from
 * 2026-01-17 onward and no payment ever provisioned an account. The X card
 * crawler hit the same redirect on `og:image` and served a stale card.
 *
 * The rule this leaves behind: a machine-to-machine URL must never point at a
 * redirect, and there must be exactly one declared origin. Everything now
 * resolves through this constant or agrees with it.
 */
export const PRODUCTION_URL = 'https://walletlink.social';

/**
 * The published documentation origin, with no trailing slash.
 *
 * A second origin, so it needs the same treatment as the first. It was
 * written out by hand in eight places before this constant existed, two of
 * them machine-to-machine surfaces where the rule above applies with full
 * force: `lib/oauth/metadata.ts` hands this host to an MCP client as
 * `resource_documentation`, and `app/api/api-catalog` publishes it to
 * anything that discovers the API catalog.
 *
 * The prose links in the comparison pages still spell it out. They are
 * `href`s a person clicks, where a redirect costs nothing and a constant
 * buys nothing, so they were left alone rather than swept.
 *
 * Verified 2026-09-21 to answer 200 directly, not 30x: docs.walletlink.social
 * serves `/openapi.yaml`, `/api-reference/introduction`, `/mcp-server` and
 * `/agent-pack` with no redirect in front of any of them.
 */
export const DOCS_URL = 'https://docs.walletlink.social';

/**
 * The legal entity behind the site.
 *
 * Here because it was in two places and got written a third time from memory,
 * as "Starl3xx Labs", on the one page where the name is a legal claim rather
 * than a footer credit. The footer and `llms.txt` had said "Starl3xx Labs LLC"
 * all along: the correct value was in the repository and was not read.
 *
 * A name is exactly the kind of fact that looks too obvious to check, which is
 * why it is the kind that drifts. One constant, three readers, and
 * `scripts/check-invariants.ts` asserts none of them spells it out.
 */
export const LEGAL_ENTITY = 'Starl3xx Labs LLC';

/**
 * Absolute origin for the current environment, with no trailing slash.
 *
 * Order matters: an explicit `NEXT_PUBLIC_URL` always wins so a deployment can
 * be pointed somewhere else without a code change, then the known production
 * origin, then the per-deployment preview URL, then localhost for local dev.
 */
export function getSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');

  // Set by Vercel on every deployment: 'production' | 'preview' | 'development'.
  if (process.env.VERCEL_ENV === 'production') return PRODUCTION_URL;

  // Preview deployments get their own hostname, supplied without a scheme.
  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl)
    return `https://${vercelUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;

  // Anything still running on Vercel at this point has no origin we can name,
  // and guessing produces exactly the silent breakage this module exists to
  // stop. Fail loudly instead.
  if (process.env.VERCEL) {
    throw new Error(
      'Cannot resolve site URL: running on Vercel but neither NEXT_PUBLIC_URL, ' +
        'VERCEL_ENV=production nor VERCEL_URL is set.'
    );
  }

  return 'http://localhost:3000';
}
