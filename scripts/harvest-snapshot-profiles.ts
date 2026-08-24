/**
 * Snapshot profile harvest.
 *
 * A Snapshot profile is set with a wallet-signed message, and the profile
 * carries an optional Twitter handle, so a filled handle is the wallet
 * owner's own claim at ENS-text-record strength (signed, just not published
 * to a chain). The hub GraphQL API is public and keyless; this walks the
 * users table oldest-first on `created` and hands the filled profiles to
 * the shared attested-link ingest (lib/attested-links.ts), which owns the
 * fill-only rules, the agreement gate, conflict recording, and the quality
 * contract.
 *
 * Most profiles carry no handle, so the harvest reads far more rows than it
 * keeps; the per-run request budget is the knob that bounds a run, and the
 * checkpoint makes the sweep resumable across as many runs as it takes.
 *
 * Cursoring is `created_gt`, so two users sharing one `created` second can
 * shadow each other at a page boundary: the loss is at most one profile per
 * pathological tie and re-running from an earlier --since recovers it.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/harvest-snapshot-profiles.ts             # dry run
 *   npx tsx --env-file=.env.local scripts/harvest-snapshot-profiles.ts --commit
 *
 * Flags:
 *   --since UNIXTS       start cursor (default: checkpoint, else 0)
 *   --max-requests N     GraphQL request budget for this run (default 500)
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
  id: 'snapshot_profile',
  /** twitter(20) + snapshot_profile(25) in `calculateQualityScore`. */
  quality: 45,
};

const STATE_KEY = 'snapshot_profile_harvest';
const HUB = 'https://hub.snapshot.org/graphql';
const PAGE_SIZE = 1000;
// The hub rate-limits anonymous callers; a pause per request keeps a long
// run under it without babysitting.
const PAUSE_MS = 700;

interface Args {
  commit: boolean;
  since: number | null;
  maxRequests: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { commit: false, since: null, maxRequests: 500 };
  const takesValue = new Set(['--since', '--max-requests']);
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
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0)
      throw new Error(`${flag} needs a non-negative integer`);
    if (flag === '--since') args.since = n;
    else args.maxRequests = n;
  }
  if (args.maxRequests <= 0)
    throw new Error('--max-requests needs a positive integer');
  return args;
}

async function getCheckpoint(): Promise<number | null> {
  const db = getDb();
  if (!db) throw new Error('Database not configured');
  const result = (await db.execute(
    sql`SELECT value->>'lastCreated' AS last_created FROM ingest_state WHERE name = ${STATE_KEY}`
  )) as unknown as { rows: Array<{ last_created: string | null }> };
  const raw = result.rows[0]?.last_created;
  return raw ? parseInt(raw, 10) : null;
}

async function saveCheckpoint(lastCreated: number): Promise<void> {
  const db = getDb();
  if (!db) throw new Error('Database not configured');
  await db.execute(sql`
    INSERT INTO ingest_state (name, value, updated_at)
    VALUES (${STATE_KEY}, jsonb_build_object('lastCreated', ${lastCreated}::bigint), now())
    ON CONFLICT (name) DO UPDATE
    SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
  `);
}

interface SnapshotUser {
  id: string;
  twitter: string | null;
  created: number;
}

async function fetchPage(createdGt: number): Promise<SnapshotUser[]> {
  const query = `query Users($createdGt: Int!) {
    users(first: ${PAGE_SIZE}, orderBy: "created", orderDirection: asc,
          where: { created_gt: $createdGt }) {
      id
      twitter
      created
    }
  }`;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(HUB, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { createdGt } }),
    });
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= 4)
        throw new Error(`Snapshot hub ${res.status} after ${attempt} attempts`);
      await new Promise((r) => setTimeout(r, attempt * 5000));
      continue;
    }
    if (!res.ok) {
      throw new Error(
        `Snapshot hub ${res.status}: ${(await res.text()).slice(0, 300)}`
      );
    }
    const json = (await res.json()) as {
      data?: { users?: SnapshotUser[] };
      errors?: Array<{ message: string }>;
    };
    if (json.errors?.length) {
      throw new Error(
        `Snapshot hub errors: ${json.errors.map((e) => e.message).join('; ')}`
      );
    }
    if (!Array.isArray(json.data?.users)) {
      throw new Error(
        `Unexpected response shape (no users array): ${JSON.stringify(json).slice(0, 300)}`
      );
    }
    return json.data.users;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const checkpoint = await getCheckpoint();
  let cursor = args.since ?? checkpoint ?? 0;
  console.log(
    `${args.commit ? 'COMMIT' : 'dry run'}: from created > ${cursor}, ` +
      `max ${args.maxRequests} requests` +
      (checkpoint !== null ? ` (checkpoint was ${checkpoint})` : '')
  );

  const totals = {
    requests: 0,
    usersSeen: 0,
    withTwitter: 0,
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
    const users = await fetchPage(cursor);
    totals.requests++;
    if (users.length === 0) {
      exhausted = true;
      break;
    }
    totals.usersSeen += users.length;
    const pageEnd = users[users.length - 1].created;

    const links: AttestedLink[] = users
      .filter((u) => u.twitter && u.twitter.trim() !== '')
      .map((u) => ({ wallet: u.id, handle: u.twitter as string }));
    totals.withTwitter += links.length;

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
      // The checkpoint advances even over a page with no handles: those
      // users are read, not pending.
      await saveCheckpoint(pageEnd);
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

    cursor = pageEnd;
    if (totals.requests % 25 === 0) {
      console.log(
        `  ${totals.requests} requests, ${totals.usersSeen.toLocaleString()} users, ` +
          `${totals.withTwitter} with a handle, cursor ${cursor}`
      );
    }
    await new Promise((r) => setTimeout(r, PAUSE_MS));
  }

  console.log(
    exhausted
      ? '\nReached the end of the users table.'
      : `\nRequest budget (${args.maxRequests}) reached; re-run to continue from the checkpoint.`
  );
  console.log('Done:', JSON.stringify(totals, null, 2));
  if (!args.commit) {
    console.log(
      '\nDry run: nothing written, no checkpoint saved. Re-run with --commit. ' +
        '(In dry-run "conflicts" counts disagreements found.)'
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
