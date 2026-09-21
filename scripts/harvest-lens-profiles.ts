/**
 * Lens account-metadata harvest.
 *
 * A Lens account's metadata is set by the account owner, and its attributes
 * can carry an X handle under the keys `x` or `twitter`. That is an
 * owner-set record naming a handle nobody checked: the same evidence tier
 * as a governance profile, so the same class and the same quality floor.
 * The wallet written is the account's OWNER (the controlling EOA), which is
 * the address that joins the rest of the graph; the account's own smart
 * address is deliberately not written in this pass.
 *
 * The network's social era ended when its biggest client shut down in early
 * 2025, so the graph is largely static: this walk is a backfill that runs
 * to the end once and can be re-dispatched occasionally, not a daily
 * pipeline. Probed before building (2026-09-20): 12 of the first 50
 * accounts carried an x/twitter attribute, against 0 of 560 for the
 * identity network examined the same day, which is why this adapter exists
 * and that one does not.
 *
 * Free public GraphQL, keyless; the request budget bounds a run and the
 * cursor in ingest_state makes the walk resumable.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/harvest-lens-profiles.ts                  # dry run
 *   npx tsx --env-file=.env.local scripts/harvest-lens-profiles.ts --commit
 *
 * Flags:
 *   --max-requests N   GraphQL request budget for this run (default 500)
 *   --reset            ignore the checkpoint and start from the top
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
  id: 'lens_profile',
  /** twitter(20) + lens_profile(25) in `calculateQualityScore`. */
  quality: 45,
};

const STATE_KEY = 'lens_profile_harvest';
const API = 'https://api.lens.xyz/graphql';
// Keyless public API; a pause per request keeps a long walk polite.
const PAUSE_MS = 250;

interface Args {
  commit: boolean;
  maxRequests: number;
  reset: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { commit: false, maxRequests: 500, reset: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--commit') {
      args.commit = true;
      continue;
    }
    if (flag === '--reset') {
      args.reset = true;
      continue;
    }
    if (flag !== '--max-requests') throw new Error(`Unknown flag: ${flag}`);
    const value = argv[++i];
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0)
      throw new Error('--max-requests needs a positive integer');
    args.maxRequests = n;
  }
  return args;
}

async function getCheckpoint(): Promise<string | null> {
  const db = getDb();
  if (!db) throw new Error('Database not configured');
  const result = (await db.execute(
    sql`SELECT value->>'cursor' AS cursor FROM ingest_state WHERE name = ${STATE_KEY}`
  )) as unknown as { rows: Array<{ cursor: string | null }> };
  return result.rows[0]?.cursor ?? null;
}

async function saveCheckpoint(cursor: string | null): Promise<void> {
  const db = getDb();
  if (!db) throw new Error('Database not configured');
  await db.execute(sql`
    INSERT INTO ingest_state (name, value, updated_at)
    VALUES (${STATE_KEY}, jsonb_build_object('cursor', ${cursor}::text), now())
    ON CONFLICT (name) DO UPDATE
    SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
  `);
}

interface AccountItem {
  owner: string;
  metadata: { attributes: Array<{ key: string; value: string }> | null } | null;
}

async function fetchPage(cursor: string | null): Promise<{
  items: AccountItem[];
  next: string | null;
}> {
  const request = cursor
    ? `{ pageSize: FIFTY, cursor: ${JSON.stringify(cursor)} }`
    : '{ pageSize: FIFTY }';
  const query = `{ accounts(request: ${request}) { items { owner metadata { attributes { key value } } } pageInfo { next } } }`;

  for (let attempt = 1; ; attempt++) {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= 4)
        throw new Error(`Lens API ${res.status} after ${attempt} attempts`);
      await new Promise((r) => setTimeout(r, attempt * 5000));
      continue;
    }
    if (!res.ok) {
      throw new Error(
        `Lens API ${res.status}: ${(await res.text()).slice(0, 300)}`
      );
    }
    const json = (await res.json()) as {
      data?: {
        accounts?: {
          items?: AccountItem[];
          pageInfo?: { next?: string | null };
        };
      };
      errors?: Array<{ message: string }>;
    };
    if (json.errors?.length) {
      throw new Error(`Lens API errors: ${json.errors[0].message}`);
    }
    const accounts = json.data?.accounts;
    if (!accounts || !Array.isArray(accounts.items)) {
      throw new Error(
        `Unexpected response shape: ${JSON.stringify(json).slice(0, 200)}`
      );
    }
    return { items: accounts.items, next: accounts.pageInfo?.next ?? null };
  }
}

