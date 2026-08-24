/**
 * Concierge signals: the day's outreach shortlist, with the numbers already run.
 *
 * The traffic plan asks for three personalised replies per weekday to teams
 * announcing a snapshot, allowlist, airdrop or launch, "with their own numbers
 * already run". This script is the part a machine can do: find the candidates,
 * compute an honest number for each from our own index, and print a drafted
 * reply. A person reads, edits and sends. Nothing here posts anything.
 *
 * ## What the research changed about the plan
 *
 * The plan named Clanker deployers as the densest pocket. They are not a
 * launch feed at all. `lib/clanker.ts` captures a wallet and a social handle
 * and throws the token address away (it is in `topics[1]` and never read), so
 * there is nothing to measure. Worse, a token deployed this morning has no
 * holders: two sampled an hour apart had three transfers each, being the pool,
 * the locker and the deployer. A "number" about them would be a 3. And the
 * handle-shaped records are frequently launchpad bots minting tokens *about* a
 * public figure's post rather than that person deploying, so a personalised
 * reply would land on someone with no connection to the token. Clanker is a
 * good wallet-to-X link source and a bad prospect list, so it is not used here.
 *
 * ## The three lanes, in order of what actually works today
 *
 * 1. `index`  The 76 contracts we already hold holder data for, 51 of which
 *             clear the public listing floor and therefore already have a live
 *             report at /holders/<chain>/<address>. Those teams have never
 *             been told. Zero API calls, zero credits, real numbers, and a URL
 *             to point at. This is the strongest lane and the default.
 * 2. `x`      Live announcements from X, through the repo's own twitterapi.io
 *             key. Anchored to a marketplace or explorer link, because the
 *             unanchored keyword query is about three quarters giveaway farms.
 * 3. `farcaster`  The free, unauthenticated Warpcast search. Neynar is over
 *             its period budget until 2026-09-01 and sits in the live paid
 *             lookup path, so no new Neynar caller may spend before then.
 *
 * ## What it will not do
 *
 * No writes, no seeding, no posting. Seeding a contract today would import
 * holdings and then fail to resolve any socials, because the Neynar background
 * ceiling is spent, producing `checked` near zero: a number that means "not yet
 * measured" dressed as a finding. `measurementInProgress` catches that shape
 * and this script drops those candidates rather than quoting them.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/concierge-signals.ts
 *   npx tsx --env-file=.env.local scripts/concierge-signals.ts --source=x --limit=5
 */

import {
  listHolderCollections,
  getHolderCollection,
  getHolderStats,
  getHolderOverlap,
  measurementInProgress,
  chainLabel,
  type HolderStats,
  type HolderCollection,
} from '../lib/holder-pages';
import { SUPPORTED_CHAINS, type SupportedChain } from '../lib/chains';

const SITE = 'https://walletlink.social';

/** Printed shortlist size. The plan asks for three touches a weekday. */
const DEFAULT_LIMIT = 3;

/**
 * Chains ranked by how strong the opening number is, best first.
 *
 * Base leads because it is the best figure in the product (46.2% reachable
 * against 16.6% on Ethereum), so a Base prospect gets the strongest honest
 * opening. This orders ties only; a real measured number always outranks a
 * chain preference.
 */
const CHAIN_RANK: Record<string, number> = { base: 0, ethereum: 1 };

