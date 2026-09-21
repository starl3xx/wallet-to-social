/**
 * /robots.txt, hand-serialized.
 *
 * This was `app/robots.ts`, the Next metadata convention, until content
 * signals had to go in it. That convention is not a template: Next serializes
 * the object you return through `resolveRobots`, which emits only
 * `User-Agent`, `Allow`, `Disallow`, `Crawl-delay`, `Host` and `Sitemap`.
 * Comments are impossible and an unknown key is dropped in silence, so a
 * `contentSignal` property would have type-errored at best and vanished at
 * worst. A Route Handler is the documented escape hatch and the only way to
 * emit a directive the framework has never heard of.
 *
 * `force-static` because this file reads nothing. The warning in
 * `app/api/starter-collections/route.ts` is about what `force-static` does to
 * a handler that DOES read something: Next runs the GET during every build,
 * so a database read becomes a build-time dependency. Nothing below touches
 * the network, the filesystem or the request, so it prerenders once and is
 * served from the edge, which is what a robots.txt should be.
 *
 * ── The rules ────────────────────────────────────────────────────────────
 *
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
 * against any page a person would recognize. Google's guidance is explicit
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
import { PRODUCTION_URL } from '@/lib/site-url';

export const dynamic = 'force-static';

/**
 * The Cloudflare Content Signals Policy, released under CC0 and reproduced
 * verbatim.
 *
 * Verbatim is the whole point. These paragraphs are the definition the
 * machine-readable line below refers to, and the last one is an express
 * reservation of rights under Article 4 of EU Directive 2019/790. A signal
 * without the policy is a bare token whose meaning nobody has agreed to; a
 * policy that has been paraphrased no longer says what every other site
 * carrying it says.
 *
 * So the house style is suspended inside this string, deliberately. The
 * straight apostrophe in "website's", the double space after "contents)." and
 * the shouted final paragraph are all as published. Prettier does not reflow
 * a template literal, and nothing else should either. robots.txt is a machine
 * file, not UI.
 *
 * Source: https://blog.cloudflare.com/content-signals-policy/
 */
const CONTENT_SIGNALS_POLICY = `# As a condition of accessing this website, you agree to abide by the following content signals:
#
# (a) If a content-signal = yes, you may collect content for the corresponding use.
# (b) If a content-signal = no, you may not collect content for the corresponding use.
# (c) If the website operator does not include a content signal for a corresponding use, the website operator neither grants nor restricts permission via content signal with respect to the corresponding use.
#
# The content signals and their meanings are:
#
# search: building a search index and providing search results (e.g., returning hyperlinks and short excerpts from your website's contents).  Search does not include providing AI-generated search summaries.
# ai-input: inputting content into one or more AI models (e.g., retrieval augmented generation, grounding, or other real-time taking of content for generative AI search answers).
# ai-train: training or fine-tuning AI models.
#
# ANY RESTRICTIONS EXPRESSED VIA CONTENT SIGNALS ARE EXPRESS RESERVATIONS OF RIGHTS UNDER ARTICLE 4 OF THE EUROPEAN UNION DIRECTIVE 2019/790 ON COPYRIGHT AND RELATED RIGHTS IN THE DIGITAL SINGLE MARKET.`;

/**
 * What this site permits once a crawler has the bytes.
 *
 * `Allow` and `Disallow` govern access; a content signal governs use after
 * access. They are separate axes, and the rules above only ever decided the
 * first one. This line decides the second, and all three are `yes`:
 *
 *   search=yes     Everything here is meant to be found. Nothing changes.
 *
 *   ai-input=yes   This is the growth channel, not a concession. Assistants
 *                  reach this site by grounding an answer in it at query
 *                  time, and that traffic converts better than search does.
 *                  `ai-input=no` would be a request to be left out of the
 *                  answers this product is written to appear in. Note that it
 *                  is the ai-input signal, not ai-train, that governs a
 *                  ChatGPT or Perplexity citation.
 *
 *   ai-train=yes   Chosen on 2026-09-21, and the one that is a real choice.
 *                  Cloudflare's managed default is `ai-train=no`, so this
 *                  departs from what most adopters serve. The reason is that
 *                  a model which already knows what walletlink.social is
 *                  recommends it unprompted, with no crawl and no citation
 *                  needed, and weights are the only place that knowledge can
 *                  live. Withholding it buys a reservation of rights this
 *                  site has no intention of enforcing, at the price of the
 *                  one channel it is trying to grow.
 *
 * Absence is not denial. Paragraph (c) above says an omitted signal grants
 * and restricts nothing, so dropping one of these three is not a quiet `no`,
 * it is a refusal to answer. Say yes or say no; do not delete.
 *
 * This is a preference, not a control. Nothing here enforces anything, and a
 * crawler that ignores it breaks no code path. Enforcement, if it is ever
 * wanted, is a WAF rule and has to be built somewhere else.
 */
const CONTENT_SIGNAL = 'search=yes, ai-input=yes, ai-train=yes';

/**
 * Two lists, in longest-match order for a human reader's benefit only.
 *
 * RFC 9309 section 2.2.2 resolves a conflict by the length of the matched
 * path, not by the order the lines appear in, so nothing here depends on the
 * ordering. It is written most-specific-first so each carve-out sits above
 * the rule it carves out of.
 */
const ALLOW = ['/api/public-stats', '/_next/static', '/_next/image', '/'];
const DISALLOW = ['/api/', '/_next/'];

/**
 * `Content-Signal` goes inside the group, directly under its `User-Agent`.
 *
 * It is scoped to the group the way `Allow` is, not a standalone directive
 * like `Sitemap`. Cloudflare's own robots.txt gets this wrong: it appends the
 * line after its last named group, where RFC 9309 grouping attaches it to
 * that one crawler instead of to everybody. One group here, so the placement
 * is unambiguous either way, but it is placed correctly regardless.
 *
 * An RFC 9309 parser must ignore a line it does not recognize, so this costs
 * nothing with crawlers that have never heard of content signals.
 */
function buildRobotsTxt(): string {
  const group = [
    'User-Agent: *',
    `Content-Signal: ${CONTENT_SIGNAL}`,
    ...ALLOW.map((path) => `Allow: ${path}`),
    ...DISALLOW.map((path) => `Disallow: ${path}`),
  ].join('\n');

  return `${CONTENT_SIGNALS_POLICY}\n\n${group}\n\nSitemap: ${PRODUCTION_URL}/sitemap.xml\n`;
}

export function GET(): Response {
  return new Response(buildRobotsTxt(), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
    },
  });
}
