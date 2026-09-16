/**
 * Where somebody came from, recorded once per browser.
 *
 * ## Why this exists
 *
 * `users.origin` has been a column since the table was created and has never
 * held a value: 139 accounts, 139 nulls. `page_view` records a path and, when a
 * link carries `?ref=`, a campaign tag, and nothing else. So on 24 August a QR
 * auction sent 1,321 sessions and 37 signups at the site and the database has
 * no idea it happened. That is not a reporting gap, it is the reason nobody can
 * say whether any campaign has ever worked.
 *
 * ## What is kept, and what is deliberately thrown away
 *
 * The referring **host** and nothing else. A full referrer URL is a hazard: it
 * carries search queries, private document paths, and session tokens that
 * other sites put in their own query strings, none of which we asked for and
 * all of which we would then be holding. `referrerHost` exists to make that
 * discard structural rather than a habit, and the invariants push a URL with a
 * token in its query through it to prove nothing escapes.
 *
 * Campaign tags are clamped to a short safe alphabet for the same reason: they
 * arrive from the open internet and end up in a database column and an admin
 * table, so anything that is not plausibly a campaign name is not stored.
 *
 * ## First touch, not last
 *
 * The value is written once and never overwritten. Someone who arrives from a
 * cast, leaves, and returns by typing the address a week later was acquired by
 * the cast; recording "direct" at signup would credit the wrong thing and there
 * would be no way to notice. `users.acquisition` is likewise set on insert only.
 *
 * ## Not `users.origin`
 *
 * That column already means something: which rail minted the account, where
 * `'x402'` is read by `getBalance` to withhold the free allowance. A query
 * showing it held 139 nulls in 139 rows made it look unused, and unused and
 * unpopulated are different facts. Sharing it would have let a posted
 * `origin: "x402"` mint a magic-link account with no free matches.
 */

/** Campaign tags are short. Anything longer is not a campaign name. */
export const TAG_MAX_LENGTH = 64;

/** The whole summary, bounded so it cannot become a place to store text. */
export const ACQUISITION_MAX_LENGTH = 200;

/** What a visit with no referrer and no tags is called. */
export const DIRECT = 'direct';

export interface FirstTouch {
  /** Referring host, lowercased, no `www.`, never a path or query. */
  referrer?: string;
  /** `?ref=`, our own campaign tag. */
  ref?: string;
  /** `utm_source`, `utm_medium`, `utm_campaign`. */
  source?: string;
  medium?: string;
  campaign?: string;
}

/**
 * A campaign tag reduced to something safe to store and print.
 *
 * Anything outside the alphabet is dropped rather than escaped: this value
 * reaches a database column, an admin table and a CSV, and the set of contexts
 * a stray quote or angle bracket has to survive is larger than the set anybody
 * checks. A tag that needs punctuation we do not allow is not a tag.
 */
export function safeTag(raw: string | null | undefined): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '')
    .slice(0, TAG_MAX_LENGTH);
  return cleaned.length > 0 ? cleaned : undefined;
}

/**
 * The host that linked here, or null.
 *
 * Null for a visit with no referrer, for a referrer we cannot parse, and for
 * our own pages: an internal navigation is not an acquisition, and counting it
 * as one would make the site its own biggest traffic source within a day.
 */
