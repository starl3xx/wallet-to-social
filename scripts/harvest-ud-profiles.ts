/**
 * Unstoppable Domains profile harvest.
 *
 * A UD profile's social accounts carry a per-platform `verified` flag, and
 * verified means the person signed in with the wallet that owns the domain
 * and proved the account to the platform by OAuth: an owner-established
 * binding on both ends, the same mechanism as the marketplace-account
 * enrichment. Only entries with `verified` AND `public` true are ingested;
 * an unverified entry is owner-typed text on an offchain profile, which is
 * weaker than every source this graph calls attested, so it is counted and
 * skipped rather than written.
 *
 * Both endpoints are keyless (verified live 2026-09-20):
 *   GET /profile/resolve/{address}          reverse resolution, 404 = none
 *   GET /profile/public/{domain}?fields=socialAccounts
 *
 * The provider is mid-rebrand and its partner program is gone (the old
 * dashboard answers 410), so these endpoints have no published terms, no
 * published limits, and no promised lifetime. That cuts both ways: nothing
 * gates access today, and nothing says it still answers next quarter. The
 * harvest is therefore checkpointed and budgeted so an endpoint change
 * mid-walk loses nothing, and the pause is generous because the only rate
 * limit is whatever does not draw attention.
 *
 * Two shapes, one script:
 *   default          a one-shot targeted batch: wallets we know are real (a
 *                    Farcaster account) whose X side is missing, most-followed
 *                    first; the same target list as the marketplace enrichment
 *   --walk           the checkpointed keyset walk over every graph wallet
 *                    missing an X handle, resumable across runs
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/harvest-ud-profiles.ts                 # dry run, targeted
 *   npx tsx --env-file=.env.local scripts/harvest-ud-profiles.ts --commit
 *   npx tsx --env-file=.env.local scripts/harvest-ud-profiles.ts --walk --max-requests 2000 --commit
 *
 * Flags:
 *   --wallets 0x..,0x..   enrich exactly these wallets
 *   --limit N             targeted mode: how many missing-X wallets (default 200)
 *   --walk                checkpointed walk over all missing-X wallets
 *   --max-requests N      walk mode: HTTP request budget for this run (default 1000)
 *   --from-wallet 0x..    walk mode: override the checkpoint cursor
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
  id: 'ud_profile',
  /** twitter(20) + ud_profile(25) in `calculateQualityScore`. */
  quality: 45,
};

const STATE_KEY = 'ud_profile_harvest';
const API = 'https://api.unstoppabledomains.com';
// Keyless and unmetered, which is a reason to go slower, not faster: the
// pause is the whole rate-limit story for this provider.
const PAUSE_MS = 400;
/** Wallets fetched from the graph per keyset page in walk mode. */
const WALK_PAGE = 500;

