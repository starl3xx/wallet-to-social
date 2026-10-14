/**
 * Guards the social queue the way check-published-figures guards the site:
 * every post that will ever be cast or scheduled has to pass here first, at
 * PR time, because a queued post fails much later than the diff that
 * introduced it and by then it has published itself.
 *
 * What it asserts:
 * 1. Shape: posts numbered 1..N with unique slugs and strictly ascending
 *    UTC dates; every post's slug has a card in SOCIAL_CARDS and every card
 *    is used by some post.
 * 1b. Cadence: every post after the daily runway falls on a weekday the
 *    `daily-cast` cron runs, and no cron day between the first and last of
 *    them is left without a post. The cron is read from the workflow, so the
 *    schedule and the calendar cannot drift apart: a post dated on a day the
 *    cast never runs would go out on X and never on Farcaster, and a skipped
 *    slot is a silent gap nobody chose. The calendar logic in
 *    `lib/social-queue.ts` is driven here against synthetic queues, refusals
 *    first.
 * 2. Length: an X post fits one tweet (each URL counted as 23, X's t.co
 *    length; 270 ceiling leaves headroom under 280). A Farcaster cast stays
 *    inside the ~320-byte display window; the hard 1024 wall is re-checked
 *    at send time by cast-daily.ts.
 * 3. CTA: every X text contains its own link; every Farcaster entry carries
 *    an https link (in text or as the entry link the card CTA states).
 * 4. House style, the subset a grep can see: no em dash (or &mdash;), no
 *    "on-chain" spelling, no straight apostrophe inside a word, no thread
 *    markers, no hashtags, no legacy tier for sale, no numeric "industry
 *    average" (banned 2026-08-22).
 * 5. Figures: every numeric token in every text is on the allowlist built
 *    from lib/public-figures.ts and lib/packs.ts. An unknown number fails,
 *    which is the point: adding one to the allowlist IS the figure review.
 * 6. The card registry interpolates constants, never figure literals: a
 *    hand-typed '4.8M' in lib/social-cards.tsx is the snapshot the whole
 *    design exists to avoid.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { SOCIAL_CARDS } from '../lib/social-cards';
import {
  INDEXED_WALLETS,
  INDEXED_WALLETS_LONG,
  FARCASTER_WALLETS,
  WALLETS_WITH_X,
  X_HANDLES_RESOLVED,
  X_LIVE_PCT,
  X_SUSPENDED_PCT,
  X_UNCLAIMED_PCT,
  X_UNREACHABLE_PCT,
  KNOWN_AGENTS,
  CHAIN_MATCH_RATES,
  CHAIN_MATCH_RATES_MEASURED_ON,
} from '../lib/public-figures';
import {
  PACKS,
  PACK_IDS,
  FREE_MATCHES_PER_WINDOW,
  FREE_WINDOW_DAYS,
  CREDIT_LIFETIME_MONTHS,
} from '../lib/packs';

import {
  duePost,
  utcDayNumber,
  utcWeekday,
  type QueuePost,
  type SocialQueue,
} from '../lib/social-queue';

const failures: string[] = [];
const fail = (msg: string) => failures.push(msg);

const queue: SocialQueue & { start?: unknown } = JSON.parse(
  readFileSync(join(process.cwd(), 'content/social/queue.json'), 'utf8')
);

/* ---------- 1. shape ---------- */

// The queue was a start date plus one post per day until 2026-10-13. A
// `start` left in the file would read as the schedule and is not one.
if (queue.start !== undefined) {
  fail('"start" is retired: each post carries its own "date"');
}

function isUtcDate(date: unknown): date is string {
  return (
    typeof date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) &&
    new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date
  );
}

const slugs = new Set<string>();
let datesInOrder = true;
queue.days.forEach((d, i) => {
  if (d.day !== i + 1) fail(`day ${d.day} at position ${i} breaks 1..N order`);
  if (slugs.has(d.slug)) fail(`duplicate slug "${d.slug}"`);
  slugs.add(d.slug);
  if (!SOCIAL_CARDS[d.slug]) fail(`day ${d.day}: no card for slug "${d.slug}"`);
  if (!isUtcDate(d.date)) {
    fail(`day ${d.day}: date "${d.date}" is not a real YYYY-MM-DD`);
    datesInOrder = false;
    return;
  }
  const prev = queue.days[i - 1];
  if (
    prev &&
    isUtcDate(prev.date) &&
    utcDayNumber(d.date) <= utcDayNumber(prev.date)
  ) {
    fail(
      `day ${d.day} (${d.date}) is not after day ${prev.day} (${prev.date}): dates must strictly ascend, one post per day at most`
    );
    datesInOrder = false;
  }
});
for (const slug of Object.keys(SOCIAL_CARDS)) {
  if (!slugs.has(slug)) fail(`card "${slug}" is used by no queue day`);
}

