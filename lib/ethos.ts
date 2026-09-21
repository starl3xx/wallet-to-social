/**
 * Ethos: attested wallet-to-X links, read from chain state instead of the API.
 *
 * ## Why this stopped being a REST sweep (2026-09-20)
 *
 * The identity platform's terms (§4.3) forbid republishing "any part of the
 * Services", and serving their API's data to customers is arguably exactly
 * that. The same facts are written onchain by the platform's own attest
 * mechanism: the attestation contract on Base emits the service and the
 * NUMERIC ACCOUNT ID as plain strings (probed 2026-09-20, not hashes), and
 * the profile contract binds profile ids to the wallets their owners
 * connected by signature. Chain state has no terms to accept and no provider
 * who can revoke us, which is the same footing the EAS adapter documents.
 * The evidence is unchanged, so the source id and its class are unchanged.
 *
 * What the REST era measured still stands and is why the source exists:
 * ~39k profiles covering ~84k addresses; in 200 checked disagreements our
 * handle was dead and theirs live 108 times, theirs dead and ours live zero.
 * The permanent numeric id this pipeline carries is the graph's only rot
 * detector.
 *
 * ## The shape
 *
 * The clanker sweep's shape, deliberately, because the problem is identical:
 * an onchain event names an X account by id, the handle must come from the
 * resolver, and an id the resolver has not answered for yet must HOLD THE
 * FRONTIER rather than be skipped. The two sweeps also share the denial
 * table (`clanker_unresolved_ids`): it records "the resolver denied this X
 * account id N times", which is a fact about the id, not about who asked.
 *
 * Lifecycle events matter here in a way clanker has no analog for: an
 * attestation can be Archived (leaves), Restored (returns) and Claimed
 * (moves to another profile). Within a run the LAST event per account id
 * wins; an id whose final state is archived produces no link. A row already
 * in the graph when its attestation is archived stays, exactly as the REST
 * sweep left it: fill-only ingests never unwind, and the reachability sweep
 * is the rot handler.
 */
import { getDb } from '@/db';
import { sql } from 'drizzle-orm';
import { ethers } from 'ethers';
import {
  ingestLinks,
  type AttestedLink,
  type LinkSource,
} from './attested-links';
import { resolveByIds } from './x-accounts';

const SOURCE: LinkSource = {
  id: 'ethos',
  /** twitter(20) + ethos(25) in `calculateQualityScore`. */
  quality: 45,
};

/**
 * Both addresses come from the platform's own public contracts endpoint
 * (`/api/v1/contracts?targetContracts=all`, keyless) and were verified live
 * on 2026-09-20: the attestation proxy emitted decodable events and the
 * profile proxy answered `addressesForProfile`. Reading that endpoint once
 * to find a contract is not the republishing the terms forbid; the pipeline
 * itself never touches the API.
 */
const ATTESTATION_CONTRACT = '0x27499D9A439D1c7B4538f247625cc7aA159D3c14';
const PROFILE_CONTRACT = '0x209820B843900Ef77BD639455cDE15F38A252a36';
/** The attestation proxy's creation block. */
const DEPLOY_BLOCK = 25_131_727;

const STATE_KEY = 'ethos_onchain_sweep';

const MULTICALL3 = ethers.getAddress(
  '0xca11bde05977b3631167028862be2a173976ca11'
);

// Event ABIs transcribed from the verified implementation
// (0xaf35...1386 via the EIP-1967 slot), input order exactly as published.
const eventIface = new ethers.Interface([
  'event AttestationCreated(uint256 indexed profileId, string service, string account, string evidence, uint256 indexed attestationId)',
  'event AttestationClaimed(uint256 indexed attestationId, string service, string account, string evidence, uint256 indexed profileId)',
  'event AttestationArchived(uint256 indexed profileId, string service, string account, uint256 indexed attestationId)',
  'event AttestationRestored(uint256 indexed attestationId, string service, string account, uint256 indexed profileId)',
]);
const TOPICS = [
  ethers.id('AttestationCreated(uint256,string,string,string,uint256)'),
  ethers.id('AttestationClaimed(uint256,string,string,string,uint256)'),
  ethers.id('AttestationArchived(uint256,string,string,uint256)'),
  ethers.id('AttestationRestored(uint256,string,string,uint256)'),
];

const profileIface = new ethers.Interface([
  'function profileExistsAndArchivedForId(uint256 profileId) view returns (bool exists, bool archived)',
  'function addressesForProfile(uint256 profileId) view returns (address[])',
  'function isAddressCompromised(address addr) view returns (bool)',
]);
const multicallIface = new ethers.Interface([
  'function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)',
]);

/** The service strings that mean X. The probe saw 'x.com'. */
const X_SERVICES = new Set(['x.com', 'twitter.com']);

