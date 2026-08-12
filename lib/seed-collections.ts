/**
 * Daily dataset seeding: top/trending NFT collections and ERC-20 tokens on
 * Ethereum, Base, and Robinhood Chain → holder lists → the normal lookup
 * pipeline → social_graph.
 *
 * With the Farcaster sweep and ENS harvest as the wholesale backbone, most
 * holders of mainnet blue-chips already resolve locally. What seeding adds:
 *  - wallet_holdings edges (the audience graph: "holders of X" as a segment)
 *  - negative knowledge for wallets with no protocol identity (persists 30
 *    days since PR #18, so repeat encounters are free)
 *  - Robinhood Chain coverage nobody else is indexing
 *  - per-collection match-rate stats that feed the social content pipeline
 *
 * Discovery sources (all free):
 *  - OpenSea /collections/top + /collections/trending — covers all three
 *    chains including robinhood; uses OPENSEA_API_KEY or auto-provisions a
 *    7-day temp key from /v2/auth/keys
 *  - GeckoTerminal trending_pools per network (keyless, 30 req/min)
 *
 * Selection is novelty-aware: contracts seeded within NOVELTY_DAYS are
 * skipped, so the cron works down the list instead of re-buying the top 10.
 */

import { getDb } from '@/db';
import { sql } from 'drizzle-orm';
import {
  getContractHolders,
  type HolderResult,
} from './contract-holders';
import type { SupportedChain } from './chains';
import { createJob } from './job-processor';
import { trackEvent } from './analytics';

// Per-contract holder cap: bounds daily external-API spend for the social
// resolution of never-seen wallets. Negatives persist, so re-encounters of
// the same wallets on later days cost nothing.
const HOLDER_CAP = 2000;

// Don't re-seed a contract within this window
const NOVELTY_DAYS = 30;

// Base/quote tokens that appear in every trending pool but aren't communities
const TOKEN_DENYLIST = new Set([
  'weth', 'usdc', 'usdt', 'dai', 'wbtc', 'cbeth', 'wsteth', 'cbbtc', 'usdbc', 'eth',
]);

// Infrastructure NFTs that rank top-by-holders but aren't communities —
// their holder lists are "everyone who ever LP'd", not an audience
const NFT_NAME_DENYLIST = /uniswap|position|aerodrome|slipstream|liquidity|\bLP\b/i;

const OPENSEA_CHAIN_SLUGS: Record<SupportedChain, string> = {
  ethereum: 'ethereum',
  base: 'base',
  robinhood: 'robinhood',
};

const GECKO_NETWORKS: Record<SupportedChain, string> = {
  ethereum: 'eth',
  base: 'base',
  robinhood: 'robinhood',
};

export interface SeedCandidate {
  address: string;
  chain: SupportedChain;
  kind: 'nft' | 'erc20';
  label: string;
}

export interface SeedRunResult {
  contract: SeedCandidate;
  holdersImported: number;
  totalHolders: number;
  jobId: string | null;
  error?: string;
}

// ============================================================================
// OpenSea key handling
// ============================================================================

let cachedTempKey: string | null = null;

