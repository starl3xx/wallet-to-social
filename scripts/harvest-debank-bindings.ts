/**
 * DeBank binding-tweet harvest.
 *
 * DeBank's Twitter binding flow makes the user post a template tweet from
 * their own account naming their wallet ("I'm binding my Twitter account to
 * my Web3 Profile on @DeBankDeFi <link> 0x… #DeBank"). Each such tweet is an
 * owner-published handle→wallet claim: the same evidence class as an ENS
 * com.twitter record, in the other direction. The tweets are public and
 * finite, so this harvests them from X search and fill-only upserts the
 * pairs into social_graph, mirroring the ENS harvest writer
 * (lib/ens-harvest.ts) column for column.
 *
 * What the tweet does and does not prove: the handle's owner published the
 * claim (they posted it), so the pair earns the attested marking the same
 * way an ENS record does. It does not prove the wallet's owner agrees; a
 * disagreement with another attested source is handled downstream by the
 * handle_conflicts machinery, and the fill-only writer never overwrites an
 * existing handle. Wallets claimed by more than one handle inside the
 * corpus are dropped here as unresolvable, not written.
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
 * checkpoint advances only after a window is fully paginated and upserted,
 * so a mid-run 402 costs nothing but the retry.
 */

import { getDb, socialGraph } from '../db';
import { sql } from 'drizzle-orm';
import { cleanTwitterHandle, formatTwitterUrl } from '../lib/twitter-cleaner';

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

const WALLET_RE = /\b0x[a-fA-F0-9]{40}\b/;

interface BindingPair {
  wallet: string;
  handle: string;
  tweetId: string;
  createdAt: string;
}

