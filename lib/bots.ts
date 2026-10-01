/**
 * Crawlers, recognized by the product token in their User-Agent (STA-56).
 *
 * ## Why this exists
 *
 * On 2026-09-30, between 17:27 and 17:40 UTC, 28 sessions each recorded a
 * page view on `/` and a started lookup in the same second, with no referrer,
 * each one a different long-tail collection from the holder reports. Every
 * holder report links “Run these holders” to `/?collection=<chain>:<address>`,
 * and the homepage submits that collection on arrival. A crawler that renders
 * JavaScript and follows links therefore runs a lookup on every report it
 * reads, and each of those runs was counted as a person who tried the product.
 *
 * Two things read this module, and they must agree:
 *
 * - `app/api/jobs/route.ts` refuses to create a job for a crawler, so a
 *   crawler following a run link starts nothing.
 * - `app/api/analytics/track/route.ts` tags every event with `bot`, so the
 *   growth report can count crawler sessions apart from people instead of
 *   losing them.
 *
 * The public API (`/api/v1`, `/api/mcp`) does not read it. Its callers are
 * programs by design, and a program is not a crawler. An invariant holds that.
 *
 * ## Why a curated list and never `/bot/i`
 *
 * A bare `bot` matches phones. Cubot is a handset brand, and its browsers send
 * `CUBOT_X19` or `CUBOT P50` in the User-Agent. A pattern that refused those
 * would refuse a person, which this rule must never do: the cost of missing a
 * crawler is one unwanted lookup, and the cost of refusing a person is the
 * product not working for them with no explanation. So every entry below is a
 * product token a vendor documents, matched as a whole token, and the
 * invariants run real browser strings past the list as well as real crawler
 * strings.
 *
 * A token matches only where it stands alone: the character before it and the
 * character after it, where there is one, are not letters or digits.
 * `Googlebot/2.1`, `(compatible; GoogleOther)` and `Slackbot-LinkExpanding`
 * match; `TwitterAndroid` (the X app's in-app browser) does not match
 * `Twitterbot`, and `LinkedInApp` does not match `LinkedInBot`.
 *
 * ## What is not on it
 *
 * Plain HTTP clients (`curl`, `python-requests`, `Go-http-client`) are not
 * crawlers and never render the page, so they cannot follow a run link. A
 * request with no User-Agent at all is not refused either: absence is not a
 * signature. Both stay outside this rule deliberately.
 *
 * The user agent itself is never stored. `auth_sessions.user_agent` was
 * emptied for keeping a record of which browser somebody used for no purpose
 * (STA-45), and this keeps to that: an event records a yes or no, and for a
 * crawler the token below that recognized it, which names a crawler and not a
 * person.
 */

/**
 * Product tokens, in the spelling each vendor documents.
 *
 * Matched case-insensitively, and the first match in this order is the name
 * recorded, which is why `Chrome-Lighthouse` sits above `Lighthouse`: the
 * longer token has to be tried first or it can never be the one named.
 */
