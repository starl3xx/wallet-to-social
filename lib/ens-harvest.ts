/**
 * ENS text-record harvest: onchain com.twitter / com.github records →
 * social_graph.
 *
 * ENS text records are the highest-quality wallet→Twitter edge that exists —
 * the wallet owner set the handle themselves, onchain. The full universe is
 * small (~49k names ever set com.twitter; ~17k currently hold a value) but
 * every edge is user-attested.
 *
 * Pipeline, entirely onchain via our own RPC — no subgraph, no third-party
 * indexer:
 *  1. eth_getLogs for both TextChanged signatures (3-arg pre-2023 resolvers,
 *     4-arg 2023+), topic2 filtered to the com.twitter / com.github key
 *     hashes, any resolver address. Adaptive block windowing.
 *  2. For each distinct node: registry.resolver(node), then
 *     resolver.text(node, key) + resolver.addr(node) via Multicall3 —
 *     text()/addr() work on node hashes directly, so we never need to know
 *     the human-readable name.
 *  3. Upsert wallet→handle into social_graph (source 'ens_onchain',
 *     fill-only: never overwrites an existing handle).
 *
 * A checkpoint in ingest_state makes the daily incremental cron a few
 * getLogs calls; the backfill from block 7,000,000 is a few minutes.
 */

import { ethers } from 'ethers';
import { getDb, socialGraph } from '@/db';
import { sql } from 'drizzle-orm';
import { cleanTwitterHandle } from './twitter-cleaner';

// First TextChanged events with these keys appear ~2019; earlier blocks are empty
export const ENS_SCAN_START_BLOCK = 7_000_000;

// The registry address comes from ethers' own network config rather than a
// hand-typed constant — a wrong address here fails silently (resolver() on a
// contract-less address returns 0x and every node just gets skipped)
const ENS_REGISTRY = ethers.Network.from('mainnet').getPlugin<ethers.EnsPlugin>(
  'org.ethers.plugins.network.Ens'
)!.address;
const MULTICALL3 = ethers.getAddress('0xca11bde05977b3631167028862be2a173976ca11');

// Event signatures — computed, not hardcoded, so they're self-verifying
const TEXT_CHANGED_3 = ethers.id('TextChanged(bytes32,string,string)');
const TEXT_CHANGED_4 = ethers.id('TextChanged(bytes32,string,string,string)');
const KEY_TWITTER = ethers.id('com.twitter');
const KEY_GITHUB = ethers.id('com.github');

const REGISTRY_ABI = ['function resolver(bytes32 node) view returns (address)'];
const RESOLVER_ABI = [
  'function text(bytes32 node, string key) view returns (string)',
  'function addr(bytes32 node) view returns (address)',
];
const MULTICALL_ABI = [
  'function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)',
];

const registryIface = new ethers.Interface(REGISTRY_ABI);
const resolverIface = new ethers.Interface(RESOLVER_ABI);

function getProvider(): ethers.JsonRpcProvider {
  const endpoint = process.env.ALCHEMY_KEY
    ? `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_KEY}`
    : 'https://eth.llamarpc.com';
  return new ethers.JsonRpcProvider(endpoint, 'mainnet', { staticNetwork: true });
}

export interface HarvestStats {
  blocksScanned: number;
  logsFound: number;
  nodesSeen: number;
  nodesWithRecords: number;
  walletsUpserted: number;
}

// ============================================================================
// Checkpoint (ingest_state table)
// ============================================================================

const STATE_KEY = 'ens_text_harvest';

export async function getCheckpoint(): Promise<number | null> {
  const db = getDb();
  if (!db) throw new Error('Database not configured');
  const result = (await db.execute(
    sql`SELECT value->>'lastBlock' AS last_block FROM ingest_state WHERE name = ${STATE_KEY}`
  )) as unknown as { rows: Array<{ last_block: string | null }> };
  const raw = result.rows[0]?.last_block;
  return raw ? parseInt(raw, 10) : null;
}

async function saveCheckpoint(lastBlock: number): Promise<void> {
  const db = getDb();
  if (!db) throw new Error('Database not configured');
  await db.execute(sql`
    INSERT INTO ingest_state (name, value, updated_at)
    VALUES (${STATE_KEY}, jsonb_build_object('lastBlock', ${lastBlock}::bigint), now())
    ON CONFLICT (name) DO UPDATE
    SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
  `);
}