export function referrerHost(
  referrer: string | null | undefined,
  selfHost: string
): string | null {
  if (typeof referrer !== 'string' || referrer.trim() === '') return null;
  let host: string;
  try {
    // Only the hostname is read. Everything else the URL carries, path, query,
    // fragment, credentials, is discarded here and never reaches a caller.
    host = new URL(referrer).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (host === '') return null;
  const bare = host.replace(/^www\./, '');
  const self = selfHost.toLowerCase().replace(/^www\./, '');
  if (bare === self) return null;
  // A host is not a campaign tag, but the same containment argument applies,
  // and a hostname that fails this is not one we can act on anyway.
  return /^[a-z0-9.-]{1,253}$/.test(bare) ? bare : null;
}

/**
 * Read the first touch out of a URL's query string and a referrer.
 *
 * Pure on purpose: it takes the search string and the referrer rather than
 * reading `window`, so the invariants can run it with no browser.
 */
export function firstTouchFrom(
  search: string,
  referrer: string | null | undefined,
  selfHost: string
): FirstTouch {
  const params = new URLSearchParams(search);
  const touch: FirstTouch = {};

  const ref = safeTag(params.get('ref'));
  if (ref) touch.ref = ref;

  const source = safeTag(params.get('utm_source'));
  if (source) touch.source = source;

  const medium = safeTag(params.get('utm_medium'));
  if (medium) touch.medium = medium;

  const campaign = safeTag(params.get('utm_campaign'));
  if (campaign) touch.campaign = campaign;

  const host = referrerHost(referrer, selfHost);
  if (host) touch.referrer = host;

  return touch;
}

/**
 * One short string for `users.acquisition`.
 *
 * Ordered by how much the arrival tells us, most explicit first. A link we
 * tagged ourselves beats UTM parameters, which beat a referring host, which
 * beats knowing nothing. Storing the winner rather than every field keeps the
 * column answerable with `GROUP BY` instead of JSON extraction, which is what
 * anybody asking "where did these people come from" actually wants to type.
 */
export function summariseOrigin(touch: FirstTouch): string {
  const parts: string[] = [];

  if (touch.ref) {
    parts.push(`ref:${touch.ref}`);
  } else if (touch.source) {
    parts.push(`utm:${touch.source}`);
    if (touch.medium) parts.push(touch.medium);
    if (touch.campaign) parts.push(touch.campaign);
  } else if (touch.referrer) {
    parts.push(`site:${touch.referrer}`);
  }

  // The referring host is worth keeping beside an explicit tag: a campaign
  // link posted in two places is one tag and two audiences.
  if (touch.referrer && !parts[0]?.startsWith('site:')) {
    parts.push(`via:${touch.referrer}`);
  }

  const summary = parts.length > 0 ? parts.join('/') : DIRECT;
  // Clamped rather than trusted. Every component above is already bounded, so
  // this can only fire if one of them stops being, which is exactly when a
  // length bound earns its place.
  return summary.slice(0, ACQUISITION_MAX_LENGTH);
}

/**
 * The assistants worth telling apart from the rest of the web.
 *
 * Keyed by what actually lands in an acquisition summary: a referring host
 * (`site:` / `via:`), which `referrerHost` has already lowercased and stripped
 * of `www.`, or a `utm_source`, which ChatGPT sets to `chatgpt.com` and others
 * set to a bare product name. Both spellings are listed because both are
 * observed, and a list that only knew one would report half the channel.
 *
 * This is deliberately a READ-TIME classification of a value already stored.
 * `users.acquisition` keeps the measurement (`utm:chatgpt.com/via:chatgpt.com`)
 * and this decides what it means, so the list can grow as new assistants appear
 * and every row already in the table is reclassified by the next page load.
 * Writing a bucket name into the column instead would freeze today's list into
 * history and lose the host that justified it.
 *
 * Bing and DuckDuckGo are absent on purpose. Both mix assistant answers with
 * ordinary search on hosts that do not distinguish the two, so counting them
 * here would inflate the channel with traffic that is plainly search.
 */
export const AI_ASSISTANTS: ReadonlyArray<{ token: string; name: string }> = [
  { token: 'chatgpt.com', name: 'ChatGPT' },
  { token: 'chat.openai.com', name: 'ChatGPT' },
  { token: 'chatgpt', name: 'ChatGPT' },
  { token: 'openai.com', name: 'ChatGPT' },
  { token: 'perplexity.ai', name: 'Perplexity' },
  { token: 'perplexity', name: 'Perplexity' },
  { token: 'claude.ai', name: 'Claude' },
  { token: 'claude', name: 'Claude' },
  { token: 'gemini.google.com', name: 'Gemini' },
  { token: 'gemini', name: 'Gemini' },
  { token: 'copilot.microsoft.com', name: 'Copilot' },
  { token: 'copilot', name: 'Copilot' },
  { token: 'grok.com', name: 'Grok' },
  { token: 'grok', name: 'Grok' },
  { token: 'x.ai', name: 'Grok' },
  { token: 'you.com', name: 'You.com' },
  { token: 'poe.com', name: 'Poe' },
];

/**
 * One way of recognising a source, shared by all three rosters below.
 *
 * `roots` matches the host itself or any subdomain of it, and also matches the
 * bare token a `utm_source` carries, because both spellings are observed.
 * `pattern` exists for families with more country domains than a list can hold
 * without rotting: Google alone ships over 190 of them.
 */
interface SourceRule {
  name: string;
  roots: readonly string[];
  pattern?: RegExp;
}

/** The AI roster in rule form, so one matcher serves every roster. */
const AI_RULES: readonly SourceRule[] = AI_ASSISTANTS.map(
  ({ token, name }) => ({
    name,
    roots: [token],
  })
);

/**
 * Ordinary search engines.
 *
 * Bing and DuckDuckGo appear here and deliberately not in `AI_ASSISTANTS`:
 * both mix assistant answers with ordinary results on a host that does not
 * distinguish the two, so this is the honest bucket for them.
 *
 * Google is a pattern rather than a list because of its country domains. The
 * pattern requires `google` to be a whole label, so `googleusercontent.com`
 * and `notgoogle.com` do not match it, and the trailing domain is optional so
 * the bare `google` a `utm_source` carries matches too.
 */
export const SEARCH_ENGINES: readonly SourceRule[] = [
  {
    name: 'Google',
    roots: [],
    pattern: /^(?:[a-z0-9-]+\.)*google(?:\.[a-z]{2,}(?:\.[a-z]{2,})?)?$/,
  },
  { name: 'Bing', roots: ['bing.com', 'bing'] },
  { name: 'DuckDuckGo', roots: ['duckduckgo.com', 'duckduckgo'] },
  { name: 'Yahoo', roots: ['yahoo.com', 'yahoo'] },
  { name: 'Yandex', roots: ['yandex.com', 'yandex.ru', 'yandex'] },
  { name: 'Brave', roots: ['search.brave.com'] },
  { name: 'Ecosia', roots: ['ecosia.org', 'ecosia'] },
  { name: 'Startpage', roots: ['startpage.com'] },
  { name: 'Baidu', roots: ['baidu.com', 'baidu'] },
  { name: 'Naver', roots: ['naver.com'] },
];

/**
 * Social platforms, which for this product means the places a post can send
 * somebody here from.
 *
 * GitHub is deliberately absent. It links here from the plugin and the MCP
 * registry, which is a citation rather than a post, and it belongs with the
 * other referrers where its volume can be read as what it is.
 */
export const SOCIAL_SOURCES: readonly SourceRule[] = [
  { name: 'X', roots: ['x.com', 'twitter.com', 't.co', 'twitter'] },
  {
    name: 'Farcaster',
    roots: ['farcaster.xyz', 'warpcast.com', 'supercast.xyz', 'farcaster'],
  },
  { name: 'Reddit', roots: ['reddit.com', 'redd.it', 'reddit'] },
  { name: 'LinkedIn', roots: ['linkedin.com', 'lnkd.in', 'linkedin'] },
  { name: 'Hacker News', roots: ['news.ycombinator.com'] },
  { name: 'Telegram', roots: ['t.me', 'telegram.org', 'telegram'] },
  { name: 'Discord', roots: ['discord.com', 'discord.gg', 'discordapp.com'] },
  { name: 'YouTube', roots: ['youtube.com', 'youtu.be', 'youtube'] },
  { name: 'Bluesky', roots: ['bsky.app', 'bsky.social', 'bluesky'] },
];

/** The first rule this value satisfies, or null. */
function matchSource(
  value: string,
  rules: readonly SourceRule[]
): string | null {
  for (const rule of rules) {
    for (const root of rule.roots) {
      if (value === root || value.endsWith('.' + root)) return rule.name;
    }
    if (rule.pattern?.test(value)) return rule.name;
  }
  return null;
}

/**
 * The parts of a summary that say where the browser actually came from.
 *
 * Every part except `ref:`, and that exclusion is the whole reason this is a
 * function rather than a `split`. A substring match over the raw summary would
 * read the campaign tag `ref:claude-launch` as an arrival from Claude, which is
 * a campaign we ran *about* an assistant, not a visit *from* one. The same trap
 * is now three rosters wide: `ref:google-ads` is not a Google search and
 * `ref:farcaster-push` is not a Farcaster referral.
 */
function evidenceValues(acquisition: string): string[] {
  const out: string[] = [];
  for (const part of acquisition.split('/')) {
    const colon = part.indexOf(':');
    if (colon < 0) continue;
    if (part.slice(0, colon) === 'ref') continue;
    const value = part.slice(colon + 1);
    if (value !== '') out.push(value);
  }
  return out;
}

/** One component of a summary, by kind. */
function partsOfKind(acquisition: string, kind: string): string[] {
  const prefix = kind + ':';
  return acquisition
    .split('/')
    .filter((p) => p.startsWith(prefix))
    .map((p) => p.slice(prefix.length))
    .filter((v) => v !== '');
}

/** Which assistant sent this arrival, or null for the rest of the web. */
export function aiAssistantFrom(
  acquisition: string | null | undefined
): string | null {
  if (typeof acquisition !== 'string' || acquisition === '') return null;
  for (const value of evidenceValues(acquisition)) {
    const name = matchSource(value, AI_RULES);
    if (name) return name;
  }
  return null;
}

/**
 * The channels a growth decision is actually made against.
 *
 * `unknown` is a separate value from `direct` on purpose, and conflating them
 * would have been the easy mistake. 1,489 of the last 30 days' sessions carry
 * no origin at all, because first-touch shipped after the QR auction that
 * produced most of them. Folding those into `direct` would invent a direct
 * channel four times the size of the real one and make every rate beneath it
 * wrong.
 */
export type Channel =
  | 'ai'
  | 'search'
  | 'social'
  | 'referral'
  | 'campaign'
  | 'direct'
  | 'unknown';

export interface OriginChannel {
  channel: Channel;
  /** What to print: `ChatGPT`, `Google`, `qrcoin.fun`, a campaign tag. */
  name: string;
}

/** Print order, most actionable first. */
export const CHANNEL_ORDER: readonly Channel[] = [
  'ai',
  'search',
  'social',
  'referral',
  'campaign',
  'direct',
  'unknown',
];

export const CHANNEL_LABELS: Record<Channel, string> = {
  ai: 'AI assistants',
  search: 'Search',
  social: 'Social',
  referral: 'Referral',
  campaign: 'Campaign',
  direct: 'Direct',
  unknown: 'Unattributed',
};

/** What the unknown channel is called wherever a name is printed. */
export const UNATTRIBUTED = '(unattributed)';

/**
 * Which channel an acquisition summary belongs to.
 *
 * A read-time classification of a value already stored, for the same reason
 * `aiAssistantFrom` is: `users.acquisition` keeps the measurement and this
 * decides what it means, so adding an engine reclassifies every row already in
 * the table rather than freezing today's roster into history.
 *
 * ## The precedence, and why it is this way round
 *
 * A recognised platform wins over everything, because it is the only *measured*
 * statement about where the browser came from. So a tagged link posted on
 * Farcaster reads as Farcaster: the tag says which post, the host says which
 * channel, and the channel is what this function is for.
 *
 * An unrecognised host comes next, as a plain referral under its own name.
 *
 * `campaign` is therefore the residual: a tag or a `utm_source` with no
 * referring host at all. That is not a leftover, it is exactly the case the
 * channel is made of. A QR code on a poster, a link in a printed deck and a
 * link opened from a native app all arrive with no referrer, and the tag we
 * put on the URL ourselves is the only evidence that exists.
 */
export function channelFrom(
  acquisition: string | null | undefined
): OriginChannel {
  if (typeof acquisition !== 'string' || acquisition === '') {
    return { channel: 'unknown', name: UNATTRIBUTED };
  }

  for (const value of evidenceValues(acquisition)) {
    const ai = matchSource(value, AI_RULES);
    if (ai) return { channel: 'ai', name: ai };
    const search = matchSource(value, SEARCH_ENGINES);
    if (search) return { channel: 'search', name: search };
    const social = matchSource(value, SOCIAL_SOURCES);
    if (social) return { channel: 'social', name: social };
  }

  const hosts = [
    ...partsOfKind(acquisition, 'site'),
    ...partsOfKind(acquisition, 'via'),
  ];
  if (hosts.length > 0) return { channel: 'referral', name: hosts[0] };

  const tag = partsOfKind(acquisition, 'ref')[0];
  if (tag) return { channel: 'campaign', name: tag };

  const utm = partsOfKind(acquisition, 'utm')[0];
  if (utm) return { channel: 'campaign', name: utm };

  if (acquisition === DIRECT) return { channel: 'direct', name: DIRECT };

  return { channel: 'unknown', name: UNATTRIBUTED };
}

/**
 * Where the browser keeps its first touch.
 *
 * `localStorage`, not `sessionStorage`, and the difference is the whole point.
 * A session store would record a new "first" touch every time somebody came
 * back, so the tab that finally signs up would report `direct` and the cast
 * that actually brought them would be credited to nothing.
 */
const STORAGE_KEY = 'wl_first_touch';

/**
 * Read the stored first touch, or null.
 *
 * Every access is wrapped: storage throws outright in a browser configured to
 * block site data, and analytics must never be the reason a page fails to
 * render.
 */
export function readFirstTouch(): FirstTouch | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;

    /**
     * Re-sanitised on the way out.
     *
     * What went in was clean, but this has since sat in a store that any
     * script on the page can write to, and it is now on its way to a database
     * column. Trusting it because we wrote it once is the assumption worth not
     * making.
     */
    const stored = parsed as Record<string, unknown>;
    const out: FirstTouch = {};
    for (const key of ['ref', 'source', 'medium', 'campaign'] as const) {
      const value = safeTag(
        typeof stored[key] === 'string' ? (stored[key] as string) : undefined
      );
      if (value) out[key] = value;
    }
    if (typeof stored.referrer === 'string') {
      // Put back through the same gate a live referrer passes, with a self
      // host it cannot match, so a stored value earns no more trust than a
      // fresh one.
      const host = referrerHost(`https://${stored.referrer}`, ' ');
      if (host) out.referrer = host;
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Record the first touch if this browser has none, and return what it holds.
 *
 * Writes at most once, ever. Someone arriving today from a cast and again next
 * week by typing the address keeps the cast.
 */
export function captureFirstTouch(): FirstTouch | null {
  if (typeof window === 'undefined') return null;
  try {
    const existing = readFirstTouch();
    if (existing) return existing;

    const touch = firstTouchFrom(
      window.location.search,
      document.referrer,
      window.location.hostname
    );
    /**
     * A visit with nothing to say is still a first touch.
     *
     * Storing the empty one is what stops a later visit overwriting a genuine
     * `direct` with whatever referrer the person happened to arrive by on
     * their way back. Without this the column would fill with second touches
     * and look complete.
     */
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(touch));
    return touch;
  } catch {
    return null;
  }
}

/**
 * A summary arriving from a client, made safe to store.
 *
 * `summariseOrigin` builds these, but the server must never assume its own
 * function is what produced the string it received: this arrives in a request
 * body and anyone can post anything. Same alphabet as a tag plus the two
 * separators the summary format uses, and the same length bound.
 *
 * It lands in `users.acquisition` and never in `users.origin`, which is the
 * column that decides whether an account gets the free allowance. That
 * separation is structural, so this function does not need to know the rail
 * names; the invariants check that it stays structural.
 */
export function safeAcquisition(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:/-]/g, '')
    .slice(0, ACQUISITION_MAX_LENGTH);
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * This browser's first touch as one string, ready to post.
 *
 * The convenience the sign-in forms use. It captures rather than only reading,
 * because somebody can land on a page and open the sign-in modal before the
 * page-view effect has run, and a first touch missed at that moment is missed
 * for the lifetime of the account.
 */
export function originTag(): string | undefined {
  const touch = captureFirstTouch();
  if (!touch) return undefined;
  return summariseOrigin(touch);
}
