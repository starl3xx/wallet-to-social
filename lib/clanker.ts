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
import {
  ingestLinks,
  type AttestedLink,
  type LinkSource,
} from './attested-links';
import { isConfigured, resolverHeaders, resolverUrl } from './x-resolver';
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

/**
 * The most blocks one run will scan, regardless of how far behind it is.
 *
 * This is what bounds the work, and it replaced a floor that bounded the
 * CHECKPOINT instead. That floor was `head - a week` and it conflated two
 * different things: "this deploy has been retried for a week" and "this block
 * is far from the tip". On a cold start the lookback is about a month, so a
 * single unresolved deploy early in the range put the frontier a month back,
 * below the floor, and the floor then jumped the checkpoint forward over three
 * weeks of history that had never been scanned at all.
 *
 * Bounding the run instead has none of that ambiguity. A stuck frontier means
 * the same window is rescanned each day, and it is reported as a failed run so
 * a person sees it rather than losing links quietly.
 *
 * It bounds the work, not the stall: `from` is `checkpoint + 1`, so a frontier
 * that never advances keeps scanning one fixed window and goes blind to new
 * blocks once the tip passes it. `DEAD_AFTER_ATTEMPTS` is what ends a stall.
 *
 * About a week of Base blocks, at roughly 43,200 a day. The size is a
 * compromise between two costs, both measured against STEP (3,000 blocks per
 * eth_getLogs call) and the route's 300s ceiling:
 *
 * - Too small and a cold start crawls. The default lookback is 1,300,000
 *   blocks, so at two days a run it would take 15 runs, which is 15 days, to
 *   reach the tip.
 * - Too large and a stuck frontier rescans more every day for nothing.
 *
 * A week is 101 log requests, comfortably inside the ceiling (the uncapped
 * version scanned the full month, 433 requests, and completed), and it brings a
 * cold start to about five runs.
 */
const MAX_RUN_BLOCKS = 43_200 * 7;

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
  /**
   * True when the scan checkpoint was deliberately not advanced, because at
   * least one deploy carried an account id the resolver could not answer for.
   * The same range is rescanned next run rather than those links being lost.
   */
  checkpointHeld: boolean;
  /** Deploys dropped this run because their account id did not resolve. */
  unresolvedAccountIds: number;
  /**
   * The subset of those the frontier was allowed to pass, because the resolver
   * has now denied the id on `DEAD_AFTER_ATTEMPTS` separate runs.
   *
   * A non-zero value is the only moment a link is knowingly given up, so it is
   * reported rather than inferred from the checkpoint moving.
   */
  abandonedAccountIds: number;
  /**
   * How far the checkpoint sits behind the chain tip after this run. Normal
   * while catching up; a figure that grows every day means the frontier is
   * stuck behind a deploy that will never resolve.
   */
  blocksBehindHead: number;
}

interface RawDeploy {
  /**
   * The block this deploy was logged in.
   *
   * Needed because the checkpoint is a high-water mark of blocks FULLY
   * processed, and a deploy whose account id did not resolve is not processed.
   * Without the block number there is no way to say where completed work ends.
   */
  block: number;
  wallet: string;
  /** Either a numeric account id or a handle. Resolved later. */
  identifier: string;
}

function rpcUrl(): string {
  const key = process.env.ALCHEMY_KEY;
  return key
    ? `https://base-mainnet.g.alchemy.com/v2/${key}`
    : 'https://mainnet.base.org';
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
function parseDeploy(log: {
  topics?: string[];
  data?: string;
  blockNumber?: string;
}): RawDeploy | null {
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

  const m = text.match(
    /"platform":"([^"]*)","messageId":"[^"]*","id":"([^"]*)"/
  );
  if (!m) return null;
  const [, platform, identifier] = m;
  if (!identifier) return null;

  // Farcaster deploys use the same event and are already covered completely by
  // the Farcaster sweep, so they are dropped rather than ingested twice.
  if (/farcaster/i.test(platform)) return null;

  const block = Number.parseInt(log.blockNumber ?? '', 16);
  // A log with no readable block cannot contribute to the high-water mark, and
  // guessing one would either lose work or replay it forever.
  if (!Number.isFinite(block)) return null;

  return { block, wallet, identifier };
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
interface ResolveResult {
  /** Account id to handle, for the ids the resolver knew. */
  resolved: Map<string, string>;
  /**
   * The ids the resolver actually answered about, whether or not it knew them.
   *
   * This is the load-bearing half. "The resolver told us it has no such user"
   * and "we could not reach the resolver" both leave an id unresolved, and only
   * the first is evidence about the id. Counting the second as evidence would
   * let one outage retire ids that are perfectly fine, which is the mistake
   * `x_handle_attempts` was created to stop in the handle sweep.
   *
   * Note that "reached the resolver" is not the same as a 200. See the status
   * check below: this provider answers its own failures with HTTP 200.
   */
  answered: Set<string>;
}