// ============================================================================
// Stage 1: log scan
// ============================================================================

interface ScanResult {
  nodes: Set<string>;
  logCount: number;
}

/**
 * Scan [fromBlock, toBlock] for TextChanged events on the two keys and return
 * the distinct nodes. Window size self-tunes between 500 and 50k blocks:
 * halves on provider errors (result caps), grows on quiet ranges.
 */
async function scanTextChangedLogs(
  provider: ethers.JsonRpcProvider,
  fromBlock: number,
  toBlock: number,
  onWindow?: (upTo: number) => void
): Promise<ScanResult> {
  const nodes = new Set<string>();
  let logCount = 0;
  let window = 10_000;
  let block = fromBlock;

  while (block <= toBlock) {
    const upper = Math.min(block + window - 1, toBlock);
    try {
      const logs = await provider.send('eth_getLogs', [
        {
          fromBlock: '0x' + block.toString(16),
          toBlock: '0x' + upper.toString(16),
          topics: [
            [TEXT_CHANGED_3, TEXT_CHANGED_4],
            null,
            [KEY_TWITTER, KEY_GITHUB],
          ],
        },
      ]);
      for (const log of logs as Array<{ topics: string[] }>) {
        nodes.add(log.topics[1]);
      }
      logCount += (logs as unknown[]).length;
      block = upper + 1;
      onWindow?.(upper);
      // Quiet range → widen; busy range → narrow before the provider objects
      if ((logs as unknown[]).length < 2000) window = Math.min(window * 2, 50_000);
      else if ((logs as unknown[]).length > 5000) window = Math.max(Math.floor(window / 2), 500);
    } catch {
      if (window <= 500) {
        throw new Error(`eth_getLogs failing at minimum window (block ${block})`);
      }
      window = Math.max(Math.floor(window / 2), 500);
    }
  }

  return { nodes, logCount };
}

// ============================================================================
// Stage 2: resolve current values via Multicall3
// ============================================================================

export interface ResolvedRecord {
  node: string;
  wallet: string;
  twitter: string | null;
  github: string | null;
}

async function multicall(
  provider: ethers.JsonRpcProvider,
  calls: Array<{ target: string; callData: string }>
): Promise<Array<{ success: boolean; returnData: string }>> {
  const iface = new ethers.Interface(MULTICALL_ABI);
  const data = iface.encodeFunctionData('aggregate3', [
    calls.map((c) => ({ target: c.target, allowFailure: true, callData: c.callData })),
  ]);
  const raw = await provider.call({ to: MULTICALL3, data });
  const [results] = iface.decodeFunctionResult('aggregate3', raw);
  return (results as Array<[boolean, string]>).map(([success, returnData]) => ({
    success,
    returnData,
  }));
}

/**
 * Multicall with adaptive splitting: a batch that exceeds the provider's
 * eth_call gas cap (Alchemy: 550M — dense batches of text() reads can hit
 * it) is split in half and retried, down to single calls.
 *
 * Error classes are deliberately distinguished at the base case: inner
 * reverts never throw (aggregate3 runs with allowFailure), so a THROWN
 * eth_call is a provider failure — rate limit, timeout, outage. A single
 * call retries with backoff and then PROPAGATES the error. Swallowing it
 * would silently drop the node, and since the harvest checkpoints after
 * each chunk, a dropped node is never scanned again.
 */
async function multicallAdaptive(
  provider: ethers.JsonRpcProvider,
  calls: Array<{ target: string; callData: string }>,
  attempt = 0
): Promise<Array<{ success: boolean; returnData: string }>> {
  try {
    return await multicall(provider, calls);
  } catch (error) {
    if (calls.length === 1) {
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        return multicallAdaptive(provider, calls, attempt + 1);
      }
      // Persistent failure — let it propagate so the chunk aborts and the
      // checkpoint does NOT advance past these nodes
      throw error;
    }
    const mid = Math.floor(calls.length / 2);
    const [left, right] = await Promise.all([
      multicallAdaptive(provider, calls.slice(0, mid)),
      multicallAdaptive(provider, calls.slice(mid)),
    ]);
    return [...left, ...right];
  }
}