async function getOpenSeaKey(): Promise<string> {
  if (process.env.OPENSEA_API_KEY) return process.env.OPENSEA_API_KEY;
  if (cachedTempKey) return cachedTempKey;
  // Documented instant temp key: 7-day expiry, 600 req/hr — we need a
  // handful of requests per day
  const res = await fetch('https://api.opensea.io/api/v2/auth/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`OpenSea temp key request failed: ${res.status}`);
  const json = (await res.json()) as { api_key?: string; apiKey?: string; key?: string };
  const key = json.api_key ?? json.apiKey ?? json.key;
  if (!key) throw new Error('OpenSea temp key response had no key field');
  cachedTempKey = key;
  return key;
}

// ============================================================================
// Discovery
// ============================================================================

interface OpenSeaCollection {
  collection?: string;
  name?: string;
  contracts?: Array<{ address?: string; chain?: string }>;
}

/** Top + trending NFT collections on a chain, best-ranked first, deduped. */
export async function discoverNftCandidates(chain: SupportedChain): Promise<SeedCandidate[]> {
  const slug = OPENSEA_CHAIN_SLUGS[chain];
  const candidates: SeedCandidate[] = [];
  const seen = new Set<string>();

  // The whole OpenSea section — key acquisition included — is best-effort:
  // temp-key provisioning is capped at 2/day, so it must be able to fail
  // without taking the Blockscout fallback down with it
  try {
    const key = await getOpenSeaKey();
    const headers = { 'x-api-key': key, Accept: 'application/json' };

    const urls = [
      `https://api.opensea.io/api/v2/collections/trending?chains=${slug}&limit=25`,
      `https://api.opensea.io/api/v2/collections/top?chains=${slug}&limit=25`,
    ];

    for (const url of urls) {
      try {
        const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
        if (!res.ok) {
          console.error(`OpenSea discovery ${res.status} for ${url}`);
          continue;
        }
        const json = (await res.json()) as { collections?: OpenSeaCollection[] };
        for (const col of json.collections ?? []) {
          const contract = (col.contracts ?? []).find(
            (c) => c.chain === slug && c.address?.startsWith('0x')
          );
          if (!contract?.address) continue;
          const address = contract.address.toLowerCase();
          if (seen.has(address)) continue;
          const label = col.name ?? col.collection ?? address;
          if (NFT_NAME_DENYLIST.test(label)) continue;
          seen.add(address);
          candidates.push({ address, chain, kind: 'nft', label });
        }
      } catch (error) {
        console.error(`OpenSea discovery failed for ${url}:`, error);
      }
    }
  } catch (error) {
    console.error(`OpenSea unavailable for ${chain}:`, (error as Error).message);
  }

  // Robinhood Chain must not depend on OpenSea (temp-key provisioning is
  // capped at 2/day and a standard key may not be configured): fall back to
  // Blockscout's holders-ranked token list, which needs no key at all
  if (candidates.length === 0 && chain === 'robinhood') {
    try {
      return await discoverRobinhoodNftFallback();
    } catch (error) {
      console.error('Blockscout fallback failed:', error);
    }
  }

  return candidates;
}

interface BlockscoutToken {
  name?: string;
  address?: string;
  address_hash?: string;
  holders_count?: string | number;
  holders?: string | number;
}

/** Keyless Robinhood NFT discovery: Blockscout tokens ranked by holders. */
async function discoverRobinhoodNftFallback(): Promise<SeedCandidate[]> {
  const res = await fetch(
    'https://robinhoodchain.blockscout.com/api/v2/tokens?type=ERC-721',
    { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) }
  );
  if (!res.ok) throw new Error(`Blockscout ${res.status}`);
  const json = (await res.json()) as { items?: BlockscoutToken[] };

  const candidates: SeedCandidate[] = [];
  for (const token of json.items ?? []) {
    const address = (token.address_hash ?? token.address ?? '').toLowerCase();
    const label = token.name ?? address;
    if (!address.startsWith('0x')) continue;
    if (NFT_NAME_DENYLIST.test(label)) continue;
    candidates.push({ address, chain: 'robinhood', kind: 'nft', label });
  }
  return candidates;
}

interface GeckoPool {
  relationships?: { base_token?: { data?: { id?: string } } };
  attributes?: { name?: string };
}

/** Trending token contracts on a chain via GeckoTerminal, deduped. */
export async function discoverTokenCandidates(chain: SupportedChain): Promise<SeedCandidate[]> {
  const network = GECKO_NETWORKS[chain];
  const url = `https://api.geckoterminal.com/api/v2/networks/${network}/trending_pools?page=1`;

  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`GeckoTerminal ${res.status} for ${network}`);
  const json = (await res.json()) as { data?: GeckoPool[] };

  const candidates: SeedCandidate[] = [];
  const seen = new Set<string>();

  for (const pool of json.data ?? []) {
    const tokenId = pool.relationships?.base_token?.data?.id;
    if (!tokenId) continue;
    // id format: "<network>_<address>"
    const address = tokenId.slice(tokenId.indexOf('_') + 1).toLowerCase();
    if (!address.startsWith('0x') || seen.has(address)) continue;

    // "BUB / WETH" → the pool's base symbol; skip infra tokens
    const baseSymbol = (pool.attributes?.name ?? '').split('/')[0]?.trim().toLowerCase();
    if (baseSymbol && TOKEN_DENYLIST.has(baseSymbol)) continue;

    seen.add(address);
    candidates.push({
      address,
      chain,
      kind: 'erc20',
      label: pool.attributes?.name ?? address,
    });
  }

  return candidates;
}

// ============================================================================
// Novelty-aware selection
// ============================================================================

/** First candidate not seeded within NOVELTY_DAYS. */
export async function selectNovelCandidate(
  candidates: SeedCandidate[]
): Promise<SeedCandidate | null> {
  const db = getDb();
  if (!db || candidates.length === 0) return candidates[0] ?? null;

  const addresses = candidates.map((c) => c.address);
  const chain = candidates[0].chain;
  const result = (await db.execute(sql`
    SELECT address FROM seeded_contracts
    WHERE chain = ${chain}
      AND last_seeded_at > now() - make_interval(days => ${NOVELTY_DAYS})
      AND address IN (${sql.join(addresses.map((a) => sql`${a}`), sql`, `)})
  `)) as unknown as { rows: Array<{ address: string }> };

  const recentlySeeded = new Set(result.rows.map((r) => r.address));
  return candidates.find((c) => !recentlySeeded.has(c.address)) ?? null;
}

