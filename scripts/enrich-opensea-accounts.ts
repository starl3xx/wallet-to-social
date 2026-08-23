/**
 * OpenSea account enrichment.
 *
 * An OpenSea account is a wallet login, and its connected social accounts
 * are attached through OAuth sign-in, so a Twitter entry there is an
 * owner-established binding on both ends: an attested-link peer. The v2
 * accounts endpoint is per-address, so this is an enrichment for chosen
 * wallets rather than a corpus sweep. By default it targets the wallets
 * with the most to gain: people we already know are real (they have a
 * Farcaster account) whose X side is missing, most-followed first.
 *
 * The endpoint's `social_media_accounts` username is sometimes a numeric X
 * user id rather than a handle (verified live on 2026-08-22: one account
 * returned a handle, another an id). A bare id must not be written — the
 * graph's rule is that an id is only stored beside the handle it belongs
 * to — so numeric values are counted and skipped until an id-to-handle
 * resolver hop exists.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/enrich-opensea-accounts.ts                    # dry run
 *   npx tsx --env-file=.env.local scripts/enrich-opensea-accounts.ts --commit
 *
 * Flags:
 *   --wallets 0x..,0x..   enrich exactly these wallets
 *   --limit N             how many missing-X wallets to try (default 200)
 *
 * Needs OPENSEA_API_KEY.
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
  id: 'opensea_profile',
  /** twitter(20) + opensea_profile(25) in `calculateQualityScore`. */
  quality: 45,
};

// Documented key rate limits are per-second; a pause per request keeps a
// run polite without babysitting.
const PAUSE_MS = 300;

interface Args {
  commit: boolean;
  wallets: string[] | null;
  limit: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { commit: false, wallets: null, limit: 200 };
  const takesValue = new Set(['--wallets', '--limit']);
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--commit') {
      args.commit = true;
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
        if (!/^0x[a-f0-9]{40}$/.test(w)) throw new Error(`Not a wallet address: ${w}`);
      }
      args.wallets = wallets;
    } else {
      const n = Number(value);
      if (!Number.isInteger(n) || n <= 0) throw new Error('--limit needs a positive integer');
      args.limit = n;
    }
  }
  return args;
}

/**
 * The default target list: wallets whose owner we know exists (a Farcaster
 * account) but whose X side is empty, most-followed first, skipping rows
 * the conflict resolver cleared (their NULL means "decided", not "unknown").
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

interface AccountResult {
  link: AttestedLink | null;
  outcome: 'handle' | 'numericId' | 'noSocial' | 'noAccount';
}

async function fetchAccount(key: string, wallet: string): Promise<AccountResult> {
  const res = await fetch(`https://api.opensea.io/api/v2/accounts/${wallet}`, {
    headers: { 'x-api-key': key },
  });
  if (res.status === 400 || res.status === 404) {
    return { link: null, outcome: 'noAccount' };
  }
  if (!res.ok) {
    throw new Error(`OpenSea ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    social_media_accounts?: Array<{ platform: string; username: string }>;
  };
  const twitter = json.social_media_accounts?.find((s) => s.platform === 'twitter');
  if (!twitter?.username) return { link: null, outcome: 'noSocial' };
  if (/^\d+$/.test(twitter.username)) return { link: null, outcome: 'numericId' };
  return { link: { wallet, handle: twitter.username }, outcome: 'handle' };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const key = process.env.OPENSEA_API_KEY;
  if (!key) {
    console.error('OPENSEA_API_KEY is required');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const wallets = args.wallets ?? (await missingXWallets(args.limit));
  console.log(
    `${args.commit ? 'COMMIT' : 'dry run'}: ${wallets.length} wallets ` +
      (args.wallets ? '(from --wallets)' : '(missing X, most-followed first)')
  );

  const counts = { handle: 0, numericId: 0, noSocial: 0, noAccount: 0 };
  const links: AttestedLink[] = [];
  for (const wallet of wallets) {
    const { link, outcome } = await fetchAccount(key, wallet);
    counts[outcome]++;
    if (link) links.push(link);
    await new Promise((r) => setTimeout(r, PAUSE_MS));
  }
  console.log(
    `Accounts: ${counts.handle} with a handle, ${counts.numericId} numeric-id ` +
      `(skipped pending a resolver), ${counts.noSocial} without socials, ` +
      `${counts.noAccount} with no account`
  );

  if (args.commit) {
    const stats = await ingestLinks(links, SOURCE);
    console.log('Done:', JSON.stringify(stats, null, 2));
  } else {
    const { links: deduped, contested, rejected } = dedupeByWallet(links);
    const classified = await classifyLinks(deduped);
    console.log(
      'Would ingest:',
      JSON.stringify({ links: deduped.length, contested, rejected, ...classified }, null, 2)
    );
    console.log('\nDry run: nothing written. Re-run with --commit.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