/** The owner-set attribute keys that name an X account, in preference order. */
const X_KEYS = ['x', 'twitter', 'com.twitter'];

function linkFrom(item: AccountItem): AttestedLink | null {
  const wallet = String(item.owner ?? '').toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(wallet)) return null;
  const attributes = item.metadata?.attributes ?? [];
  for (const key of X_KEYS) {
    const hit = attributes.find(
      (a) => a.key.toLowerCase() === key && typeof a.value === 'string'
    );
    // Handle or URL: the shared ingest normalizes both and rejects junk.
    if (hit?.value.trim()) return { wallet, handle: hit.value };
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const checkpoint = args.reset ? null : await getCheckpoint();
  let cursor = checkpoint;
  console.log(
    `${args.commit ? 'COMMIT' : 'dry run'}: max ${args.maxRequests} requests` +
      (checkpoint ? ' (resuming from checkpoint)' : ' (from the top)')
  );

  const totals = {
    requests: 0,
    accounts: 0,
    withX: 0,
    links: 0,
    contested: 0,
    rejected: 0,
    newWallets: 0,
    filled: 0,
    agree: 0,
    conflicts: 0,
  };
  let exhausted = false;

  while (totals.requests < args.maxRequests) {
    const page = await fetchPage(cursor);
    totals.requests++;
    if (page.items.length === 0) {
      // Both end-of-walk shapes reset the checkpoint, or the stale cursor
      // pins every later run on this same empty page and the monthly touch
      // quietly dies after the backfill (caught in review).
      if (args.commit) await saveCheckpoint(null);
      exhausted = true;
      break;
    }
    totals.accounts += page.items.length;

    const links = page.items
      .map(linkFrom)
      .filter((l): l is AttestedLink => l !== null);
    totals.withX += links.length;

    if (args.commit) {
      if (links.length > 0) {
        const stats = await ingestLinks(links, SOURCE);
        totals.links += stats.links;
        totals.contested += stats.contested;
        totals.rejected += stats.rejected;
        totals.newWallets += stats.newWallets;
        totals.filled += stats.filled;
        totals.agree += stats.agree;
        totals.conflicts += stats.conflicts;
      }
      // The checkpoint advances over pages with no handles too: read is read.
      await saveCheckpoint(page.next);
    } else if (links.length > 0) {
      const { links: deduped, contested, rejected } = dedupeByWallet(links);
      const counts = await classifyLinks(deduped);
      totals.links += deduped.length;
      totals.contested += contested;
      totals.rejected += rejected;
      totals.newWallets += counts.newWallets;
      totals.filled += counts.wouldFill;
      totals.agree += counts.agree;
      totals.conflicts += counts.disagree;
    }

    if (page.next === null) {
      exhausted = true;
      break;
    }
    cursor = page.next;
    if (totals.requests % 50 === 0) {
      console.log(
        `  ${totals.requests} requests, ${totals.accounts.toLocaleString()} accounts, ` +
          `${totals.withX.toLocaleString()} with an X attribute`
      );
    }
    await new Promise((r) => setTimeout(r, PAUSE_MS));
  }

  console.log(
    exhausted
      ? '\nReached the end of the accounts list.'
      : `\nRequest budget (${args.maxRequests}) reached; re-run to continue from the checkpoint.`
  );
  console.log('Done:', JSON.stringify(totals, null, 2));
  if (!args.commit) {
    console.log(
      '\nDry run: nothing written, no checkpoint saved. Re-run with --commit.'
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