/* ---------- 1b. cadence ---------- */

/**
 * The last day of the original daily runway. Posts 1 to 30 went out every
 * day from 2026-09-10; they stay in the queue because the checks below
 * still apply to them (a figure refresh has to reach them) and because their
 * cards are embedded in casts that are already published. The weekday rule
 * starts after this date.
 */
const DAILY_RUNWAY_LAST = '2026-10-09';

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * The weekdays the `daily-cast` cron runs on, read from the workflow.
 *
 * Deliberately narrow: one cron line, `*` for day of month and month, and a
 * comma list of weekday numbers. Anything else (a range, a name, a second
 * schedule) fails here rather than being half understood, because a reader
 * that guessed would pass a calendar the cast never runs.
 */
function cronWeekdays(): Set<number> | null {
  const yml = readFileSync(
    join(process.cwd(), '.github/workflows/daily-cast.yml'),
    'utf8'
  );
  const crons = [...yml.matchAll(/^\s*-\s*cron:\s*['"]([^'"]+)['"]/gm)].map(
    (m) => m[1].trim().split(/\s+/)
  );
  if (crons.length !== 1) {
    fail(
      `daily-cast.yml has ${crons.length} cron lines; the cadence check reads exactly one`
    );
    return null;
  }
  const [, , dom, month, dow] = crons[0];
  if (crons[0].length !== 5 || dom !== '*' || month !== '*') {
    fail(
      `daily-cast.yml cron "${crons[0].join(' ')}" is not "m h * * <weekdays>"; the cadence check cannot read it`
    );
    return null;
  }
  if (dow === '*') return new Set([0, 1, 2, 3, 4, 5, 6]);
  if (!/^[0-7](,[0-7])*$/.test(dow)) {
    fail(
      `daily-cast.yml weekday field "${dow}" is not a comma list of 0 to 7; the cadence check cannot read it`
    );
    return null;
  }
  return new Set(dow.split(',').map((n) => Number(n) % 7));
}

const castDays = cronWeekdays();
if (castDays && datesInOrder) {
  const cadence = queue.days.filter(
    (d) => utcDayNumber(d.date) > utcDayNumber(DAILY_RUNWAY_LAST)
  );
  for (const d of cadence) {
    if (!castDays.has(utcWeekday(d.date))) {
      fail(
        `day ${d.day} is dated ${d.date}, a ${WEEKDAY_NAMES[utcWeekday(d.date)]}, and daily-cast never runs then (it runs ${[
          ...castDays,
        ]
          .sort((a, b) => a - b)
          .map((n) => WEEKDAY_NAMES[n])
          .join(', ')})`
      );
    }
  }
  if (cadence.length > 0) {
    const dated = new Set(cadence.map((d) => d.date));
    const first = utcDayNumber(cadence[0].date);
    const last = utcDayNumber(cadence[cadence.length - 1].date);
    for (let n = first; n <= last; n++) {
      const date = new Date(n * 86_400_000).toISOString().slice(0, 10);
      if (castDays.has(utcWeekday(date)) && !dated.has(date)) {
        fail(
          `${date} (${WEEKDAY_NAMES[utcWeekday(date)]}) is a cast day inside the queue with no post: a gap reads as an account that stopped`
        );
      }
    }
  }
}