/** Resolve current resolver → text/addr for a set of nodes. */
async function resolveNodes(
  provider: ethers.JsonRpcProvider,
  nodes: string[]
): Promise<ResolvedRecord[]> {
  const records: ResolvedRecord[] = [];
  const BATCH = 250;

  for (let i = 0; i < nodes.length; i += BATCH) {
    const batch = nodes.slice(i, i + BATCH);

    // Round 1: current resolver for each node
    const resolverResults = await multicallAdaptive(
      provider,
      batch.map((node) => ({
        target: ENS_REGISTRY,
        callData: registryIface.encodeFunctionData('resolver', [node]),
      }))
    );

    const withResolver: Array<{ node: string; resolver: string }> = [];
    for (let j = 0; j < batch.length; j++) {
      const r = resolverResults[j];
      if (!r.success || r.returnData === '0x') continue;
      const [resolver] = registryIface.decodeFunctionResult('resolver', r.returnData);
      if (resolver && resolver !== ethers.ZeroAddress) {
        withResolver.push({ node: batch[j], resolver });
      }
    }
    if (withResolver.length === 0) continue;

    // Round 2: text(twitter), text(github), addr — three calls per node
    const calls = withResolver.flatMap(({ node, resolver }) => [
      { target: resolver, callData: resolverIface.encodeFunctionData('text', [node, 'com.twitter']) },
      { target: resolver, callData: resolverIface.encodeFunctionData('text', [node, 'com.github']) },
      { target: resolver, callData: resolverIface.encodeFunctionData('addr', [node]) },
    ]);
    const valueResults = await multicallAdaptive(provider, calls);

    for (let j = 0; j < withResolver.length; j++) {
      const [twitterRes, githubRes, addrRes] = valueResults.slice(j * 3, j * 3 + 3);

      let wallet: string | null = null;
      if (addrRes.success && addrRes.returnData !== '0x') {
        try {
          const [addr] = resolverIface.decodeFunctionResult('addr', addrRes.returnData);
          if (addr && addr !== ethers.ZeroAddress) wallet = (addr as string).toLowerCase();
        } catch {
          // Non-conforming resolver — skip
        }
      }
      if (!wallet) continue;

      const decodeText = (res: { success: boolean; returnData: string }): string | null => {
        if (!res.success || res.returnData === '0x') return null;
        try {
          const [value] = resolverIface.decodeFunctionResult('text', res.returnData);
          const trimmed = (value as string).trim();
          return trimmed.length > 0 ? trimmed : null;
        } catch {
          return null;
        }
      };

      const twitter = decodeText(twitterRes);
      const github = decodeText(githubRes);
      if (!twitter && !github) continue;

      records.push({ node: withResolver[j].node, wallet, twitter, github });
    }
  }

  return records;
}

// ============================================================================
// Stage 3: upsert
// ============================================================================

/**
 * Fill-only upsert: ENS-harvested handles never overwrite an existing value
 * (several names can point at one wallet with different handles — arbitrary
 * last-write-wins would be worse than keeping what a real lookup found).
 * twitter_verified is set only when we actually supplied the handle, and
 * last_updated_at only moves when something was filled, so re-harvests don't
 * trigger "new matches" badges.
 *
 * Like the Farcaster sweep, harvested rows get NO last_checked_at — the
 * wallet was never run through the full pipeline.
 */
