import type { MetadataRoute } from 'next';

/**
 * One group, and deliberately only one.
 *
 * A crawler obeys exactly one group: the one matching its own product token.
 * Once it finds that group it ignores the wildcard group entirely (RFC 9309,
 * section 2.2.1). So a named group for an answer engine is not a free
 * annotation. The moment it stops repeating both lists below verbatim, it
 * grants that engine `/api/` and `/_next/`, and nothing anywhere errors.
 *
 * Naming them buys nothing to offset that risk. A named group carrying these
 * same two lists was measured to resolve identically to this one for every
 * bot, so the file would be ten lines longer and behave the same. The rosters
 * also rot: OpenAI documents four tokens and Anthropic three, and a vendor
 * adds one whenever it ships a product. The decision is recorded here instead,
 * where it cannot open a path:
 *
 *   Answer engines get exactly what every other crawler gets. Nothing is
 *   blocked from a search or answer surface, and nothing is opted out of.
 *
 * Two vendor facts worth keeping, because getting either backwards is the one
 * edit here that can silently delete this site from AI answers. Blocking
 * GPTBot would not remove the site from ChatGPT search: OAI-SearchBot governs
 * that, and they are controlled separately. Google-Extended is a training and
 * grounding control, not a crawler, and blocking it does not affect inclusion
 * in AI Overviews.
 *
 * `/api/public-stats` is keyless, holds no customer data, and is the live
 * source for the index figure the homepage renders over its static fallback.
 * It is allowed so a crawler that runs the page's JavaScript reads the figure
 * rather than recording a blocked resource. It beats `Disallow: /api/` by
 * longest match, 17 octets against 5 (RFC 9309, section 2.2.2).
 *
 * `/_next/static` and `/_next/image` are allowed for the same reason, and
 * getting this wrong is the quieter of the two failures this file can cause.
 * Every page loads its stylesheet, its fonts and its JavaScript from
 * `/_next/static`, so a blanket `Disallow: /_next/` tells Googlebot it may
 * fetch the HTML and not the things that render it. Nothing errors; the
 * pages simply get judged on a degraded rendering, which Search Console
 * reports as "Blocked by robots.txt" against resource URLs rather than
 * against any page a person would recognise. Google's guidance is explicit
 * that resources needed for rendering must stay crawlable. Both beat
 * `Disallow: /_next/` by longest match (13 and 12 octets against 7).
 *
 * The rest of `/_next/` stays blocked. That is where the build manifests and
 * the RSC payloads live: never useful in an index, and duplicative of the
 * HTML when they are readable at all.
 *
 * `/api/` stays disallowed, which has one known cost. A URL that robots.txt
 * refuses cannot be read, so a `noindex` on it cannot be seen either, and
 * Google may still index the bare URL on external signal alone: the
 * "Indexed, though blocked by robots.txt" state. The alternative is to allow
 * `/api/` and answer with `X-Robots-Tag: noindex`, which is the only way to
 * make Google actually drop a URL. Not taken here, because it would open
 * every metered route to crawl traffic to fix a cosmetic report. Revisit only
 * if an `/api/` URL ever ranks for something a customer would search.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: ['/api/public-stats', '/_next/static', '/_next/image', '/'],
      disallow: ['/api/', '/_next/'],
    },
    sitemap: 'https://walletlink.social/sitemap.xml',
  };
}
