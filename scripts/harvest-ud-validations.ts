/**
 * Ingest the X handles Unstoppable Domains verified onchain (Linear STA-13).
 *
 * UD's own validation records, 2020 to 2023, read over our RPC with no request
 * to UD: see lib/ud-validations.ts for what is read and the five ways a naive
 * read loses records. The corpus is frozen (no validation since 2023-02-18),
 * so this is a one-off, not a cron.
 *
 * The handles are three to six years old and carry no numeric X id, so none is
 * served before it is known to be live: `--check-reachability` resolves every
 * candidate handle the X index has not seen, and `--commit` ingests only the
 * links whose handle is live now. Ingest is fill-only through
 * lib/attested-links.ts: a wallet that already shows another handle keeps it,
 * and the disagreement goes to `handle_conflicts`.
 *
 * A handle UD verified for more than one owner is left out entirely: the
 * source cannot say which owner is right, and a contested link is not
 * attested evidence. A wallet with two verified handles is dropped by
 * `dedupeByWallet` for the same reason.
 *
 * Usage (dry run by default; prints what each step would do):
 *   npx tsx --env-file=.env.local scripts/harvest-ud-validations.ts
 *   ... --check-reachability [--credit-cap 2000]
 *   ... --commit
 */
import { sql } from 'drizzle-orm';
import { getDb } from '../db';
import {
  classifyLinks,
  dedupeByWallet,
  ingestLinks,
  type AttestedLink,
  type LinkSource,
} from '../lib/attested-links';
import { cleanTwitterHandle } from '../lib/twitter-cleaner';
import {
  discoverTokens,
  readCurrent,
  isUdValidated,
} from '../lib/ud-validations';
import { sweepHandles, CREDITS_PER_LOOKUP } from '../lib/x-accounts';
import { isConfigured, resolverKey } from '../lib/x-resolver';

const SOURCE: LinkSource = {
  id: 'ud_twitter_validation',
  /** twitter(20) + ud_twitter_validation(25) in `calculateQualityScore`. */
  quality: 45,
};

const flag = (name: string) => process.argv.includes(`--${name}`);
function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : Number(process.argv[i + 1]);
}

async function statuses(handles: string[]): Promise<Map<string, string>> {
  const db = getDb();
  const out = new Map<string, string>();
  if (!db || handles.length === 0) return out;
  for (let i = 0; i < handles.length; i += 1000) {
    const batch = handles.slice(i, i + 1000);
    const r = (await db.execute(sql`
      SELECT handle, status FROM x_accounts
      WHERE handle = ANY(${sql.param(batch)}::text[])
    `)) as unknown as { rows: Array<{ handle: string; status: string }> };
    for (const row of r.rows) out.set(row.handle, row.status);
  }
  return out;
}

async function main() {
  const commit = flag('commit');
  const checkReach = flag('check-reachability');

  console.log('discovering tokens that ever carried an X validation record...');
  const tokens = [...(await discoverTokens())];
  console.log(`  tokens: ${tokens.length}`);

  const records = await readCurrent(tokens);
  const withBoth = records.filter((r) => r.handle && r.signature);
  const valid = withBoth.filter((r) =>
    isUdValidated({
      tokenIdDecimal: r.tokenId,
      owner: r.owner,
      handle: r.handle,
      signature: r.signature,
    })
  );
  console.log(
    `  current records: ${records.length}; with handle and signature: ${withBoth.length}; ` +
      `signed by UD for the current owner: ${valid.length} ` +
      `(Polygon ${valid.filter((r) => r.chain === 137).length}, Ethereum ${valid.filter((r) => r.chain === 1).length})`
  );

  // One link per (owner, handle); the same pair on several domains is one link.
  const pairs = new Map<string, AttestedLink>();
  let rejected = 0;
  for (const r of valid) {
    const handle = cleanTwitterHandle(r.handle);
    if (!handle) {
      rejected++;
      continue;
    }
    const wallet = r.owner.toLowerCase();
    pairs.set(`${wallet} ${handle}`, { wallet, handle });
  }
  const owners = new Map<string, Set<string>>();
  for (const l of pairs.values()) {
    const set = owners.get(l.handle) ?? new Set<string>();
    set.add(l.wallet);
    owners.set(l.handle, set);
  }
  const contestedHandles = new Set(
    [...owners].filter(([, w]) => w.size > 1).map(([h]) => h)
  );
  const uncontested = [...pairs.values()].filter(
    (l) => !contestedHandles.has(l.handle)
  );
  const { links, contested: contestedWallets } = dedupeByWallet(uncontested);
  console.log(
    `  links: ${pairs.size} (${rejected} unusable handles); handles verified for several owners, left out: ` +
      `${contestedHandles.size}; wallets with several handles, left out: ${contestedWallets}; candidates: ${links.length}`
  );

  const before = await classifyLinks(links);
  console.log(
    `  against the graph now: new wallets ${before.newWallets}, fills ${before.wouldFill}, ` +
      `agree ${before.agree}, disagree ${before.disagree}`
  );

  const handles = [...new Set(links.map((l) => l.handle))];
  let status = await statuses(handles);
  const unchecked = handles.filter((h) => !status.has(h));
  console.log(
    `  handles: ${handles.length}; already checked: ${handles.length - unchecked.length}; never checked: ${unchecked.length}`
  );

  if (checkReach && unchecked.length > 0) {
    if (!isConfigured()) {
      throw new Error(
        'X_RESOLVER_API_BASE and X_RESOLVER_API_KEY are required'
      );
    }
    const creditCap = arg('credit-cap', unchecked.length * CREDITS_PER_LOOKUP);
    console.log(
      `  checking ${unchecked.length} handles, credit cap ${creditCap}...`
    );
    const p = await sweepHandles(unchecked, resolverKey()!, { creditCap });
    console.log(
      `  checked ${p.checked}: live ${p.live}, not found ${p.notFound}, unavailable ${p.unavailable}, failed ${p.failed}`
    );
    status = await statuses(handles);
  }

  const by: Record<string, number> = {};
  for (const h of handles) {
    const s = status.get(h) ?? 'unchecked';
    by[s] = (by[s] ?? 0) + 1;
  }
  console.log(`  handle status: ${JSON.stringify(by)}`);

  const live = links.filter((l) => status.get(l.handle) === 'live');
  const liveClass = await classifyLinks(live);
  console.log(
    `  live links: ${live.length} (new wallets ${liveClass.newWallets}, fills ${liveClass.wouldFill}, ` +
      `agree ${liveClass.agree}, disagree ${liveClass.disagree})`
  );

  if (!commit) {
    console.log(
      '\ndry run: nothing written. Pass --commit to ingest the live links.'
    );
    return;
  }
  if (by.unchecked) {
    // Only live links are ingested, so an unchecked handle is left out rather
    // than served unchecked; a later run picks it up once it has been checked.
    console.log(
      `  ${by.unchecked} unchecked handles are left out of this ingest`
    );
  }
  const stats = await ingestLinks(live, SOURCE);
  console.log(`\ningested: ${JSON.stringify(stats)}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