interface Candidate {
  /** Where it came from, printed so a person can judge the source. */
  lane: 'index' | 'x' | 'farcaster';
  /** Display name for the collection or team. */
  name: string;
  chain: SupportedChain | null;
  address: string | null;
  /** The post that triggered it, when there is one. */
  sourceUrl: string | null;
  /**
   * Our published report, and never the same field as sourceUrl.
   *
   * They were one field, and the draft linked whatever it held as "the full
   * report is already public". On an X candidate that field is the prospect's
   * own announcement post, so the reply would have pointed a team at their own
   * tweet and called it our analysis.
   */
  reportUrl: string | null;
  /** Who to reply to, when we know. */
  handle: string | null;
  postedAt: Date | null;
  excerpt: string | null;
  collection: HolderCollection | null;
  stats: HolderStats | null;
  overlap: Array<{ name: string; sharedHolders: number }>;
  /** True when a public report already exists to link to. */
  hasPublicReport: boolean;
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

/**
 * The honest sentence about a measured collection.
 *
 * Two rules carry the whole thing. First, always name the denominator that was
 * actually measured: seeding caps at 2,000 wallets, so a capped collection must
 * read "of the 2,000 holders we measured" and never "of your 20,977 holders".
 * Second, `checked` is usually far below `holderCount`, which makes
 * `reachableAny` a floor rather than an estimate. Everyone counted was really
 * found, so "at least" is the only defensible framing, and it is also the more
 * persuasive one.
 */
function numberSentence(col: HolderCollection, s: HolderStats): string {
  const capped =
    col.totalHolders !== null && col.holdersImported < col.totalHolders;
  const denominator = capped
    ? `the ${s.holderCount.toLocaleString()} holders we measured`
    : `${s.holderCount.toLocaleString()} holders`;

  const parts = [
    `Of ${denominator}, at least ${s.reachableAny.toLocaleString()} are reachable on X or Farcaster today`,
  ];
  if (s.withFarcaster > 0) {
    parts.push(`${s.withFarcaster.toLocaleString()} have a Farcaster account`);
  }
  if (s.xLive > 0) {
    parts.push(`${s.xLive.toLocaleString()} have an X handle that still resolves`);
  }
  return `${parts.join(', ')}.`;
}

/**
 * A dead handle is the line that earns the reply.
 *
 * Everyone selling this data quotes a match rate. Almost nobody rechecks, so
 * almost nobody can tell a team that a share of the handles they already hold
 * no longer reach a person. Where we measured it, say it.
 */
function decaySentence(s: HolderStats): string | null {
  const dead = s.xUnclaimed + s.xSuspended;
  if (dead < 5) return null;
  const checkedX = s.xLive + dead;
  if (checkedX === 0) return null;
  const pct = Math.round((dead / checkedX) * 100);
  return `${dead.toLocaleString()} of the ${checkedX.toLocaleString()} X handles we checked no longer reach anybody (${pct}%), which is the part a list you bought will not tell you.`;
}

function followerSentence(s: HolderStats): string | null {
  // Median, never mean. Follower distributions on an onchain audience are so
  // skewed that an average describes nobody in the list.
  if (s.medianFcFollowers === null || s.withFarcaster < 10) return null;
  return `The median Farcaster following among them is ${s.medianFcFollowers.toLocaleString()}.`;
}

/**
 * Address to (chain, collection, stats), shared by every lane.
 *
 * It lived inline in the X lane, so the Farcaster lane extracted an address and
 * then drafted "NO NUMBER AVAILABLE" for contracts we hold and have already
 * published. A lane should not be able to forget how to look something up.
 */
async function resolveContract(address: string | null): Promise<{
  chain: SupportedChain | null;
  collection: HolderCollection | null;
  stats: HolderStats | null;
}> {
  if (!address) return { chain: null, collection: null, stats: null };
  for (const c of SUPPORTED_CHAINS) {
    const collection = await getHolderCollection(c, address);
    if (!collection) continue;
    const s = await getHolderStats(c, address);
    return {
      chain: c,
      collection,
      stats: s && !measurementInProgress(s) ? s : null,
    };
  }
  return { chain: null, collection: null, stats: null };
}

/**
 * The seeder writes a placeholder when a contract exposes no name, and a
 * placeholder is never a display name.
 *
 * The index lane rejected these from the start. Then the other lanes learned to
 * resolve collections and started preferring `collection.name` over the handle,
 * so a placeholder began beating a perfectly good `@username`: a reply
 * addressed to "Unknown Token". The rule belongs in one function that every
 * lane calls, not in the one lane that happened to think of it.
 */
function isNamed(name: string | null | undefined): boolean {
  return Boolean(name && !/^unknown\b/i.test(name));
}

/** Best available label: a real collection name, else whoever posted. */
function displayName(
  collection: HolderCollection | null,
  fallback: string | null,
  lastResort: string
): string {
  if (isNamed(collection?.name)) return collection!.name;
  return fallback ?? lastResort;
}

/** The public report URL, only where one actually exists. */
function reportUrlFor(
  chain: SupportedChain | null,
  address: string | null,
  stats: HolderStats | null
): string | null {
  if (!chain || !address || !stats) return null;
  return `${SITE}/holders/${chain}/${address}`;
}

// ---------------------------------------------------------------------------
// Lane 1: the index we already hold
// ---------------------------------------------------------------------------

/**
 * Collections we have already measured and, in most cases, already published.
 *
 * This is the lane the plan missed. There are live reachability reports on real
 * collections whose teams have never been told they exist. Every one is a warm,
 * specific, zero-cost touch: their own numbers, their own audience, and a public
 * URL that was not made for the pitch.
 */
async function fromIndex(): Promise<Candidate[]> {
  const listed = await listHolderCollections();
  const out: Candidate[] = [];

  for (const col of listed) {
    // A collection we cannot name cannot be a personalised reply, and the
    // seeder writes this placeholder when the contract exposes no name. It is
    // still a fine public report; it is just not a prospect.
    if (!isNamed(col.name)) continue;

    const stats = await getHolderStats(col.chain, col.address);
    if (!stats) continue;
    // A near-zero reachable count on a barely-checked collection means "not
    // measured yet", not "few reachable people". Never quote that shape.
    if (measurementInProgress(stats)) continue;

    const overlap = await getHolderOverlap(col.chain, col.address, 3);
    out.push({
      lane: 'index',
      name: col.name,
      chain: col.chain,
      address: col.address,
      sourceUrl: null,
      reportUrl: `${SITE}/holders/${col.chain}/${col.address}`,
      handle: null,
      postedAt: null,
      excerpt: null,
      collection: col,
      stats,
      // Same naming rule as the candidate itself: an overlap we cannot name
      // reads as filler in a sentence meant to prove we know their audience.
      overlap: overlap
        .filter((o) => isNamed(o.name))
        .map((o) => ({ name: o.name, sharedHolders: o.sharedHolders })),
      hasPublicReport: true,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Lane 2: live announcements on X
// ---------------------------------------------------------------------------

interface Tweet {
  id: string;
  text: string;
  url?: string;
  createdAt?: string;
  author?: { userName?: string; followers?: number };
}

/**
 * Anchored, because unanchored is mostly farms.
 *
 * A plain keyword query for snapshot/allowlist/airdrop measured about 20 to 25%
 * genuine team announcements; the rest were follow-and-RT giveaway bots and paid
 * shill threads. Requiring a marketplace or explorer link in the post moved that
 * to roughly 45% and nearly all first-party. The phrase lane is small enough to
 * always run and is the highest-precision query of the three.
 */
const X_QUERIES = [
  '(snapshot OR allowlist OR whitelist OR airdrop OR "free mint") (url:opensea.io OR url:basescan.org OR url:etherscan.io) -filter:retweets -filter:replies lang:en',
  '("snapshot is live" OR "snapshot has been taken" OR "snapshot will be taken" OR "taking a snapshot" OR "snapshot taken") -filter:retweets -filter:replies lang:en',
];

const ADDRESS_RE = /0x[a-fA-F0-9]{40}/;

async function fromX(limit: number, sinceIso: string): Promise<Candidate[]> {
  const key = process.env.X_RESOLVER_API_KEY ?? process.env.TWITTERAPI_IO_KEY;
  if (!key) {
    console.warn('  x lane skipped: no X_RESOLVER_API_KEY');
    return [];
  }

  const seen = new Set<string>();
  const out: Candidate[] = [];

  for (const base of X_QUERIES) {
    const query = `${base} since:${sinceIso}`;
    let page: { tweets?: Tweet[] } = {};
    try {
      const url = new URL('https://api.twitterapi.io/twitter/tweet/advanced_search');
      url.searchParams.set('queryType', 'Latest');
      url.searchParams.set('query', query);
      const res = await fetch(url, { headers: { 'X-API-Key': key } });
      if (res.status === 402) {
        console.warn('  x lane stopped: twitterapi.io out of credits');
        break;
      }
      if (!res.ok) {
        console.warn(`  x lane stopped: twitterapi.io ${res.status}`);
        break;
      }
      page = (await res.json()) as { tweets?: Tweet[] };
    } catch (e) {
      console.warn(`  x lane error: ${e instanceof Error ? e.message : e}`);
      break;
    }

    for (const t of page.tweets ?? []) {
      if (!t?.id || seen.has(t.id)) continue;
      seen.add(t.id);

      // Only an address in the post gives a number for free. A marketplace
      // slug would need a resolution hop, which is a separate step a person
      // can trigger; the candidate is still worth printing without one.
      const address = t.text.match(ADDRESS_RE)?.[0]?.toLowerCase() ?? null;
      const { chain, collection, stats } = await resolveContract(address);

      out.push({
        lane: 'x',
        name: displayName(collection, t.author?.userName ?? null, 'unknown team'),
        chain,
        address,
        sourceUrl: t.url ?? `https://x.com/i/status/${t.id}`,
        reportUrl: reportUrlFor(chain, address, stats),
        handle: t.author?.userName ?? null,
        postedAt: t.createdAt ? new Date(t.createdAt) : null,
        excerpt: t.text.replace(/\s+/g, ' ').slice(0, 220),
        collection,
        stats,
        overlap: [],
        hasPublicReport: Boolean(collection && stats),
      });
    }
    // Break the QUERY loop, not just the tweet loop. Breaking only the inner
    // one still issued the next advanced_search and paid for a page of results
    // the cap had already made unreachable.
    if (out.length >= limit * 6) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Lane 3: Farcaster, on the free endpoint
// ---------------------------------------------------------------------------

/**
 * The Warpcast client API, unauthenticated and uncosted.
 *
 * Neynar is the obvious tool and it is unavailable: this period's spend is over
 * the plan limit, and Neynar pauses ALL requests on overage including the live
 * paid lookup path, so adding a caller now risks taking the product down to find
 * prospects. This endpoint is undocumented and may change without notice, so it
 * is wrapped and its failure is never fatal to the run.
 */
async function fromFarcaster(limit: number): Promise<Candidate[]> {
  const terms = ['snapshot', 'allowlist', 'airdrop for holders'];
  const out: Candidate[] = [];
  for (const q of terms) {
    try {
      const url = new URL('https://api.farcaster.xyz/v2/search-casts');
      url.searchParams.set('q', q);
      url.searchParams.set('limit', '20');
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`  farcaster lane: search-casts ${res.status}`);
        continue;
      }
      const json = (await res.json()) as {
        result?: { casts?: Array<Record<string, unknown>> };
      };
      for (const c of json.result?.casts ?? []) {
        const author = c.author as
          | { username?: string; followerCount?: number }
          | undefined;
        const text = String(c.text ?? '').replace(/\s+/g, ' ');
        const ts = typeof c.timestamp === 'number' ? new Date(c.timestamp) : null;
        const address = text.match(ADDRESS_RE)?.[0]?.toLowerCase() ?? null;
        const { chain, collection, stats } = await resolveContract(address);
        out.push({
          lane: 'farcaster',
          name: displayName(
            collection,
            author?.username ? `@${author.username}` : null,
            'unknown caster'
          ),
          chain,
          address,
          sourceUrl: author?.username
            ? `https://warpcast.com/${author.username}`
            : null,
          reportUrl: reportUrlFor(chain, address, stats),
          handle: author?.username ?? null,
          postedAt: ts,
          excerpt: text.slice(0, 220),
          collection,
          stats,
          overlap: [],
          hasPublicReport: Boolean(collection && stats),
        });
        if (out.length >= limit * 4) break;
      }
    } catch (e) {
      console.warn(`  farcaster lane error: ${e instanceof Error ? e.message : e}`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Ranking and drafting
// ---------------------------------------------------------------------------

/**
 * A candidate we can put a real number on always outranks one we cannot,
 * because the number is the entire reason the reply gets read.
 */
function score(c: Candidate): number {
  let s = 0;
  if (c.stats) s += 1_000_000;
  if (c.hasPublicReport) s += 100_000;
  if (c.stats) s += Math.min(c.stats.reachableAny, 50_000);
  if (c.chain) s += (10 - (CHAIN_RANK[c.chain] ?? 5)) * 100;
  return s;
}

function draft(c: Candidate): string {
  const lines: string[] = [];

  if (c.stats && c.collection) {
    lines.push(numberSentence(c.collection, c.stats));
    const decay = decaySentence(c.stats);
    if (decay) lines.push(decay);
    const fol = followerSentence(c.stats);
    if (fol) lines.push(fol);
    if (c.overlap.length > 0) {
      const top = c.overlap[0];
      lines.push(
        `Their holders overlap most with ${top.name} (${top.sharedHolders.toLocaleString()} wallets in common), which is the partnership list nobody asks for.`
      );
    }
    if (c.reportUrl) {
      lines.push(`The full report is already public: ${c.reportUrl}`);
    }
    lines.push('Misses cost nothing, and the first 100 matches are free.');
  } else {
    lines.push(
      'NO NUMBER AVAILABLE. Do not invent one. Either run their contract through the app first, or open with the chain-level figure only:'
    );
    lines.push(
      'On Base we resolve up to 46.2% of a holder list to a reachable X or Farcaster account, against 16.6% on Ethereum. The chain decides the number more than the collection does.'
    );
  }
  return lines.join(' ');
}

function render(c: Candidate, i: number): string {
  const head = `${String(i + 1).padStart(2, '0')}  [${c.lane}] ${c.name}`;
  const meta: string[] = [];
  if (c.chain) meta.push(chainLabel(c.chain));
  if (c.handle) meta.push(`@${c.handle}`);
  if (c.postedAt) meta.push(c.postedAt.toISOString().slice(0, 16).replace('T', ' '));
  if (c.address) meta.push(c.address);

  const body = [
    head,
    meta.length ? `    ${meta.join('  |  ')}` : null,
    c.excerpt ? `    post: ${c.excerpt}` : null,
    c.sourceUrl ? `    post:  ${c.sourceUrl}` : null,
    c.reportUrl ? `    report: ${c.reportUrl}` : null,
    '',
    `    DRAFT: ${draft(c)}`,
    '',
  ].filter(Boolean);
  return body.join('\n');
}

// ---------------------------------------------------------------------------

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const source = arg('source', 'index');
  const limit = Number(arg('limit', String(DEFAULT_LIMIT)));
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  console.log(`\nConcierge signals  ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`);
  console.log(`source=${source}  limit=${limit}\n`);

  const candidates: Candidate[] = [];
  if (source === 'index' || source === 'all') {
    candidates.push(...(await fromIndex()));
  }
  if (source === 'x' || source === 'all') {
    candidates.push(...(await fromX(limit, since)));
  }
  if (source === 'farcaster' || source === 'all') {
    candidates.push(...(await fromFarcaster(limit)));
  }

  if (candidates.length === 0) {
    console.log('No candidates. The index lane never returns zero unless the');
    console.log('database is unreachable, so check that first.\n');
    return;
  }

  /**
   * Dedupe before slicing, because the lanes overlap by design.
   *
   * With source=all, a contract we already hold can arrive from the index lane
   * and again from an X post announcing it. Unmerged, one prospect ate two of
   * the three daily slots. Identity is the contract where there is one, and the
   * handle otherwise; the highest-scoring copy wins, so the version carrying a
   * measured number survives.
   */
  const best = new Map<string, Candidate>();
  /**
   * handle to the key it already belongs under.
   *
   * One prospect has two identities, a contract and a handle, and either can
   * arrive first. Keying on "contract if present, else handle" looked
   * sufficient and is not: a contract-keyed winner picks up a handle when a
   * post merges into it, and a later post from that same handle still hashes to
   * `handle:...` and takes a second slot. The alias map is what makes the two
   * identities converge no matter which order they arrive in.
   */
  const aliasOf = new Map<string, string>();

  const handleKey = (h: string | null) =>
    h ? `handle:${h.toLowerCase()}` : null;

  for (const c of candidates.sort((a, b) => score(b) - score(a))) {
    const contractKey = c.chain && c.address ? `${c.chain}:${c.address}` : null;
    const hKey = handleKey(c.handle);
    const key =
      contractKey ??
      (hKey && aliasOf.get(hKey)) ??
      hKey ??
      `src:${c.sourceUrl ?? c.name}`;

    const prior = best.get(key);
    if (!prior) {
      best.set(key, c);
      if (hKey) aliasOf.set(hKey, key);
      continue;
    }

    // Keep the winner, but do not lose the fact that a live post triggered it.
    if (!prior.sourceUrl && c.sourceUrl) {
      prior.sourceUrl = c.sourceUrl;
      prior.excerpt = prior.excerpt ?? c.excerpt;
      prior.postedAt = prior.postedAt ?? c.postedAt;
    }
    // A handle learned on merge has to join the alias map too, or the next post
    // from that handle opens a second entry for the same prospect.
    if (!prior.handle && c.handle) prior.handle = c.handle;
    const merged = handleKey(prior.handle);
    if (merged) aliasOf.set(merged, key);
  }

  const ranked = [...best.values()].slice(0, limit);

  console.log(
    `${candidates.length} candidate(s), ${best.size} after dedupe, showing top ${ranked.length}\n`
  );
  console.log('='.repeat(72));
  for (const [i, c] of ranked.entries()) {
    console.log(render(c, i));
    console.log('='.repeat(72));
  }

  const withNumbers = ranked.filter((c) => c.stats).length;
  console.log(
    `\n${withNumbers}/${ranked.length} carry a measured number. Nothing was sent.`
  );
  console.log('Edit before sending. Never quote a figure this script did not print.\n');
}

main().catch((e) => {
  console.error('concierge-signals failed:', e);
  process.exit(1);
});
