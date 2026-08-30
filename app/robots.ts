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
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: ['/api/public-stats', '/'],
      disallow: ['/api/', '/_next/'],
    },
    sitemap: 'https://walletlink.social/sitemap.xml',
  };
}
