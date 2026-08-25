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
 * would be no way to notice. `users.origin` is likewise set on insert only.
 */

/** Campaign tags are short. Anything longer is not a campaign name. */
export const TAG_MAX_LENGTH = 64;

/** The whole summary, bounded so it cannot become a place to store text. */
export const ORIGIN_MAX_LENGTH = 200;

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
 * One short string for `users.origin`.
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
  return summary.slice(0, ORIGIN_MAX_LENGTH);
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
 */
export function safeOrigin(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:/-]/g, '')
    .slice(0, ORIGIN_MAX_LENGTH);
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
