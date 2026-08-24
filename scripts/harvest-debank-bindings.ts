/**
 * DeBank binding-tweet harvest.
 *
 * DeBank's Twitter binding flow makes the user post a template tweet from
 * their own account naming their wallet ("I'm binding my Twitter account to
 * my Web3 Profile on @DeBankDeFi <link> 0x… #DeBank"). The flow itself
 * requires a wallet connection before the tweet, so each tweet is the public
 * half of an owner-established binding: the same evidence class as the other
 * attested-link sources. The tweets are public and finite, so this harvests
 * them from X search and hands the pairs to the shared attested-link ingest
 * (lib/attested-links.ts), which owns the fill-only rules, the agreement
 * gate, conflict recording, and the quality contract. This script's whole
 * job is to produce AttestedLink[].
 *
 * Downstream: the x_accounts sweep (scripts/sweep-x-accounts.ts) asks for
 * handles that have never been checked, so harvested handles enter the
 * reachability pipeline with no extra wiring.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/harvest-debank-bindings.ts             # dry run
 *   npx tsx --env-file=.env.local scripts/harvest-debank-bindings.ts --commit    # write + checkpoint
 *
 * Flags:
 *   --since YYYY-MM-DD     start date (default: checkpoint, else 2021-01-01)
 *   --until YYYY-MM-DD     end date (default: today)
 *   --max-requests N       search-API request budget for this run (default 300)
 *   --window-days N        search window size (default 30; shrink if a
 *                          window hits the page cap)
 *
 * Needs TWITTERAPI_IO_KEY (an api.twitterapi.io key; the account must hold
 * credits — it was empty on 2026-08-22, which is why this script exists
 * ahead of its first run). Interrupt-safe like the ENS harvest: the
 * checkpoint advances only after a window is fully paginated and ingested,
 * so a mid-run 402 costs nothing but the retry.
 */

import { getDb } from '../db';
import { sql } from 'drizzle-orm';
import {
  ingestLinks,
  dedupeByWallet,
  classifyLinks,
  type AttestedLink,
  type LinkSource,
} from '../lib/attested-links';

const SOURCE: LinkSource = {
  id: 'debank_tweet',
  /** twitter(20) + debank_tweet(25) in `calculateQualityScore`. */
  quality: 45,
};

const STATE_KEY = 'debank_binding_harvest';

// DeBank Hi (the first bind-by-tweet flow) launched in 2021; scanning empty
// early months costs one request each, which is cheaper than guessing the
// exact start and being wrong.
const DEFAULT_START = '2021-01-01';

// The template phrases, minus the leading "I'm": the apostrophe is
// typographic in some clients and straight in others, and an exact-phrase
// query only needs the invariant part. Retweets are someone else's binding.
const QUERIES = [
  '"binding my Twitter account to my Web3 Profile on @DeBankDeFi" -filter:retweets',
  '"binding my Twitter account to my Web3 Official Account on @DeBankCloud" -filter:retweets',
];

// ~20 tweets per page; 50 pages is ~1,000 binding tweets in one window,
// which no month should reach. Hitting it means the window is too wide to
// trust as complete, so the run stops before advancing the checkpoint
// rather than silently keeping a truncated month.
const MAX_PAGES_PER_WINDOW = 50;

// A handle that tweets bindings for many different wallets is not rebinding,
// it is spraying. The real flow binds one wallet at a time and people rebind
// rarely, so anything past this many distinct wallets drops the handle's
// links entirely.
const MAX_WALLETS_PER_HANDLE = 3;

const WALLET_RE = /\b0x[a-fA-F0-9]{40}\b/;

interface RunStats {
  requests: number;
  tweetsSeen: number;
  noAddress: number;
  spamHandles: number;
  links: number;
  contested: number;
  rejected: number;
  newWallets: number;
  filled: number;
  agree: number;
  conflicts: number;
}

// ----------------------------------------------------------------------------
// Args: single-pass, so a flag can never swallow another flag as its value
// ----------------------------------------------------------------------------

interface Args {
  commit: boolean;
  since: string | null;
  until: string | null;
  maxRequests: number;
  windowDays: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    commit: false,
    since: null,
    until: null,
    maxRequests: 300,
    windowDays: 30,
  };
  const takesValue = new Set([
    '--since',
    '--until',
    '--max-requests',
    '--window-days',
  ]);
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--commit') {
      args.commit = true;
      continue;
    }
    if (!takesValue.has(flag)) {
      throw new Error(`Unknown flag: ${flag}`);
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`${flag} needs a value`);
    }
    i++;
    if (flag === '--since') args.since = assertDate(value);
    else if (flag === '--until') args.until = assertDate(value);
    else if (flag === '--max-requests')
      args.maxRequests = assertPositiveInt(value, flag);
    else if (flag === '--window-days')
      args.windowDays = assertPositiveInt(value, flag);
  }
  return args;
}

function assertDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error(`Not a YYYY-MM-DD date: ${value}`);
  }
  return value;
}

function assertPositiveInt(value: string, flag: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0)
    throw new Error(`${flag} needs a positive integer`);
  return n;
}

// ----------------------------------------------------------------------------
// Checkpoint (ingest_state, the ENS-harvest pattern)
// ----------------------------------------------------------------------------

async function getCheckpoint(): Promise<string | null> {
  const db = getDb();
  if (!db) throw new Error('Database not configured');
  const result = (await db.execute(
    sql`SELECT value->>'completedThrough' AS through FROM ingest_state WHERE name = ${STATE_KEY}`
  )) as unknown as { rows: Array<{ through: string | null }> };
  return result.rows[0]?.through ?? null;
}

async function saveCheckpoint(completedThrough: string): Promise<void> {
  const db = getDb();
  if (!db) throw new Error('Database not configured');
  await db.execute(sql`
    INSERT INTO ingest_state (name, value, updated_at)
    VALUES (${STATE_KEY}, jsonb_build_object('completedThrough', ${completedThrough}::text), now())
    ON CONFLICT (name) DO UPDATE
    SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
  `);
}

// ----------------------------------------------------------------------------
// Search
// ----------------------------------------------------------------------------

class OutOfCreditsError extends Error {}

interface SearchPage {
  tweets: Array<{
    id: string;
    text: string;
    createdAt: string;
    author: { userName: string };
  }>;
  has_next_page: boolean;
  next_cursor: string | null;
}

async function fetchPage(
  key: string,
  query: string,
  cursor: string | null
): Promise<SearchPage> {
  const url = new URL(
    'https://api.twitterapi.io/twitter/tweet/advanced_search'
  );
  url.searchParams.set('queryType', 'Latest');
  url.searchParams.set('query', query);
  if (cursor) url.searchParams.set('cursor', cursor);

  const res = await fetch(url, { headers: { 'X-API-Key': key } });
  if (res.status === 402) {
    throw new OutOfCreditsError('twitterapi.io: out of credits');
  }
  if (!res.ok) {
    throw new Error(
      `twitterapi.io ${res.status}: ${(await res.text()).slice(0, 300)}`
    );
  }
  const json = (await res.json()) as SearchPage;
  // The response shape is from the twitterapi.io docs, not a typed SDK;
  // fail loudly on drift rather than harvesting nothing in silence.
  if (!Array.isArray(json.tweets)) {
    throw new Error(
      `Unexpected response shape (no tweets array): ${JSON.stringify(json).slice(0, 300)}`
    );
  }
  return json;
}

// ----------------------------------------------------------------------------
// Parse
// ----------------------------------------------------------------------------

interface RawBinding {
  wallet: string;
  handle: string;
  tweetId: string;
}

function extractBindings(page: SearchPage, stats: RunStats): RawBinding[] {
  const out: RawBinding[] = [];
  for (const tweet of page.tweets) {
    stats.tweetsSeen++;
    const match = tweet.text.match(WALLET_RE);
    if (!match) {
      // The Official Account variant carries an account id, not always a
      // wallet; a personal tweet with the address only inside the
      // t.co-shortened profile link loses it too.
      stats.noAddress++;
      continue;
    }
    const handle = tweet.author?.userName;
    if (!handle) continue;
    out.push({ wallet: match[0], handle, tweetId: tweet.id });
  }
  return out;
}

/**
 * The one corpus-specific rule: drop handles spraying bindings across many
 * wallets. Everything downstream of this (normalisation, contested wallets,
 * the agreement gate, conflicts) is the shared ingest's job, not ours.
 */
function dropSprayers(bindings: RawBinding[], stats: RunStats): AttestedLink[] {
  const walletsByHandle = new Map<string, Set<string>>();
  for (const b of bindings) {
    const key = b.handle.toLowerCase();
    const set = walletsByHandle.get(key) ?? new Set();
    set.add(b.wallet.toLowerCase());
    walletsByHandle.set(key, set);
  }
  const spam = new Set(
    [...walletsByHandle.entries()]
      .filter(([, wallets]) => wallets.size > MAX_WALLETS_PER_HANDLE)
      .map(([handle]) => handle)
  );
  stats.spamHandles += spam.size;
  return bindings
    .filter((b) => !spam.has(b.handle.toLowerCase()))
    .map((b) => ({ wallet: b.wallet, handle: b.handle }));
}