/**
 * How many times the resolver must deny an id before the frontier passes
 * it. Same constant and same reasoning as the clanker sweep: five separate
 * answered days, because retiring early loses an owner-attested link and
 * retiring late costs a free re-scan.
 */
const DEAD_AFTER_ATTEMPTS = 5;

/** Resolver credits one run may spend, unless the env var says otherwise. */
const DEFAULT_RESOLVE_CREDITS = 900;

function getProvider(): ethers.JsonRpcProvider {
  const endpoint = process.env.ALCHEMY_KEY
    ? `https://base-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_KEY}`
    : 'https://base-rpc.publicnode.com';
  return new ethers.JsonRpcProvider(endpoint, 8453, { staticNetwork: true });
}

export interface EthosSweepStats {
  blocksScanned: number;
  events: number;
  /** Distinct X account ids whose final state in this range is active. */
  candidates: number;
  /** Ids whose handle the graph already held, costing no credits. */
  knownIds: number;
  resolvedIds: number;
  deniedIds: number;
  abandonedIds: number;
  creditsSpent: number;
  profilesArchived: number;
  compromisedDropped: number;
  links: number;
  contested: number;
  rejected: number;
  newWallets: number;
  filled: number;
  agree: number;
  conflicts: number;
  /** Where the checkpoint landed; below the scan target when ids held it. */
  checkpoint: number;
  frontierHeld: boolean;
}

async function getCheckpoint(): Promise<number | null> {
  const db = getDb();
  if (!db) throw new Error('Database not configured');
  const result = (await db.execute(
    sql`SELECT (value->>'lastBlock')::bigint AS b FROM ingest_state WHERE name = ${STATE_KEY}`
  )) as unknown as { rows: Array<{ b: string | null }> };
  const v = result.rows[0]?.b;
  return v ? Number(v) : null;
}

async function saveCheckpoint(block: number): Promise<void> {
  const db = getDb();
  if (!db) throw new Error('Database not configured');
  await db.execute(sql`
    INSERT INTO ingest_state (name, value, updated_at)
    VALUES (${STATE_KEY}, jsonb_build_object('lastBlock', ${block}::bigint), now())
    ON CONFLICT (name) DO UPDATE
    SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
  `);
}

interface AccountState {
  profileId: bigint;
  active: boolean;
  /** The earliest block this id appeared in the scanned range: the frontier
   *  holds here if the id ends the run unresolved and unabandoned. */
  firstBlock: number;
}

/** Adaptive log scan; the same self-tuning shape as the other harvests. */
async function scanEvents(
  provider: ethers.JsonRpcProvider,
  fromBlock: number,
  toBlock: number
): Promise<{ states: Map<string, AccountState>; events: number }> {
  const states = new Map<string, AccountState>();
  let events = 0;
  let window = 100_000;
  let block = fromBlock;

  while (block <= toBlock) {
    const upper = Math.min(block + window - 1, toBlock);
    let logs: Array<{ topics: string[]; data: string; blockNumber: string }>;
    try {
      logs = await provider.send('eth_getLogs', [
        {
          address: ATTESTATION_CONTRACT,
          fromBlock: '0x' + block.toString(16),
          toBlock: '0x' + upper.toString(16),
          topics: [TOPICS],
        },
      ]);
    } catch {
      if (window <= 1_000)
        throw new Error(
          `eth_getLogs failing at minimum window (block ${block})`
        );
      window = Math.max(Math.floor(window / 2), 1_000);
      continue;
    }

    for (const log of logs) {
      const parsed = eventIface.parseLog({
        topics: log.topics,
        data: log.data,
      });
      if (!parsed) continue;
      events++;
      const service = String(parsed.args.service ?? '').toLowerCase();
      if (!X_SERVICES.has(service)) continue;
      const account = String(parsed.args.account ?? '').trim();
      if (!/^\d{1,25}$/.test(account)) continue;
      const profileId = BigInt(parsed.args.profileId);
      const active = parsed.name !== 'AttestationArchived';
      const blockNumber = parseInt(log.blockNumber, 16);
      const prev = states.get(account);
      states.set(account, {
        profileId,
        active,
        firstBlock: prev ? Math.min(prev.firstBlock, blockNumber) : blockNumber,
      });
    }

    block = upper + 1;
    if (logs.length < 2_000) window = Math.min(window * 2, 400_000);
    else if (logs.length > 6_000)
      window = Math.max(Math.floor(window / 2), 1_000);
  }

  return { states, events };
}

