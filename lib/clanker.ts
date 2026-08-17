/**
 * Wallet-to-X links from Clanker token deploys on Base.
 *
 * Somebody tells @clanker on X to launch a token. Clanker deploys it and writes
 * the requesting social identity into the deploy event, alongside the wallet
 * that receives it. Both halves of the link are established by the act itself:
 * the X account had to post, and the wallet had to be the one named.
 *
 * ## Small, but the only new source carrying an account id
 *
 * Measured over 60,000 Base blocks (~33 hours) on 2026-08-16: 197 deploys, 91
 * naming a platform, of which 33 were X. About **24 a day**, so a few thousand
 * all-time at most. That is a trickle next to Ethos's 83,891.
 *
 * It earns its place on quality rather than volume. Two thirds of the X deploys
 * carry the **numeric account id**, and an id cannot rot the way a handle can.
 * Nothing else we found outside Ethos provides one, and this is a flow rather
 * than a stock: it keeps producing.
 *
 * ## The field is not one shape
 *
 * `platform` and `id` are written by whichever interface submitted the deploy,
 * and they disagree with each other:
 *
 *     {"platform":"twitter","id":"1990148642242740224"}   numeric account id
 *     {"platform":"x",      "id":"Imma_goodboi"}          handle
 *
 * Observed values for platform include twitter, x, X, farcaster, Clanker,
 * rapidlaunch.io and 4claw. Branching on that label would break the first time
 * a new interface picked a new spelling, so the shape of `id` decides instead:
 * all digits and long enough is an account id, anything else is a handle.
 */
import { ingestLinks, type AttestedLink, type LinkSource } from './attested-links';
import { getDb } from '@/db';
import { sql } from 'drizzle-orm';

const SOURCE: LinkSource = {
  id: 'clanker',
  /** twitter(20) + clanker(25) in `calculateQualityScore`. */
  quality: 45,
};

/** Clanker v4 factory on Base, and its token-deploy event. */
const CONTRACT = '0xe85a59c628f7d27878aceb4bf3b35733630083a9';
const TOPIC =
  '0x9299d1d1a88d8e1abdc591ae7a167a6bc63a8f17d695804e9091ee33aa89fb67';

/** Alchemy caps a log range; 3,000 blocks is comfortably inside it. */
const STEP = 3000;
const STATE_KEY = 'clanker_scan';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ClankerSweepStats {
  fromBlock: number;
  toBlock: number;
  deploys: number;
  xDeploys: number;
  withAccountId: number;
  links: number;
  contested: number;
  rejected: number;
  newWallets: number;
  filled: number;
  agree: number;
  conflicts: number;
}

interface RawDeploy {
  wallet: string;
  /** Either a numeric account id or a handle. Resolved later. */
  identifier: string;
}

function rpcUrl(): string {
  const key = process.env.ALCHEMY_KEY;
  return key ? `https://base-mainnet.g.alchemy.com/v2/${key}` : 'https://mainnet.base.org';
}

async function rpc(method: string, params: unknown[]): Promise<unknown> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(rpcUrl(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      if (!res.ok) {
        await sleep(500 * (attempt + 1));
        continue;
      }
      const body = (await res.json()) as { result?: unknown; error?: unknown };
      if (body.error) return null;
      return body.result ?? null;
    } catch {
      await sleep(500 * (attempt + 1));
    }
  }
  return null;
}

/** X allows letters, digits and underscore, up to 15. */
const isHandle = (s: string) => /^[A-Za-z0-9_]{1,15}$/.test(s);
/** Account ids are long integers. Five digits is far below any real one. */
const isAccountId = (s: string) => /^\d{5,}$/.test(s);

/**
 * Pull the social identity out of a deploy log.
 *
 * `topics[1]` is the token and `topics[2]` is the wallet the deploy was made
 * for. The JSON is embedded in the ABI-encoded data as a plain string, so it is
 * matched rather than decoded: the surrounding tuple has moved between Clanker
 * versions and the JSON has not.
 */
function parseDeploy(log: { topics?: string[]; data?: string }): RawDeploy | null {
  const walletTopic = log.topics?.[2];
  if (!walletTopic || walletTopic.length !== 66) return null;
  const wallet = ('0x' + walletTopic.slice(26)).toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(wallet)) return null;

  let text: string;
  try {
    text = Buffer.from((log.data ?? '').slice(2), 'hex').toString('utf8');
  } catch {
    return null;
  }

  const m = text.match(/"platform":"([^"]*)","messageId":"[^"]*","id":"([^"]*)"/);
  if (!m) return null;
  const [, platform, identifier] = m;
  if (!identifier) return null;

  // Farcaster deploys use the same event and are already covered completely by
  // the Farcaster sweep, so they are dropped rather than ingested twice.
  if (/farcaster/i.test(platform)) return null;

  return { wallet, identifier };
}

/**
 * Turn account ids into handles.
 *
 * Two thirds of these arrive as a numeric id and `social_graph.twitter_handle`
 * needs a handle, so they have to be resolved. Batched by id at 10 credits each
 * rather than looked up by name at 18, and at roughly 24 deploys a day the whole
 * thing costs a rounding error.
 *
 * A failure here drops the link rather than guessing. An unresolvable id means
 * we do not know the handle, and inventing one is the failure mode this whole
 * pipeline exists to avoid.
 */