// ----------------------------------------------------------------------------
// Windows
// ----------------------------------------------------------------------------

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const key = process.env.TWITTERAPI_IO_KEY;
  if (!key) {
    console.error('TWITTERAPI_IO_KEY is required (api.twitterapi.io)');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const checkpoint = await getCheckpoint();
  const since = args.since ?? checkpoint ?? DEFAULT_START;
  const until = args.until ?? today();
  console.log(
    `${args.commit ? 'COMMIT' : 'dry run'}: ${since} → ${until}, ` +
      `${args.windowDays}-day windows, max ${args.maxRequests} requests` +
      (checkpoint ? ` (checkpoint was ${checkpoint})` : '')
  );

  const stats: RunStats = {
    requests: 0,
    tweetsSeen: 0,
    noAddress: 0,
    spamHandles: 0,
    links: 0,
    contested: 0,
    rejected: 0,
    newWallets: 0,
    filled: 0,
    agree: 0,
    conflicts: 0,
  };
  const samples: AttestedLink[] = [];

  let windowStart = since;
  let stoppedEarly: string | null = null;

  outer: while (windowStart < until) {
    const windowEnd =
      addDays(windowStart, args.windowDays) < until
        ? addDays(windowStart, args.windowDays)
        : until;
    const windowBindings: RawBinding[] = [];

    for (const base of QUERIES) {
      const query = `${base} since:${windowStart} until:${windowEnd}`;
      let cursor: string | null = null;
      let pages = 0;
      do {
        if (stats.requests >= args.maxRequests) {
          stoppedEarly = `request budget (${args.maxRequests}) reached`;
          break outer;
        }
        let page: SearchPage;
        try {
          page = await fetchPage(key, query, cursor);
        } catch (err) {
          if (err instanceof OutOfCreditsError) {
            stoppedEarly = 'twitterapi.io credits ran out';
            break outer;
          }
          throw err;
        }
        stats.requests++;
        pages++;
        windowBindings.push(...extractBindings(page, stats));
        cursor = page.has_next_page ? page.next_cursor : null;
        if (pages >= MAX_PAGES_PER_WINDOW && cursor) {
          stoppedEarly =
            `window ${windowStart}→${windowEnd} hit the ${MAX_PAGES_PER_WINDOW}-page cap; ` +
            `re-run with a smaller --window-days`;
          break outer;
        }
      } while (cursor);
    }

    const links = dropSprayers(windowBindings, stats);
    for (const l of links) if (samples.length < 10) samples.push(l);

    if (args.commit) {
      const ingested = await ingestLinks(links, SOURCE);
      stats.links += ingested.links;
      stats.contested += ingested.contested;
      stats.rejected += ingested.rejected;
      stats.newWallets += ingested.newWallets;
      stats.filled += ingested.filled;
      stats.agree += ingested.agree;
      stats.conflicts += ingested.conflicts;
      await saveCheckpoint(windowEnd);
    } else {
      // The dry run reports what a commit would do, through the same
      // normalisation and read-only classification the ingest itself uses.
      const { links: deduped, contested, rejected } = dedupeByWallet(links);
      const counts = await classifyLinks(deduped);
      stats.links += deduped.length;
      stats.contested += contested;
      stats.rejected += rejected;
      stats.newWallets += counts.newWallets;
      stats.filled += counts.wouldFill;
      stats.agree += counts.agree;
      stats.conflicts += counts.disagree;
    }
    console.log(
      `  ${windowStart} → ${windowEnd}: ${links.length} links ` +
        `(${stats.requests} requests so far)`
    );
    windowStart = windowEnd;
  }

  if (stoppedEarly) {
    console.log(`\nStopped early: ${stoppedEarly}.`);
    console.log(
      args.commit
        ? 'The checkpoint holds the last completed window; re-run to continue.'
        : 'Dry run: nothing was written either way.'
    );
  }
  console.log('\nDone:', JSON.stringify(stats, null, 2));
  if (samples.length > 0) {
    console.log('\nSample links:');
    for (const l of samples) {
      console.log(`  ${l.wallet.toLowerCase()} → @${l.handle}`);
    }
  }
  if (!args.commit) {
    console.log(
      '\nDry run: no rows written, no conflicts recorded, no checkpoint saved. ' +
        'Re-run with --commit. (In dry-run "conflicts" counts disagreements found.)'
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