async function upsertHarvestedRecords(records: ResolvedRecord[]): Promise<number> {
  const db = getDb();
  if (!db || records.length === 0) return 0;

  // One row per wallet: merge handles across nodes, first non-null wins
  const byWallet = new Map<string, { twitter: string | null; github: string | null }>();
  for (const r of records) {
    const existing = byWallet.get(r.wallet);
    const twitter = cleanTwitterHandle(r.twitter);
    const github = r.github ? r.github.replace(/^@/, '').replace(/https?:\/\/github\.com\//i, '').trim() || null : null;
    if (!existing) {
      byWallet.set(r.wallet, { twitter, github });
    } else {
      byWallet.set(r.wallet, {
        twitter: existing.twitter ?? twitter,
        github: existing.github ?? github,
      });
    }
  }

  const now = new Date();
  let upserted = 0;
  const entries = Array.from(byWallet.entries()).filter(
    ([, v]) => v.twitter || v.github
  );

  for (let i = 0; i < entries.length; i += 500) {
    const batch = entries.slice(i, i + 500).map(([wallet, v]) => ({
      wallet,
      twitterHandle: v.twitter,
      // x.com, matching the Farcaster sweep. This wrote twitter.com, so the
      // column held two spellings of the same link across 34,189 rows: both
      // resolve, and a difference that carries no meaning eventually gets read
      // as though it does.
      twitterUrl: v.twitter ? `https://x.com/${v.twitter}` : null,
      github: v.github,
      sources: ['ens_onchain'],
      twitterVerified: !!v.twitter,
      // twitter(20) + ens_onchain(30) = 50: below the 70 trust line because
      // the Farcaster side of these wallets has never been checked
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
          // This fill-if-empty writer still needs the renamed_from guard: the
          // stored handle is NULL exactly on rows that were cleared, and an
          // ENS text record can go on holding the dead string the conflict
          // resolver already replaced. Filling from it would reopen the
          // conflict, so a refused fill keeps every column as it was.
          twitterHandle: sql`CASE
            WHEN lower(EXCLUDED.twitter_handle) = lower(social_graph.twitter_renamed_from) THEN social_graph.twitter_handle
            ELSE COALESCE(social_graph.twitter_handle, EXCLUDED.twitter_handle) END`,
          twitterUrl: sql`CASE
            WHEN lower(EXCLUDED.twitter_handle) = lower(social_graph.twitter_renamed_from) THEN social_graph.twitter_url
            ELSE COALESCE(social_graph.twitter_url, EXCLUDED.twitter_url) END`,
          github: sql`COALESCE(social_graph.github, EXCLUDED.github)`,
          twitterVerified: sql`CASE WHEN social_graph.twitter_handle IS NULL AND EXCLUDED.twitter_handle IS NOT NULL
            AND lower(EXCLUDED.twitter_handle) IS DISTINCT FROM lower(social_graph.twitter_renamed_from)
            THEN true ELSE social_graph.twitter_verified END`,
          sources: sql`CASE WHEN 'ens_onchain' = ANY(social_graph.sources) THEN social_graph.sources ELSE array_append(COALESCE(social_graph.sources, ARRAY[]::text[]), 'ens_onchain') END`,
          dataQualityScore: sql`GREATEST(COALESCE(social_graph.data_quality_score, 0), 50)`,
          lastUpdatedAt: sql`CASE WHEN (social_graph.twitter_handle IS NULL AND EXCLUDED.twitter_handle IS NOT NULL
              AND lower(EXCLUDED.twitter_handle) IS DISTINCT FROM lower(social_graph.twitter_renamed_from))
            OR (social_graph.github IS NULL AND EXCLUDED.github IS NOT NULL) THEN EXCLUDED.last_updated_at ELSE social_graph.last_updated_at END`,
        },
      });
    upserted += batch.length;
  }

  return upserted;
}

// ============================================================================
// Orchestration
// ============================================================================

/**
 * Harvest [fromBlock → chain head] in chunks; checkpoint advances only after
 * a chunk's nodes are fully resolved and upserted, so interrupts are safe.
 */
export async function harvestEnsTextRecords(
  fromBlock: number,
  onProgress?: (msg: string) => void
): Promise<HarvestStats> {
  const provider = getProvider();
  const headBlock = await provider.getBlockNumber();
  // Small reorg buffer: never scan the last few blocks
  const targetBlock = headBlock - 10;

  const stats: HarvestStats = {
    blocksScanned: 0,
    logsFound: 0,
    nodesSeen: 0,
    nodesWithRecords: 0,
    walletsUpserted: 0,
  };

  const CHUNK_BLOCKS = 500_000;
  let block = fromBlock;

  while (block <= targetBlock) {
    const chunkEnd = Math.min(block + CHUNK_BLOCKS - 1, targetBlock);

    const scan = await scanTextChangedLogs(provider, block, chunkEnd);
    stats.blocksScanned += chunkEnd - block + 1;
    stats.logsFound += scan.logCount;
    stats.nodesSeen += scan.nodes.size;

    if (scan.nodes.size > 0) {
      const records = await resolveNodes(provider, Array.from(scan.nodes));
      stats.nodesWithRecords += records.length;
      stats.walletsUpserted += await upsertHarvestedRecords(records);
    }

    await saveCheckpoint(chunkEnd);
    onProgress?.(
      `block ${chunkEnd.toLocaleString()} | ${stats.nodesSeen.toLocaleString()} nodes | ${stats.walletsUpserted.toLocaleString()} wallets upserted`
    );

    block = chunkEnd + 1;
  }

  return stats;
}