async function resolveAccountIds(ids: string[]): Promise<ResolveResult> {
  const resolved = new Map<string, string>();
  const answered = new Set<string>();
  if (!isConfigured() || ids.length === 0) return { resolved, answered };

  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    try {
      const res = await fetch(
        resolverUrl(
          `/twitter/user/batch_info_by_ids?userIds=${chunk.join(',')}`
        ),
        { headers: resolverHeaders() }
      );
      if (!res.ok) continue;
      const body = (await res.json()) as {
        status?: string;
        msg?: string;
        users?: Array<{ id?: string; userName?: string }>;
      };

      /**
       * `res.ok` is not the test. This resolver reports its own failures as
       * HTTP 200 with `status: "error"` and a message: out of credits, rate
       * limited, upstream trouble. `resolve()` in `lib/x-accounts.ts` already
       * knows this and treats anything that is not `success` as no answer.
       *
       * Reading those bodies as answers is the exact bug this file is meant to
       * be immune to: five error responses in a row would retire live account
       * ids and walk the frontier past deploys that were never denied. An
       * outage must not be able to manufacture evidence.
       *
       * A missing `users` array is an unrecognised shape rather than an empty
       * result, and the shape is not ours to rely on, so it is not an answer
       * either. Both fall through to the next run, which is the safe direction:
       * the frontier holds.
       */
      if (body.status !== 'success' || !Array.isArray(body.users)) continue;

      // Only now is the chunk evidence. An id absent from `users` in a
      // successful response is one the resolver denies knowing.
      for (const id of chunk) answered.add(id);
      for (const u of body.users) {
        if (u.id && u.userName && isHandle(u.userName))
          resolved.set(u.id, u.userName);
      }
    } catch {
      // Leave them unresolved and unanswered; the next run tries again.
    }
    await sleep(200);
  }
  return { resolved, answered };
}

/**
 * How many times the resolver must deny an id before the frontier passes it.
 *
 * The sweep runs once a day, and only a run that reached the resolver counts,
 * so this is five separate days of the same answer. It is deliberately more
 * patience than any outage we have had: the 2026-08-18 incident lasted one
 * morning, and under `answered` it would have recorded no attempts at all.
 *
 * The cost of being wrong is asymmetric and that sets the direction. Retiring
 * an id too early loses one owner-attested link. Retiring it too late costs a
 * repeated block range, which is free. Five is on the patient side on purpose.
 */
const DEAD_AFTER_ATTEMPTS = 5;

/**
 * Note that the resolver denied these ids.
 *
 * Deliberately does not touch `social_graph`. A denied id is not a link, and
 * this table records only that we asked and were told no.
 */
async function recordDenials(ids: string[], reason: string): Promise<void> {
  const db = getDb();
  if (!db || ids.length === 0) return;
  try {
    await db.execute(sql`
      INSERT INTO clanker_unresolved_ids (identifier, attempts, last_attempt_at, last_reason)
      SELECT i, 1, now(), ${reason}
      FROM unnest(${sql.param(ids)}::text[]) AS i
      ON CONFLICT (identifier) DO UPDATE SET
        attempts        = clanker_unresolved_ids.attempts + 1,
        last_attempt_at = now(),
        last_reason     = EXCLUDED.last_reason
    `);
  } catch (error) {
    // Accounting must never break the work it measures. Failing to write here
    // leaves the frontier held, which is the safe direction.
    console.error('clanker recordDenials failed:', error);
  }
}

/** An id that resolved has nothing outstanding against it. */
async function clearDenials(ids: string[]): Promise<void> {
  const db = getDb();
  if (!db || ids.length === 0) return;
  try {
    await db.execute(sql`
      DELETE FROM clanker_unresolved_ids
      WHERE identifier = ANY(${sql.param(ids)}::text[])
    `);
  } catch (error) {
    console.error('clanker clearDenials failed:', error);
  }
}

/**
 * The ids denied often enough that they no longer hold the frontier.
 *
 * Read after this run's denial is recorded, so the threshold counts answers
 * rather than answers-plus-one.
 */