/**
 * The calendar logic, driven against a synthetic Mon/Wed/Fri queue.
 *
 * Refusals first, because the defect this whole change exists for was a
 * refusal that never happened: the old cast exited 0 every day for days
 * with nothing left to send. A version of `duePost` that always found
 * something due, or never reported a dry queue, would pass a happy-path
 * test of the days that have posts.
 */
{
  const post = (day: number, date: string): QueuePost => ({
    day,
    date,
    slug: `t${day}`,
    x: { text: '', link: '' },
    fc: { text: '', link: '' },
  });
  // Mon 2026-01-05, Wed 2026-01-07, Fri 2026-01-09
  const days = [
    post(1, '2026-01-05'),
    post(2, '2026-01-07'),
    post(3, '2026-01-09'),
  ];
  const cases: Array<[string, QueuePost[], string, string]> = [
    // [what, queue, today, expected kind + slug]
    ['the Monday after the last post', days, '2026-01-12', 'exhausted:t3'],
    ['two days after the last post', days, '2026-01-11', 'exhausted:t3'],
    ['an empty queue', [], '2026-01-05', 'empty'],
    [
      'a slot past its grace, with a later post queued',
      [post(1, '2026-01-05'), post(2, '2026-01-09')],
      '2026-01-07',
      'between:t2',
    ],
    ['before the first post', days, '2026-01-04', 'not-started:t1'],
    ['a post on its own date', days, '2026-01-07', 'due:t2'],
    ['a late run the next UTC day', days, '2026-01-06', 'due:t1'],
    ['the last post, late', days, '2026-01-10', 'due:t3'],
  ];
  for (const [what, q, today, want] of cases) {
    const got = duePost(q, today);
    const slug =
      got.kind === 'due'
        ? got.post.slug
        : got.kind === 'exhausted'
          ? got.last.slug
          : got.kind === 'empty'
            ? null
            : got.next.slug;
    const seen = slug ? `${got.kind}:${slug}` : got.kind;
    if (seen !== want) {
      fail(`lib/social-queue.ts: ${what} (${today}) gave ${seen}, not ${want}`);
    }
  }
}

/* ---------- 2 + 3. length and CTA ---------- */

const URL_RE = /https?:\/\/\S+/g;

/** X counts every URL as 23 regardless of its written length. */
function xLength(text: string): number {
  const urls = text.match(URL_RE) ?? [];
  const stripped = text.replace(URL_RE, '');
  return [...stripped].length + urls.length * 23;
}

for (const d of queue.days) {
  const xLen = xLength(d.x.text);
  if (xLen > 270)
    fail(`day ${d.day} X post is ${xLen} chars (URL as 23); max 270`);
  if (!d.x.text.includes(d.x.link)) {
    fail(`day ${d.day} X post does not contain its CTA link ${d.x.link}`);
  }

  const fcBytes = Buffer.byteLength(d.fc.text, 'utf8');
  if (fcBytes > 320)
    fail(`day ${d.day} cast is ${fcBytes} bytes; max 320 (display window)`);
  // The link must be IN the text: cast-daily publishes fc.text plus the card
  // image, and a card CTA is pixels, not a tap target. fc.link existing
  // elsewhere in the entry proves nothing about what a reader can click.
  if (!d.fc.text.includes(d.fc.link) || !/^https:\/\//.test(d.fc.link)) {
    fail(
      `day ${d.day} cast text does not contain its https CTA link ${d.fc.link}`
    );
  }
}

/* ---------- 4. house style ---------- */