async function resolveAccountIds(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const key = process.env.TWITTERAPI_IO_KEY;
  if (!key || ids.length === 0) return out;

  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    try {
      const res = await fetch(
        `https://api.twitterapi.io/twitter/user/batch_info_by_ids?userIds=${chunk.join(',')}`,
        { headers: { 'x-api-key': key } }
      );
      if (!res.ok) continue;
      const body = (await res.json()) as {
        users?: Array<{ id?: string; userName?: string }>;
      };
      for (const u of body.users ?? []) {
        if (u.id && u.userName && isHandle(u.userName)) out.set(u.id, u.userName);
      }
    } catch {
      // Leave them unresolved; the next run tries again.
    }
    await sleep(200);
  }
  return out;
}

/** Where the last scan stopped, or null. */
export async function getScanCheckpoint(): Promise<number | null> {
  const db = getDb();
  if (!db) return null;
  const result = (await db.execute(sql`
    SELECT (value->>'lastBlock')::bigint AS last_block
    FROM ingest_state WHERE name = ${STATE_KEY}
  `)) as unknown as { rows: Array<{ last_block: string | null }> };
  const v = result.rows[0]?.last_block;
  return v ? Number(v) : null;
}

async function setScanCheckpoint(block: number): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db.execute(sql`
    INSERT INTO ingest_state (name, value, updated_at)
    VALUES (${STATE_KEY}, jsonb_build_object('lastBlock', ${block}::bigint), now())
    ON CONFLICT (name) DO UPDATE SET
      value = jsonb_build_object('lastBlock', ${block}::bigint), updated_at = now()
  `);
}

/**
 * Scan for deploys and ingest what they name.
 *
 * The checkpoint advances only after a window's links are ingested, so an
 * interrupted run repeats a window rather than skipping one. Repeating is free:
 * the ingest is idempotent.
 */
export async function sweepClanker(
  opts: { lookbackBlocks?: number; onProgress?: (msg: string) => void } = {}
): Promise<ClankerSweepStats> {
  const headHex = (await rpc('eth_blockNumber', [])) as string | null;
  if (!headHex) throw new Error('Clanker sweep: could not read the Base head block');
  const head = parseInt(headHex, 16);

  const checkpoint = await getScanCheckpoint();
  // Base produces about 43,200 blocks a day, so the default is roughly a month.
  const lookback = opts.lookbackBlocks ?? 1_300_000;
  const from = checkpoint !== null ? checkpoint + 1 : Math.max(0, head - lookback);

  const stats: ClankerSweepStats = {
    fromBlock: from,
    toBlock: head,
    deploys: 0,
    xDeploys: 0,
    withAccountId: 0,
    links: 0,
    contested: 0,
    rejected: 0,
    newWallets: 0,
    filled: 0,
    agree: 0,
    conflicts: 0,
  };
  if (from > head) return stats;

  const raw: RawDeploy[] = [];
  for (let start = from; start <= head; start += STEP) {
    const end = Math.min(start + STEP - 1, head);
    const logs = (await rpc('eth_getLogs', [
      {
        address: CONTRACT,
        topics: [TOPIC],
        fromBlock: '0x' + start.toString(16),
        toBlock: '0x' + end.toString(16),
      },
    ])) as Array<{ topics?: string[]; data?: string }> | null;

    if (logs === null) {
      // A window we could not read is a gap. Stop and checkpoint before it, so
      // the next run picks it up rather than stepping over it.
      opts.onProgress?.(`Clanker: could not read ${start}-${end}, stopping short`);
      stats.toBlock = start - 1;
      break;
    }

    stats.deploys += logs.length;
    for (const log of logs) {
      const parsed = parseDeploy(log);
      if (parsed) raw.push(parsed);
    }
    if ((start - from) % (STEP * 50) === 0) {
      opts.onProgress?.(
        `Clanker: ${start}/${head}, ${stats.deploys} deploys, ${raw.length} social`
      );
    }
  }

  stats.xDeploys = raw.length;

  const ids = [...new Set(raw.filter((r) => isAccountId(r.identifier)).map((r) => r.identifier))];
  stats.withAccountId = ids.length;
  const resolved = await resolveAccountIds(ids);

  const links: AttestedLink[] = [];
  for (const r of raw) {
    if (isAccountId(r.identifier)) {
      const handle = resolved.get(r.identifier);
      if (!handle) continue; // unresolved: never guessed
      links.push({ wallet: r.wallet, handle, twitterUserId: r.identifier });
    } else if (isHandle(r.identifier)) {
      links.push({ wallet: r.wallet, handle: r.identifier, twitterUserId: null });
    }
  }

  const ingested = await ingestLinks(links, SOURCE);
  stats.links = ingested.links;
  stats.contested = ingested.contested;
  stats.rejected = ingested.rejected;
  stats.newWallets = ingested.newWallets;
  stats.filled = ingested.filled;
  stats.agree = ingested.agree;
  stats.conflicts = ingested.conflicts;

  await setScanCheckpoint(stats.toBlock);
  opts.onProgress?.(
    `Clanker: ${stats.links} links from ${stats.xDeploys} social deploys, ` +
      `${stats.newWallets} new, ${stats.conflicts} conflicts`
  );
  return stats;
}