interface RunStats {
  requests: number;
  tweetsSeen: number;
  noAddress: number;
  badHandle: number;
  ambiguousWallets: number;
  pairs: number;
  upserted: number;
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
  const takesValue = new Set(['--since', '--until', '--max-requests', '--window-days']);
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
    else if (flag === '--max-requests') args.maxRequests = assertPositiveInt(value, flag);
    else if (flag === '--window-days') args.windowDays = assertPositiveInt(value, flag);
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
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${flag} needs a positive integer`);
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
  const url = new URL('https://api.twitterapi.io/twitter/tweet/advanced_search');
  url.searchParams.set('queryType', 'Latest');
  url.searchParams.set('query', query);
  if (cursor) url.searchParams.set('cursor', cursor);

  const res = await fetch(url, { headers: { 'X-API-Key': key } });
  if (res.status === 402) {
    throw new OutOfCreditsError('twitterapi.io: out of credits');
  }
  if (!res.ok) {
    throw new Error(`twitterapi.io ${res.status}: ${(await res.text()).slice(0, 300)}`);
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
// Parse and dedupe
// ----------------------------------------------------------------------------

function extractPairs(
  page: SearchPage,
  stats: RunStats
): BindingPair[] {
  const pairs: BindingPair[] = [];
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
    const handle = cleanTwitterHandle(tweet.author?.userName);
    if (!handle) {
      stats.badHandle++;
      continue;
    }
    pairs.push({
      wallet: match[0].toLowerCase(),
      handle,
      tweetId: tweet.id,
      createdAt: tweet.createdAt,
    });
  }
  return pairs;
}

/**
 * Latest tweet wins per handle (people rebind after moving wallets), then a
 * wallet claimed by more than one surviving handle is dropped entirely: the
 * tweets alone cannot say which claimant is real, and writing either would
 * launder a guess into an attested row.
 */
function dedupe(all: BindingPair[], stats: RunStats): BindingPair[] {
  const byHandle = new Map<string, BindingPair>();
  for (const p of all) {
    const held = byHandle.get(p.handle);
    if (!held || p.createdAt > held.createdAt) byHandle.set(p.handle, p);
  }
  const byWallet = new Map<string, BindingPair[]>();
  for (const p of byHandle.values()) {
    byWallet.set(p.wallet, [...(byWallet.get(p.wallet) ?? []), p]);
  }
  const result: BindingPair[] = [];
  for (const claims of byWallet.values()) {
    if (claims.length === 1) result.push(claims[0]);
    else stats.ambiguousWallets++;
  }
  return result;
}

// ----------------------------------------------------------------------------
// Upsert: the ENS-harvest fill-only writer with this corpus's source label
// ----------------------------------------------------------------------------

async function upsertPairs(pairs: BindingPair[]): Promise<number> {
  const db = getDb();
  if (!db || pairs.length === 0) return 0;
  const now = new Date();
  let upserted = 0;

  for (let i = 0; i < pairs.length; i += 500) {
    const batch = pairs.slice(i, i + 500).map((p) => ({
      wallet: p.wallet,
      twitterHandle: p.handle,
      twitterUrl: formatTwitterUrl(p.handle),
      sources: ['debank_tweet'],
      twitterVerified: true,
      // twitter(20) + attested source(30) = 50, the same arithmetic as
      // ens_onchain: below the 70 trust line because the Farcaster side of
      // these wallets has never been checked.
      dataQualityScore: 50,
      firstSeenAt: now,
      lastUpdatedAt: now,
      lookupCount: 0,
    }));

    await db
      .insert(socialGraph)
      .values(batch)
      .onConflictDoUpdate({
        target: socialGraph.wallet,
        set: {
          // The renamed_from guard, verbatim from lib/ens-harvest.ts: a
          // NULL handle can mean "cleared by the conflict resolver", and a
          // binding tweet from before the rename still holds the dead
          // string. Filling from it would reopen the conflict.
          twitterHandle: sql`CASE
            WHEN lower(EXCLUDED.twitter_handle) = lower(social_graph.twitter_renamed_from) THEN social_graph.twitter_handle
            ELSE COALESCE(social_graph.twitter_handle, EXCLUDED.twitter_handle) END`,
          twitterUrl: sql`CASE
            WHEN lower(EXCLUDED.twitter_handle) = lower(social_graph.twitter_renamed_from) THEN social_graph.twitter_url
            ELSE COALESCE(social_graph.twitter_url, EXCLUDED.twitter_url) END`,
          twitterVerified: sql`CASE WHEN social_graph.twitter_handle IS NULL AND EXCLUDED.twitter_handle IS NOT NULL
            AND lower(EXCLUDED.twitter_handle) IS DISTINCT FROM lower(social_graph.twitter_renamed_from)
            THEN true ELSE social_graph.twitter_verified END`,
          // A refused fill stamps nothing: no source label, no quality
          // bump, no freshness (the lesson Bugbot taught the ENS writer).
          sources: sql`CASE
            WHEN social_graph.twitter_handle IS NOT NULL
              OR lower(EXCLUDED.twitter_handle) = lower(social_graph.twitter_renamed_from)
            THEN social_graph.sources
            WHEN 'debank_tweet' = ANY(social_graph.sources) THEN social_graph.sources
            ELSE array_append(COALESCE(social_graph.sources, ARRAY[]::text[]), 'debank_tweet') END`,
          dataQualityScore: sql`CASE
            WHEN social_graph.twitter_handle IS NOT NULL
              OR lower(EXCLUDED.twitter_handle) = lower(social_graph.twitter_renamed_from)
            THEN social_graph.data_quality_score
            ELSE GREATEST(COALESCE(social_graph.data_quality_score, 0), 50) END`,
          lastUpdatedAt: sql`CASE WHEN social_graph.twitter_handle IS NULL AND EXCLUDED.twitter_handle IS NOT NULL
              AND lower(EXCLUDED.twitter_handle) IS DISTINCT FROM lower(social_graph.twitter_renamed_from)
            THEN EXCLUDED.last_updated_at ELSE social_graph.last_updated_at END`,
        },
      });
    upserted += batch.length;
  }
  return upserted;
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
    badHandle: 0,
    ambiguousWallets: 0,
    pairs: 0,
    upserted: 0,
  };
  const samples: BindingPair[] = [];

  let windowStart = since;
  let stoppedEarly: string | null = null;

  outer: while (windowStart < until) {
    const windowEnd =
      addDays(windowStart, args.windowDays) < until
        ? addDays(windowStart, args.windowDays)
        : until;
    const windowPairs: BindingPair[] = [];

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
        windowPairs.push(...extractPairs(page, stats));
        cursor = page.has_next_page ? page.next_cursor : null;
        if (pages >= MAX_PAGES_PER_WINDOW && cursor) {
          stoppedEarly =
            `window ${windowStart}→${windowEnd} hit the ${MAX_PAGES_PER_WINDOW}-page cap; ` +
            `re-run with a smaller --window-days`;
          break outer;
        }
      } while (cursor);
    }

    const deduped = dedupe(windowPairs, stats);
    stats.pairs += deduped.length;
    for (const p of deduped) if (samples.length < 10) samples.push(p);

    if (args.commit) {
      stats.upserted += await upsertPairs(deduped);
      await saveCheckpoint(windowEnd);
    }
    console.log(
      `  ${windowStart} → ${windowEnd}: ${deduped.length} pairs ` +
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
    console.log('\nSample pairs:');
    for (const p of samples) {
      console.log(`  ${p.wallet} → @${p.handle} (tweet ${p.tweetId}, ${p.createdAt})`);
    }
  }
  if (!args.commit) {
    console.log('\nDry run: no rows written, no checkpoint saved. Re-run with --commit.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