interface Args {
  commit: boolean;
  wallets: string[] | null;
  limit: number;
  walk: boolean;
  maxRequests: number;
  fromWallet: string | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    commit: false,
    wallets: null,
    limit: 200,
    walk: false,
    maxRequests: 1000,
    fromWallet: null,
  };
  const takesValue = new Set([
    '--wallets',
    '--limit',
    '--max-requests',
    '--from-wallet',
  ]);
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--commit') {
      args.commit = true;
      continue;
    }
    if (flag === '--walk') {
      args.walk = true;
      continue;
    }
    if (!takesValue.has(flag)) throw new Error(`Unknown flag: ${flag}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`${flag} needs a value`);
    }
    i++;
    if (flag === '--wallets') {
      const wallets = value.split(',').map((w) => w.trim().toLowerCase());
      for (const w of wallets) {
        if (!/^0x[a-f0-9]{40}$/.test(w))
          throw new Error(`Not a wallet address: ${w}`);
      }
      args.wallets = wallets;
    } else if (flag === '--from-wallet') {
      const w = value.trim().toLowerCase();
      if (!/^0x[a-f0-9]{40}$/.test(w))
        throw new Error(`Not a wallet address: ${w}`);
      args.fromWallet = w;
    } else {
      const n = Number(value);
      if (!Number.isInteger(n) || n <= 0)
        throw new Error(`${flag} needs a positive integer`);
      if (flag === '--limit') args.limit = n;
      else args.maxRequests = n;
    }
  }
  return args;
}

/**
 * The targeted list: wallets whose owner we know exists (a Farcaster account)
 * but whose X side is empty, most-followed first, skipping rows the conflict
 * resolver cleared (their NULL means "decided", not "unknown"). The same
 * shape as the marketplace enrichment's default, because it is the same bet:
 * a person real enough to hold one identity is the likeliest to hold another.
 */
async function missingXWallets(limit: number): Promise<string[]> {
  const db = getDb();
  if (!db) throw new Error('Database not configured');
  const result = (await db.execute(sql`
    SELECT wallet FROM social_graph
    WHERE twitter_handle IS NULL
      AND twitter_renamed_from IS NULL
      AND farcaster IS NOT NULL
    ORDER BY fc_followers DESC NULLS LAST
    LIMIT ${limit}
  `)) as unknown as { rows: Array<{ wallet: string }> };
  return result.rows.map((r) => r.wallet);
}

/** Walk mode: the next keyset page of missing-X wallets after the cursor. */
async function walkPage(afterWallet: string): Promise<string[]> {
  const db = getDb();
  if (!db) throw new Error('Database not configured');
  const result = (await db.execute(sql`
    SELECT wallet FROM social_graph
    WHERE wallet > ${afterWallet}
      AND twitter_handle IS NULL
      AND twitter_renamed_from IS NULL
    ORDER BY wallet
    LIMIT ${WALK_PAGE}
  `)) as unknown as { rows: Array<{ wallet: string }> };
  return result.rows.map((r) => r.wallet);
}

async function getCheckpoint(): Promise<string | null> {
  const db = getDb();
  if (!db) throw new Error('Database not configured');
  const result = (await db.execute(
    sql`SELECT value->>'lastWallet' AS last_wallet FROM ingest_state WHERE name = ${STATE_KEY}`
  )) as unknown as { rows: Array<{ last_wallet: string | null }> };
  return result.rows[0]?.last_wallet ?? null;
}

async function saveCheckpoint(lastWallet: string): Promise<void> {
  const db = getDb();
  if (!db) throw new Error('Database not configured');
  await db.execute(sql`
    INSERT INTO ingest_state (name, value, updated_at)
    VALUES (${STATE_KEY}, jsonb_build_object('lastWallet', ${lastWallet}::text), now())
    ON CONFLICT (name) DO UPDATE
    SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
  `);
}

/**
 * One GET with the retry shape the other keyless harvests settled on: 429 and
 * 5xx back off and retry, anything else unexpected throws so a shape change
 * stops the run rather than recording absence over an error.
 */
async function getJson(
  path: string
): Promise<{ status: number; json: unknown }> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${API}${path}`, {
      headers: { Accept: 'application/json' },
    });
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= 4)
        throw new Error(
          `UD API ${res.status} on ${path} after ${attempt} attempts`
        );
      await new Promise((r) => setTimeout(r, attempt * 5000));
      continue;
    }
    if (res.status === 404) return { status: 404, json: null };
    if (!res.ok) {
      throw new Error(
        `UD API ${res.status} on ${path}: ${(await res.text()).slice(0, 300)}`
      );
    }
    return { status: res.status, json: await res.json() };
  }
}

type Outcome =
  | 'noDomain'
  | 'noProfile'
  | 'noSocial'
  | 'unverified'
  | 'privateEntry'
  | 'numericId'
  | 'handle';

interface WalletResult {
  link: AttestedLink | null;
  outcome: Outcome;
  /** HTTP requests spent on this wallet (1, or 2 when a domain resolved). */
  requests: number;
}

async function checkWallet(wallet: string): Promise<WalletResult> {
  const reverse = await getJson(`/profile/resolve/${wallet}`);
  if (reverse.status === 404) {
    return { link: null, outcome: 'noDomain', requests: 1 };
  }
  const name = (reverse.json as { name?: string } | null)?.name;
  if (!name) return { link: null, outcome: 'noDomain', requests: 1 };

  await new Promise((r) => setTimeout(r, PAUSE_MS));
  const profile = await getJson(
    `/profile/public/${encodeURIComponent(name)}?fields=socialAccounts`
  );
  if (profile.status === 404) {
    return { link: null, outcome: 'noProfile', requests: 2 };
  }
  const twitter = (
    profile.json as {
      socialAccounts?: {
        twitter?: { location?: string; verified?: boolean; public?: boolean };
      };
    } | null
  )?.socialAccounts?.twitter;

  if (!twitter?.location)
    return { link: null, outcome: 'noSocial', requests: 2 };
  if (twitter.verified !== true)
    return { link: null, outcome: 'unverified', requests: 2 };
  if (twitter.public !== true)
    return { link: null, outcome: 'privateEntry', requests: 2 };
  // A purely numeric value is more plausibly an account id than a handle,
  // and the graph's rule is that an id is only stored beside the handle it
  // belongs to. Same skip as the marketplace enrichment.
  if (/^\d+$/.test(twitter.location.trim()))
    return { link: null, outcome: 'numericId', requests: 2 };
  return {
    link: { wallet, handle: twitter.location },
    outcome: 'handle',
    requests: 2,
  };
}

function newCounts(): Record<Outcome, number> {
  return {
    noDomain: 0,
    noProfile: 0,
    noSocial: 0,
    unverified: 0,
    privateEntry: 0,
    numericId: 0,
    handle: 0,
  };
}