const STYLE: Array<[RegExp, string]> = [
  [/—|&mdash;/, 'em dash'],
  [/\bon-chain\b/i, '"on-chain": onchain is one word'],
  [/[A-Za-z]'[A-Za-z]/, 'straight apostrophe: use ’'],
  [/(^|\s)\d+\/\d*($|\s)/, 'thread marker'],
  [/#\w/, 'hashtag'],
  [/\b(pro|unlimited)\s+(tier|plan)\b/i, 'legacy tier offered for sale'],
  [/industry\s+average/i, 'numeric industry average is banned (2026-08-22)'],
];
for (const d of queue.days) {
  for (const [platform, text] of [
    ['X', d.x.text],
    ['FC', d.fc.text],
  ] as const) {
    for (const [re, why] of STYLE) {
      if (re.test(text)) fail(`day ${d.day} ${platform}: ${why}`);
    }
  }
}

/* ---------- 5. figures allowlist ---------- */

const ALLOWED = new Set<string>(
  [
    INDEXED_WALLETS,
    INDEXED_WALLETS_LONG,
    FARCASTER_WALLETS,
    WALLETS_WITH_X,
    X_HANDLES_RESOLVED,
    `${X_LIVE_PCT}%`,
    `${X_SUSPENDED_PCT}%`,
    `${X_UNCLAIMED_PCT}%`,
    `${X_UNREACHABLE_PCT}%`,
    KNOWN_AGENTS,
    `${KNOWN_AGENTS}+`,
    CHAIN_MATCH_RATES_MEASURED_ON,
    `${CHAIN_MATCH_RATES.base.either_pct}%`,
    `${CHAIN_MATCH_RATES.ethereum.either_pct}%`,
    `${CHAIN_MATCH_RATES.robinhood.either_pct}%`,
    // The Base row split by platform, and the size of that row's sample:
    // quoted only beside its date and collection count, as every per-chain
    // rate is.
    `${CHAIN_MATCH_RATES.base.farcaster_pct}%`,
    `${CHAIN_MATCH_RATES.base.x_pct}%`,
    String(CHAIN_MATCH_RATES.base.collections),
    '72,318',
    '26',
    String(FREE_MATCHES_PER_WINDOW),
    String(FREE_WINDOW_DAYS),
    String(CREDIT_LIFETIME_MONTHS),
    // The x402 rail: $1 for 12 matches (deliberately not in PACKS), and the
    // 402 status code that names it: a protocol fact, not a figure.
    '$1',
    '12',
    '402',
    // Illustrative round size in the priority-score post, not a claim.
    '10k',
    // The rate pair, quoted rounded, and the chain count as a digit.
    '~23%',
    '~13%',
    '8',
    ...PACK_IDS.flatMap((id) => [
      `$${PACKS[id].priceCents / 100}`,
      PACKS[id].matches.toLocaleString('en-US'),
    ]),
  ].map((s) => s.toLowerCase())
);

/**
 * The ISO date alternative comes FIRST, and the order is the whole point.
 *
 * Alternation in JavaScript is first-match, not longest-match, so with the
 * general number first this regex read "2026-08-17" as three separate tokens,
 * `2026`, `08` and `17`, none of which is on the allowlist. The effect was that
 * `CHAIN_MATCH_RATES_MEASURED_ON` sat in the allowlist below unreachable: no
 * post could ever carry the date its own measurement is stamped with, and the
 * failure named three figures that do not appear in the copy.
 *
 * Case-insensitive for the same class of reason. The allowlist is lowercased
 * on the way in, so `4.85M` is stored as `4.85m`, and a case-sensitive `[Mk]`
 * cannot read that back: the self-test below reported the entry unreachable
 * when it is reachable from real copy and only unreachable from the allowlist.
 * The flag also makes `10K` tokenize as `10K` rather than as a bare `10`,
 * which is what a writer typing it would expect.
 */
const NUM_RE = /\d{4}-\d{2}-\d{2}|~?\$?\d[\d,.]*(?:\s?million|[Mk]|%|\+)?/gi;

/**
 * Every allowlisted figure has to be a token this tokenizer can actually
 * produce.
 *
 * The bug above was invisible because the allowlist and the tokenizer were
 * never checked against each other: an entry the regex can never emit is dead,
 * and it reads as permission that was granted. Asserted as the refusal, so the
 * next entry written in a shape `NUM_RE` does not match fails here rather than
 * at the moment somebody tries to use it.
 */
for (const figure of ALLOWED) {
  const tokens = figure.match(NUM_RE) ?? [];
  if (tokens.length !== 1 || tokens[0] !== figure) {
    fail(
      `allowlisted figure "${figure}" is unreachable: the tokenizer reads it ` +
        `as ${JSON.stringify(tokens)}, so no post can ever use it`
    );
  }
}

for (const d of queue.days) {
  for (const [platform, text] of [
    ['X', d.x.text],
    ['FC', d.fc.text],
  ] as const) {
    const stripped = text.replace(URL_RE, '');
    for (const tok of stripped.match(NUM_RE) ?? []) {
      const clean = tok.replace(/[.,]$/, '').toLowerCase();
      if (!ALLOWED.has(clean)) {
        fail(
          `day ${d.day} ${platform}: figure "${tok}" is not on the allowlist; ` +
            `verify it against lib/public-figures.ts and add it here consciously`
        );
      }
    }
  }
}

/* ---------- 6. the registry carries no figure literals ---------- */

const registrySrc = readFileSync(
  join(process.cwd(), 'lib/social-cards.tsx'),
  'utf8'
);
const registryLines = registrySrc
  .split('\n')
  .filter((l) => !l.includes('literal-ok'))
  .join('\n');
const litRe = /['"`][^'"`]*\d[\d,.]*(?:M|%| million)[^'"`]*['"`]/g;
for (const hit of registryLines.match(litRe) ?? []) {
  fail(
    `lib/social-cards.tsx carries a figure literal ${hit}; interpolate the constant instead`
  );
}

/* ---------- verdict ---------- */

if (failures.length) {
  console.error('social queue failures:\n');
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
const first = queue.days[0];
const last = queue.days[queue.days.length - 1];
console.log(
  `social queue ok: ${queue.days.length} posts, ${first?.date} to ${last?.date}, on the cast’s cadence, every post inside its limits, figures on the allowlist`
);