// ============================================================================
// Seeding one contract
// ============================================================================

async function recordSeed(
  candidate: SeedCandidate,
  holders: HolderResult
): Promise<void> {
  const db = getDb();
  if (!db) return;

  await db.execute(sql`
    INSERT INTO seeded_contracts (address, chain, contract_type, name, symbol, holders_imported, total_holders)
    VALUES (${candidate.address}, ${candidate.chain}, ${holders.contractType}, ${holders.tokenName}, ${holders.tokenSymbol}, ${holders.wallets.length}, ${holders.totalHolders})
    ON CONFLICT (address, chain) DO UPDATE
    SET holders_imported = EXCLUDED.holders_imported,
        total_holders = EXCLUDED.total_holders,
        contract_type = EXCLUDED.contract_type,
        name = EXCLUDED.name,
        symbol = EXCLUDED.symbol,
        last_seeded_at = now()
  `);

  for (let i = 0; i < holders.wallets.length; i += 1000) {
    const batch = holders.wallets.slice(i, i + 1000).map((w) => w.toLowerCase());
    await db.execute(sql`
      INSERT INTO wallet_holdings (wallet, contract, chain, contract_type)
      VALUES ${sql.join(
        batch.map((w) => sql`(${w}, ${candidate.address}, ${candidate.chain}, ${holders.contractType})`),
        sql`, `
      )}
      ON CONFLICT (wallet, contract, chain) DO UPDATE SET last_seen_at = now()
    `);
  }
}

/** Import one contract's holders and queue them through the lookup pipeline. */
export async function seedContract(candidate: SeedCandidate): Promise<SeedRunResult> {
  const holders = await getContractHolders(candidate.address, candidate.chain, HOLDER_CAP);

  await recordSeed(candidate, holders);

  // One job per contract so each seeded collection gets its own match-rate
  // stats (feeds the content pipeline). Deliberately NOT hidden: replaces
  // the synthetic-looking refresh cron in Recent Activity with real
  // collections and real numbers.
  let jobId: string | null = null;
  if (holders.wallets.length > 0) {
    jobId = await createJob(holders.wallets, {}, {
      includeENS: false,
      saveToHistory: false,
      canUseNeynar: true,
      canUseENS: false,
      tier: 'unlimited', // System job — full pipeline access
      inputSource: 'seed_cron',
    });
  }

  trackEvent('lookup_completed', {
    metadata: {
      eventSubtype: 'seed_contract',
      address: candidate.address,
      chain: candidate.chain,
      kind: candidate.kind,
      label: candidate.label,
      holdersImported: holders.wallets.length,
      totalHolders: holders.totalHolders,
      jobId,
    },
  }).catch(console.error);

  return {
    contract: candidate,
    holdersImported: holders.wallets.length,
    totalHolders: holders.totalHolders,
    jobId,
  };
}

// ============================================================================
// The daily run
// ============================================================================

/**
 * One NFT collection per chain, plus one token on Ethereum and Base
 * (Robinhood ERC-20 holder lists aren't available — NFT only there).
 * Failures are per-contract: one bad discovery source or contract doesn't
 * stop the rest of the day's seeding.
 */
export async function runDailySeed(): Promise<SeedRunResult[]> {
  const results: SeedRunResult[] = [];
  const chains: SupportedChain[] = ['ethereum', 'base', 'robinhood'];

  for (const chain of chains) {
    // NFT collection
    try {
      const nftCandidates = await discoverNftCandidates(chain);
      const nft = await selectNovelCandidate(nftCandidates);
      if (nft) {
        results.push(await seedContract(nft));
      } else {
        console.log(`No novel NFT candidate on ${chain}`);
      }
    } catch (error) {
      results.push({
        contract: { address: '?', chain, kind: 'nft', label: 'discovery failed' },
        holdersImported: 0,
        totalHolders: 0,
        jobId: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Token (not available on Robinhood)
    if (chain !== 'robinhood') {
      try {
        const tokenCandidates = await discoverTokenCandidates(chain);
        const token = await selectNovelCandidate(tokenCandidates);
        if (token) {
          results.push(await seedContract(token));
        } else {
          console.log(`No novel token candidate on ${chain}`);
        }
      } catch (error) {
        results.push({
          contract: { address: '?', chain, kind: 'erc20', label: 'discovery failed' },
          holdersImported: 0,
          totalHolders: 0,
          jobId: null,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return results;
}