function logCounts(counts: Record<Outcome, number>, walletsSeen: number) {
  console.log(
    `Wallets: ${walletsSeen} checked, ${counts.noDomain} without a domain, ` +
      `${counts.noProfile} domain but no profile, ${counts.noSocial} without socials, ` +
      `${counts.unverified} unverified (skipped), ${counts.privateEntry} private (skipped), ` +
      `${counts.numericId} numeric-id (skipped), ${counts.handle} with a verified handle`
  );
}

async function ingestOrPreview(links: AttestedLink[], commit: boolean) {
  if (links.length === 0) {
    console.log('Nothing to ingest.');
    return;
  }
  if (commit) {
    const stats = await ingestLinks(links, SOURCE);
    console.log('Ingested:', JSON.stringify(stats, null, 2));
  } else {
    const { links: deduped, contested, rejected } = dedupeByWallet(links);
    const classified = await classifyLinks(deduped);
    console.log(
      'Would ingest:',
      JSON.stringify(
        { links: deduped.length, contested, rejected, ...classified },
        null,
        2
      )
    );
  }
}

async function runTargeted(args: Args) {
  const wallets = args.wallets ?? (await missingXWallets(args.limit));
  console.log(
    `${args.commit ? 'COMMIT' : 'dry run'}: ${wallets.length} wallets ` +
      (args.wallets ? '(from --wallets)' : '(missing X, most-followed first)')
  );

  const counts = newCounts();
  const links: AttestedLink[] = [];
  for (const wallet of wallets) {
    const { link, outcome } = await checkWallet(wallet);
    counts[outcome]++;
    if (link) links.push(link);
    await new Promise((r) => setTimeout(r, PAUSE_MS));
  }
  logCounts(counts, wallets.length);
  await ingestOrPreview(links, args.commit);
  if (!args.commit)
    console.log('\nDry run: nothing written. Re-run with --commit.');
}

async function runWalk(args: Args) {
  const checkpoint = await getCheckpoint();
  let cursor =
    args.fromWallet ??
    checkpoint ??
    '0x0000000000000000000000000000000000000000';
  console.log(
    `${args.commit ? 'COMMIT' : 'dry run'} walk: from wallet > ${cursor}, ` +
      `max ${args.maxRequests} requests` +
      (checkpoint !== null ? ` (checkpoint was ${checkpoint})` : '')
  );

  const counts = newCounts();
  let requests = 0;
  let walletsSeen = 0;
  let exhausted = false;
  const links: AttestedLink[] = [];

  outer: while (requests < args.maxRequests) {
    const page = await walkPage(cursor);
    if (page.length === 0) {
      exhausted = true;
      break;
    }
    for (const wallet of page) {
      if (requests >= args.maxRequests) break outer;
      const result = await checkWallet(wallet);
      requests += result.requests;
      walletsSeen++;
      counts[result.outcome]++;
      if (result.link) links.push(result.link);
      // The cursor advances per wallet checked, so a budget stop mid-page
      // resumes at the next unchecked wallet rather than re-reading the page.
      cursor = wallet;
      await new Promise((r) => setTimeout(r, PAUSE_MS));
    }
    if (args.commit) {
      // Links land per page and the checkpoint follows them, so a failed run
      // keeps everything it already found.
      const pageLinks = links.splice(0, links.length);
      if (pageLinks.length > 0) await ingestLinks(pageLinks, SOURCE);
      await saveCheckpoint(cursor);
    }
    if (walletsSeen % 2000 < WALK_PAGE) {
      console.log(
        `  ${requests} requests, ${walletsSeen.toLocaleString()} wallets, ` +
          `${counts.handle} verified handles, cursor ${cursor}`
      );
    }
  }

  logCounts(counts, walletsSeen);
  if (args.commit) {
    // Whatever the budget stop left unflushed. The checkpoint saves whenever
    // the cursor moved, not only when the partial page found handles: at the
    // measured hit rate nearly every page finds nothing, and dropping the
    // cursor for that made the next run re-pay a whole page of requests.
    if (links.length > 0) await ingestLinks(links, SOURCE);
    if (walletsSeen > 0 && !exhausted) await saveCheckpoint(cursor);
    // A finished walk wraps to the start rather than parking at the highest
    // address: the walk exists for wallets that ENTER the graph missing an X
    // handle, and a new row can sort anywhere in the keyset. The budget makes
    // the re-walk cheap per run, and the fill-only ingest makes it harmless.
    if (exhausted) {
      await saveCheckpoint('0x0000000000000000000000000000000000000000');
    }
    console.log(
      exhausted
        ? '\nReached the end of the missing-X wallets; checkpoint wrapped to the start.'
        : `\nRequest budget (${args.maxRequests}) reached; re-run to continue from the checkpoint.`
    );
  } else {
    await ingestOrPreview(links, false);
    console.log(
      '\nDry run: nothing written, no checkpoint saved. Re-run with --commit.'
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  if (args.walk && args.wallets) {
    console.error('--walk and --wallets are different modes; pick one');
    process.exit(1);
  }
  if (args.walk) await runWalk(args);
  else await runTargeted(args);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