export const CRAWLER_SIGNATURES = [
  // Search engines, and the renderers they fetch pages with.
  'Googlebot',
  'Google-InspectionTool',
  'GoogleOther',
  'Google-CloudVertexBot',
  'Storebot-Google',
  'AdsBot-Google',
  'Mediapartners-Google',
  'APIs-Google',
  'FeedFetcher-Google',
  'Google-Read-Aloud',
  'bingbot',
  'BingPreview',
  'msnbot',
  'adidxbot',
  'Applebot',
  'DuckDuckBot',
  'DuckAssistBot',
  'YandexBot',
  'YandexRenderResourcesBot',
  'Baiduspider',
  'Sogou web spider',
  'Slurp',
  'SeznamBot',
  'Qwantbot',
  'MojeekBot',
  'PetalBot',
  'Exabot',
  // Answer engines and model trainers.
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-SearchBot',
  'Claude-User',
  'Claude-Web',
  'anthropic-ai',
  'PerplexityBot',
  'Perplexity-User',
  'CCBot',
  'Bytespider',
  'Amazonbot',
  'meta-externalagent',
  'meta-externalfetcher',
  'FacebookBot',
  'cohere-ai',
  'MistralAI-User',
  'YouBot',
  'AI2Bot',
  'Diffbot',
  'ImagesiftBot',
  'Timpibot',
  'archive.org_bot',
  'ia_archiver',
  // Link previews.
  'facebookexternalhit',
  'Twitterbot',
  'Slackbot',
  'Discordbot',
  'LinkedInBot',
  'TelegramBot',
  'Pinterestbot',
  'redditbot',
  'Embedly',
  'Iframely',
  // Search-engine optimization and site-audit crawlers.
  'AhrefsBot',
  'AhrefsSiteAudit',
  'SemrushBot',
  'SiteAuditBot',
  'MJ12bot',
  'DotBot',
  'rogerbot',
  'Screaming Frog SEO Spider',
  'serpstatbot',
  'BLEXBot',
  'DataForSeoBot',
  'Barkrowler',
  'SeekportBot',
  // Headless browsers, and the performance tools built on them.
  'HeadlessChrome',
  'Chrome-Lighthouse',
  'Lighthouse',
  'PageSpeed',
  'Page Speed Insights',
  'GTmetrix',
  'PTST',
  'UptimeRobot',
  'Pingdom',
] as const;

export type CrawlerSignature = (typeof CRAWLER_SIGNATURES)[number];

/**
 * What an event records as its `crawler` when the browser, not the User-Agent,
 * said it was automated: `navigator.webdriver` is true in a browser driven by
 * WebDriver or the DevTools protocol, whatever User-Agent it was given.
 */
export const WEBDRIVER = 'webdriver' as const;

/** The event the job route writes when it turns a crawler away. */
export const CRAWLER_REFUSAL_EVENT = 'crawler_lookup_refused' as const;

/**
 * The job route's answer to a crawler: a 200 that starts nothing.
 *
 * Not an error status. A crawler that records a 4xx or 5xx against the page
 * it rendered reports the page as broken, and the homepage reads a 200 with no
 * `jobId` as “nothing was started” and goes back to the front page.
 */
export const CRAWLER_SKIP = { status: 'skipped', reason: 'crawler' } as const;

/** A token as a literal: `archive.org_bot` has a dot in it. */
const literal = (token: string) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const SIGNATURE_PATTERNS = CRAWLER_SIGNATURES.map((name) => ({
  name,
  pattern: new RegExp(`(?:^|[^a-z0-9])${literal(name)}(?![a-z0-9])`, 'i'),
}));

/** The crawler a User-Agent names, or null for a browser or no header. */
export function crawlerFrom(
  userAgent: string | null | undefined
): CrawlerSignature | null {
  if (!userAgent) return null;
  for (const { name, pattern } of SIGNATURE_PATTERNS) {
    if (pattern.test(userAgent)) return name;
  }
  return null;
}

/**
 * An analytics event's metadata, as the ingest stores it.
 *
 * `bot` is decided here and nowhere else: a client cannot set it, clear it or
 * name a crawler, because whatever the body carried under `bot` or `crawler`
 * is dropped first. The one signal taken from the client is `webdriver: true`,
 * which only ever marks an event as automated and never clears a tag the
 * User-Agent earned. It is folded into `bot` and not kept on its own.
 *
 * Every event gets the key, `false` included. That is what lets the growth
 * report tell a person's session from one recorded before tagging began: the
 * first event carrying `bot` at all is the day crawlers start being counted
 * apart, and every row before it is untagged rather than human.
 *
 * The User-Agent is read and never returned.
 */
export function withCrawlerTag(
  metadata: unknown,
  userAgent: string | null | undefined
): Record<string, unknown> {
  const rest: Record<string, unknown> =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? { ...(metadata as Record<string, unknown>) }
      : {};
  const automated = rest.webdriver === true;
  delete rest.bot;
  delete rest.crawler;
  delete rest.webdriver;

  const crawler = crawlerFrom(userAgent) ?? (automated ? WEBDRIVER : null);
  return crawler ? { ...rest, bot: true, crawler } : { ...rest, bot: false };
}