async function abandonedIds(ids: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  const db = getDb();
  if (!db || ids.length === 0) return out;
  try {
    const result = (await db.execute(sql`
      SELECT identifier FROM clanker_unresolved_ids
      WHERE identifier = ANY(${sql.param(ids)}::text[])
        AND attempts >= ${DEAD_AFTER_ATTEMPTS}
    `)) as unknown as { rows: Array<{ identifier: string }> };
    for (const r of result.rows) out.add(r.identifier);
  } catch (error) {
    // On a read failure nothing is abandoned, so the frontier holds. Safe.
    console.error('clanker abandonedIds failed:', error);
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
  if (!headHex)
    throw new Error('Clanker sweep: could not read the Base head block');
  const head = parseInt(headHex, 16);

  const checkpoint = await getScanCheckpoint();
  // Base produces about 43,200 blocks a day, so the default is roughly a month.
  const lookback = opts.lookbackBlocks ?? 1_300_000;
  const from =
    checkpoint !== null ? checkpoint + 1 : Math.max(0, head - lookback);
  /**
   * Scan at most MAX_RUN_BLOCKS in one run.
   *
   * Without this a frontier held back by an unresolvable deploy grows the range
   * every day until it exceeds the route's maxDuration and the sweep stops
   * ingesting entirely. Capping the run means a stuck frontier costs a repeated
   * window, not a dead job, and the next run simply continues from wherever
   * this one finished.
   */
  const scanTo = Math.min(head, from + MAX_RUN_BLOCKS - 1);

  const stats: ClankerSweepStats = {
    fromBlock: from,
    toBlock: scanTo,
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
    checkpointHeld: false,
    unresolvedAccountIds: 0,
    abandonedAccountIds: 0,
    blocksBehindHead: 0,
  };
  if (from > scanTo) return stats;

  const raw: RawDeploy[] = [];
  for (let start = from; start <= scanTo; start += STEP) {
    const end = Math.min(start + STEP - 1, scanTo);
    const logs = (await rpc('eth_getLogs', [
      {
        address: CONTRACT,
        topics: [TOPIC],
        fromBlock: '0x' + start.toString(16),
        toBlock: '0x' + end.toString(16),
      },
    ])) as Array<{
      topics?: string[];
      data?: string;
      blockNumber?: string;
    }> | null;

    if (logs === null) {
      // A window we could not read is a gap. Stop and checkpoint before it, so
      // the next run picks it up rather than stepping over it.
      opts.onProgress?.(
        `Clanker: could not read ${start}-${end}, stopping short`
      );
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
        `Clanker: ${start}/${scanTo}, ${stats.deploys} deploys, ${raw.length} social`
      );
    }
  }

  stats.xDeploys = raw.length;

  const ids = [
    ...new Set(
      raw.filter((r) => isAccountId(r.identifier)).map((r) => r.identifier)
    ),
  ];
  stats.withAccountId = ids.length;
  const { resolved, answered } = await resolveAccountIds(ids);

  /**
   * Record what the resolver said, then ask which ids have run out of patience.
   *
   * An id is denied when the resolver answered and did not know it. That is the
   * only condition that counts, so a resolver outage adds nothing here and the
   * frontier simply holds, exactly as it did before this existed.
   *
   * The denial is written BEFORE `abandonedIds` reads, so the threshold means
   * "denied on this many runs including this one" rather than one more.
   */
  const denied = ids.filter((id) => answered.has(id) && !resolved.has(id));
  await recordDenials(denied, 'resolver returned no such user');
  await clearDenials([...resolved.keys()]);
  const abandoned = await abandonedIds(denied);

  const links: AttestedLink[] = [];
  /**
   * Deploys we could not resolve, and therefore must not walk past.
   *
   * `continue` below is correct: an unresolved account id is never guessed. But
   * dropping the link and then advancing the checkpoint anyway makes the drop
   * PERMANENT, because the block range is never scanned again.
   *
   * This is not hypothetical. On 2026-08-18 the resolver's env vars had been
   * renamed and not yet set in production, so `resolveAccountIds` returned an
   * empty map, all 9 of that run's id-carrying deploys were dropped, and the
   * checkpoint still advanced to block 50122934. Nine owner-attested wallet to
   * X links, gone, from a provider outage that lasted one morning.
   */
  let unresolved = 0;
  let unresolvedFrom: number | null = null;

  for (const r of raw) {
    if (isAccountId(r.identifier)) {
      const handle = resolved.get(r.identifier);
      if (!handle) {
        unresolved++;
        if (abandoned.has(r.identifier)) {
          /**
           * Given up on, so it does not owe work any more.
           *
           * The link is lost, which is the cost this whole mechanism exists to
           * avoid, and it is paid only against `DEAD_AFTER_ATTEMPTS` separate
           * answers from a reachable resolver. The alternative is worse: an id
           * that can never resolve pins `from` to its own block forever, and
           * once the run cap passes the tip the sweep ingests nothing new at
           * all while still reporting a run every day.
           */
          stats.abandonedAccountIds++;
          console.warn(
            `Clanker: abandoning account id at block ${r.block} after ` +
              `${DEAD_AFTER_ATTEMPTS} denials; the frontier may pass it.`
          );
          continue;
        }
        // The earliest block still owing work. Everything before it is done.
        unresolvedFrom =
          unresolvedFrom === null ? r.block : Math.min(unresolvedFrom, r.block);
        continue; // unresolved: never guessed
      }
      links.push({ wallet: r.wallet, handle, twitterUserId: r.identifier });
    } else if (isHandle(r.identifier)) {
      links.push({
        wallet: r.wallet,
        handle: r.identifier,
        twitterUserId: null,
      });
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

  /**
   * Advance only over blocks we actually finished.
   *
   * Holding the checkpoint costs one rescan of the same range next run, which
   * is idempotent (the ingest upserts) and cheap: this sweep reads about 24
   * X-linked deploys a day. Advancing over an unresolved deploy costs the link
   * forever. Those are not close.
   *
   * The range cannot grow without bound, because `sweepClanker` already clamps
   * its own lookback, so a long resolver outage means repeated work rather than
   * an ever-growing scan.
   */
  stats.unresolvedAccountIds = unresolved;

  /**
   * The checkpoint is a high-water mark of blocks FULLY processed, which is the
   * same shape this function already uses for a log window it could not read
   * (`stats.toBlock = start - 1` above). It is not "advance" or "hold".
   *
   * The first attempt at this bug did hold, skipping setScanCheckpoint
   * entirely, and that was worse than the bug. Two ways:
   *
   * 1. With no checkpoint row yet, `from` is recomputed as `head - lookback`
   *    every run, so the window SLIDES. Holding loses exactly the trailing
   *    deploys it was trying to protect, which is also what would happen to
   *    anyone clearing `clanker_scan` to recover the links already lost.
   * 2. With a checkpoint present, lookback does not apply at all, so `from`
   *    froze while `head` advanced. One permanently unresolvable id (a deleted
   *    account, or a resolver that answers without an id) would grow the daily
   *    range without bound until it exceeded the route's maxDuration and the
   *    sweep stopped ingesting anything new, forever.
   *
   * Both were asserted away in that commit message with "the lookback is
   * already clamped", which is true only in the branch that does not apply.
   * A checkpoint is now ALWAYS written, and it never moves backwards.
   */
  const completedThrough =
    unresolvedFrom === null
      ? stats.toBlock
      : Math.min(stats.toBlock, unresolvedFrom - 1);

  /**
   * No floor. Abandonment is counted in answers, never in blocks.
   *
   * A floor of `head - a week` was tried and removed. It read "far from the
   * chain tip" as "retried for a week", and those differ most exactly when it
   * matters: on a cold start the lookback is about a month, so one unresolved
   * deploy early in that range put the frontier below the floor immediately and
   * the floor jumped the checkpoint over three weeks of history that had never
   * been scanned. It could also mask itself, because a run shortened by an
   * unreadable log window could leave the jumped checkpoint above
   * `stats.toBlock`, so `checkpointHeld` read false and the skip reported as a
   * healthy run.
   *
   * `DEAD_AFTER_ATTEMPTS` replaces it, and the difference is what gets counted.
   * A block distance measures how long we have been stuck, which says nothing
   * about the deploy that stuck us. A denial count measures how many times a
   * reachable resolver has told us this specific id does not exist. Only the
   * second is evidence, and it cannot be manufactured by an outage, a cold
   * start, or a slow day.
   *
   * ## Why a permanent hold was not survivable
   *
   * MAX_RUN_BLOCKS bounds the run, and the comment on it said a capped run
   * "simply continues from wherever this one finished". That holds only while
   * the checkpoint moves. `from` is `checkpoint + 1`, so a frontier pinned by an
   * id that can never resolve leaves the run scanning one fixed window; when the
   * tip passes `from + MAX_RUN_BLOCKS`, the sweep stops seeing new blocks
   * entirely and still reports a run every day.
   *
   * That was not hypothetical either. On 2026-08-19 a deploy wrote the tweet's
   * status id into the account id field, so the value was 19 digits, passed
   * `isAccountId`, and named a user that has never existed. It would have ended
   * Clanker ingestion around 2026-08-25.
   */
  let nextCheckpoint = completedThrough;

  // Never move the checkpoint backwards: a short run must not replay a range a
  // longer one already finished.
  if (checkpoint !== null)
    nextCheckpoint = Math.max(nextCheckpoint, checkpoint);

  stats.checkpointHeld = nextCheckpoint < stats.toBlock;
  stats.blocksBehindHead = Math.max(0, head - nextCheckpoint);
  if (stats.checkpointHeld) {
    console.warn(
      `Clanker: ${unresolved} deploy(s) unresolved; checkpoint set to ` +
        `${nextCheckpoint} rather than ${stats.toBlock}, so that range is rescanned.`
    );
  }
  await setScanCheckpoint(nextCheckpoint);
  opts.onProgress?.(
    `Clanker: ${stats.links} links from ${stats.xDeploys} social deploys, ` +
      `${stats.newWallets} new, ${stats.conflicts} conflicts`
  );
  return stats;
}
