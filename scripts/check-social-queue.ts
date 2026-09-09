/**
 * Guards the daily social queue the way check-published-figures guards the
 * site: every post that will ever be cast or scheduled has to pass here
 * first, at PR time, because a queued post fails much later than the diff
 * that introduced it and by then it has published itself.
 *
 * What it asserts:
 * 1. Shape: days numbered 1..N with unique slugs; every day's slug has a
 *    card in SOCIAL_CARDS and every card is used by some day.
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

interface QueueDay {
  day: number;
  slug: string;
  x: { text: string; link: string };
  fc: { text: string; link: string };
}
interface Queue {
  start: string;
  days: QueueDay[];
}

const failures: string[] = [];
const fail = (msg: string) => failures.push(msg);

const queue: Queue = JSON.parse(
  readFileSync(join(process.cwd(), 'content/social/queue.json'), 'utf8')
);

/* ---------- 1. shape ---------- */

if (!/^\d{4}-\d{2}-\d{2}$/.test(queue.start)) {
  fail(`start "${queue.start}" is not YYYY-MM-DD`);
}
const slugs = new Set<string>();
queue.days.forEach((d, i) => {
  if (d.day !== i + 1) fail(`day ${d.day} at position ${i} breaks 1..N order`);
  if (slugs.has(d.slug)) fail(`duplicate slug "${d.slug}"`);
  slugs.add(d.slug);
  if (!SOCIAL_CARDS[d.slug]) fail(`day ${d.day}: no card for slug "${d.slug}"`);
});
for (const slug of Object.keys(SOCIAL_CARDS)) {
  if (!slugs.has(slug)) fail(`card "${slug}" is used by no queue day`);
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

const NUM_RE = /~?\$?\d[\d,.]*(?:\s?million|[Mk]|%|\+)?|\d{4}-\d{2}-\d{2}/g;
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
console.log(
  `social queue ok: ${queue.days.length} days from ${queue.start}, every post inside its limits, figures on the allowlist`
);