async function multicallAdaptive(
  provider: ethers.JsonRpcProvider,
  calls: Array<{ target: string; callData: string }>,
  attempt = 0
): Promise<Array<{ success: boolean; returnData: string }>> {
  try {
    const data = multicallIface.encodeFunctionData('aggregate3', [
      calls.map((c) => ({
        target: c.target,
        allowFailure: true,
        callData: c.callData,
      })),
    ]);
    const raw = await provider.call({ to: MULTICALL3, data });
    const [results] = multicallIface.decodeFunctionResult('aggregate3', raw);
    return (results as Array<[boolean, string]>).map(
      ([success, returnData]) => ({
        success,
        returnData,
      })
    );
  } catch (error) {
    if (calls.length === 1) {
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        return multicallAdaptive(provider, calls, attempt + 1);
      }
      throw error;
    }
    const mid = Math.floor(calls.length / 2);
    const [left, right] = await Promise.all([
      multicallAdaptive(provider, calls.slice(0, mid), attempt),
      multicallAdaptive(provider, calls.slice(mid), attempt),
    ]);
    return [...left, ...right];
  }
}

/** profileId -> live wallet addresses, archived profiles dropped. */
async function walletsForProfiles(
  provider: ethers.JsonRpcProvider,
  profileIds: bigint[],
  stats: EthosSweepStats
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const BATCH = 200;
  for (let i = 0; i < profileIds.length; i += BATCH) {
    const batch = profileIds.slice(i, i + BATCH);
    const calls = batch.flatMap((id) => [
      {
        target: PROFILE_CONTRACT,
        callData: profileIface.encodeFunctionData(
          'profileExistsAndArchivedForId',
          [id]
        ),
      },
      {
        target: PROFILE_CONTRACT,
        callData: profileIface.encodeFunctionData('addressesForProfile', [id]),
      },
    ]);
    const results = await multicallAdaptive(provider, calls);
    for (let j = 0; j < batch.length; j++) {
      const existsRes = results[j * 2];
      const addrRes = results[j * 2 + 1];
      if (!existsRes.success || !addrRes.success) continue;
      try {
        const [exists, archived] = profileIface.decodeFunctionResult(
          'profileExistsAndArchivedForId',
          existsRes.returnData
        );
        if (!exists || archived) {
          if (archived) stats.profilesArchived++;
          continue;
        }
        const [addrs] = profileIface.decodeFunctionResult(
          'addressesForProfile',
          addrRes.returnData
        );
        const wallets = (addrs as string[])
          .map((a) => a.toLowerCase())
          .filter(
            (a) => /^0x[0-9a-f]{40}$/.test(a) && a !== '0x' + '0'.repeat(40)
          );
        if (wallets.length > 0) out.set(batch[j].toString(), wallets);
      } catch {
        // A profile this interface cannot decode is skipped, not guessed at.
      }
    }
  }

  // Compromised addresses are ones the profile owner themselves flagged as
  // stolen: the platform stops attributing them, and so do we.
  const allWallets = [...new Set([...out.values()].flat())];
  const compromised = new Set<string>();
  const CBATCH = 500;
  for (let i = 0; i < allWallets.length; i += CBATCH) {
    const batch = allWallets.slice(i, i + CBATCH);
    const results = await multicallAdaptive(
      provider,
      batch.map((a) => ({
        target: PROFILE_CONTRACT,
        callData: profileIface.encodeFunctionData('isAddressCompromised', [a]),
      }))
    );
    for (let j = 0; j < batch.length; j++) {
      const r = results[j];
      if (!r.success) continue;
      try {
        const [bad] = profileIface.decodeFunctionResult(
          'isAddressCompromised',
          r.returnData
        );
        if (bad) compromised.add(batch[j]);
      } catch {
        // Undecodable answer: treat as not proven compromised.
      }
    }
  }
  if (compromised.size > 0) {
    for (const [pid, wallets] of out) {
      const kept = wallets.filter((w) => !compromised.has(w));
      stats.compromisedDropped += wallets.length - kept.length;
      if (kept.length === 0) out.delete(pid);
      else out.set(pid, kept);
    }
  }
  return out;
}

/** Handles the graph already holds for these ids: free, and non-rotting. */
async function knownHandles(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const db = getDb();
  if (!db || ids.length === 0) return out;
  const BATCH = 5_000;
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const result = (await db.execute(sql`
      SELECT DISTINCT ON (twitter_user_id) twitter_user_id, twitter_handle
      FROM social_graph
      WHERE twitter_user_id = ANY(${sql.param(batch)}::text[])
        AND twitter_handle IS NOT NULL
    `)) as unknown as {
      rows: Array<{ twitter_user_id: string; twitter_handle: string }>;
    };
    for (const r of result.rows) out.set(r.twitter_user_id, r.twitter_handle);
  }
  return out;
}

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
    console.error('ethos recordDenials failed:', error);
  }
}

async function clearDenials(ids: string[]): Promise<void> {
  const db = getDb();
  if (!db || ids.length === 0) return;
  try {
    await db.execute(sql`
      DELETE FROM clanker_unresolved_ids
      WHERE identifier = ANY(${sql.param(ids)}::text[])
    `);
  } catch (error) {
    console.error('ethos clearDenials failed:', error);
  }
}

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
    console.error('ethos abandonedIds failed:', error);
  }
  return out;
}

/**
 * The sweep: scan attestation events from the checkpoint, bind account ids
 * to profile wallets, turn ids into handles (the graph first, the resolver
 * for the remainder within budget), ingest, and advance the checkpoint no
 * further than the earliest event of any id still unresolved and
 * unabandoned, so tomorrow's run re-offers it.
 */
export async function sweepEthos(
  onProgress?: (msg: string) => void
): Promise<EthosSweepStats> {
  const provider = getProvider();
  const head = await provider.getBlockNumber();
  const target = head - 20;
  const checkpoint = await getCheckpoint();
  const fromBlock = checkpoint !== null ? checkpoint + 1 : DEPLOY_BLOCK;

  const stats: EthosSweepStats = {
    blocksScanned: Math.max(0, target - fromBlock + 1),
    events: 0,
    candidates: 0,
    knownIds: 0,
    resolvedIds: 0,
    deniedIds: 0,
    abandonedIds: 0,
    creditsSpent: 0,
    profilesArchived: 0,
    compromisedDropped: 0,
    links: 0,
    contested: 0,
    rejected: 0,
    newWallets: 0,
    filled: 0,
    agree: 0,
    conflicts: 0,
    checkpoint: checkpoint ?? DEPLOY_BLOCK - 1,
    frontierHeld: false,
  };
  if (fromBlock > target) return stats;

  const { states, events } = await scanEvents(provider, fromBlock, target);
  stats.events = events;

  const activeIds = [...states.entries()].filter(([, s]) => s.active);
  stats.candidates = activeIds.length;
  onProgress?.(
    `ethos onchain: ${events} events, ${activeIds.length} active X ids in blocks ${fromBlock}-${target}`
  );

  // Handles: the graph first, then the resolver within budget.
  const ids = activeIds.map(([id]) => id);
  const handles = await knownHandles(ids);
  stats.knownIds = handles.size;

  const unknown = ids.filter((id) => !handles.has(id));
  const creditCap = Math.max(
    0,
    Number(process.env.ETHOS_RESOLVE_CREDITS ?? DEFAULT_RESOLVE_CREDITS)
  );
  if (unknown.length > 0 && creditCap > 0) {
    // 18 credits per lookup, batched inside resolveByIds.
    const affordable = unknown.slice(0, Math.floor(creditCap / 18));
    const result = await resolveByIds(affordable);
    stats.creditsSpent = result.creditsSpent;
    for (const [id, handle] of result.resolved) handles.set(id, handle);
    stats.resolvedIds = result.resolved.size;
    const denied = affordable.filter(
      (id) => result.answered.has(id) && !result.resolved.has(id)
    );
    stats.deniedIds = denied.length;
    await recordDenials(denied, 'ethos: resolver denied id');
    await clearDenials([...result.resolved.keys()]);
  }

  // The frontier: ids still without a handle that the denial ledger has not
  // retired hold the checkpoint at their earliest event.
  const stillUnknown = ids.filter((id) => !handles.has(id));
  const abandoned = await abandonedIds(stillUnknown);
  stats.abandonedIds = abandoned.size;
  let checkpointTo = target;
  for (const id of stillUnknown) {
    if (abandoned.has(id)) continue;
    const s = states.get(id);
    if (s) checkpointTo = Math.min(checkpointTo, s.firstBlock - 1);
  }
  stats.frontierHeld = checkpointTo < target;

  // Wallets for the profiles whose ids we can actually name.
  const resolvable = activeIds.filter(([id]) => handles.has(id));
  const profileIds = [...new Set(resolvable.map(([, s]) => s.profileId))];
  const wallets = await walletsForProfiles(provider, profileIds, stats);

  const links: AttestedLink[] = [];
  for (const [id, s] of resolvable) {
    const handle = handles.get(id);
    const ws = wallets.get(s.profileId.toString());
    if (!handle || !ws) continue;
    for (const wallet of ws) {
      links.push({ wallet, handle, twitterUserId: id });
    }
  }

  if (links.length > 0) {
    const ingest = await ingestLinks(links, SOURCE);
    stats.links = ingest.links;
    stats.contested = ingest.contested;
    stats.rejected = ingest.rejected;
    stats.newWallets = ingest.newWallets;
    stats.filled = ingest.filled;
    stats.agree = ingest.agree;
    stats.conflicts = ingest.conflicts;
  }

  await saveCheckpoint(checkpointTo);
  stats.checkpoint = checkpointTo;
  onProgress?.(
    `ethos onchain: ${stats.links} links (${stats.newWallets} new wallets), ` +
      `checkpoint ${checkpointTo}${stats.frontierHeld ? ' (frontier held)' : ''}`
  );
  return stats;
}
