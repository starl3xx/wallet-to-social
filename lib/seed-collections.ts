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
 *
 * Both discovery sources rank by novelty, and the novelty filter then works
 * further down each list, so on its own this pipeline is anti-correlated with
 * search demand: it seeds what nobody has searched for yet. lib/recognized-
 * contracts.ts leads both queues with names people do search, and empties
 * itself into the trending feeds once every entry has been seeded.
 */

import { getDb } from '@/db';
import { sql } from 'drizzle-orm';
import {
  getContractHolders,
  usesMeteredHolderIndex,
  type HolderResult,
} from './contract-holders';
import { SUPPORTED_CHAINS, type SupportedChain } from './chains';
import { createJob } from './job-processor';
import { trackEvent } from './analytics';
import { checkBackgroundBudget } from './neynar-budget';
import {
  checkHolderIndexBudget,
  estimateRequests,
} from './holder-index-budget';
import { recognizedCandidates } from './recognized-contracts';

// Per-contract holder cap: bounds daily external-API spend for the social
// resolution of never-seen wallets. Negatives persist, so re-encounters of
// the same wallets on later days cost nothing.
const HOLDER_CAP = 2000;

// Don't re-seed a successfully seeded contract within this window
const NOVELTY_DAYS = 30;

// Failed attempts get a much shorter lockout: long enough that a broken
// contract can't wedge its chain's queue, short enough that a transient
// Alchemy/Moralis blip doesn't cost a top collection a whole month
const FAILURE_RETRY_DAYS = 2;

// Base/quote tokens that appear in every trending pool but aren't communities
const TOKEN_DENYLIST = new Set([
  'weth',
  'usdc',
  'usdt',
  'dai',
  'wbtc',
  'cbeth',
  'wsteth',
  'cbbtc',
  'usdbc',
  'eth',
]);

// Infrastructure NFTs that rank top-by-holders but aren't communities —
// their holder lists are "everyone who ever LP'd", not an audience
const NFT_NAME_DENYLIST =
  /uniswap|position|aerodrome|slipstream|liquidity|\bLP\b/i;

const OPENSEA_CHAIN_SLUGS: Record<SupportedChain, string> = {
  ethereum: 'ethereum',
  base: 'base',
  robinhood: 'robinhood',
  arbitrum: 'arbitrum',
  // OpenSea still identifies Polygon by its old name
  polygon: 'matic',
  optimism: 'optimism',
  bsc: 'bsc',
};

const GECKO_NETWORKS: Record<SupportedChain, string> = {
  ethereum: 'eth',
  base: 'base',
  robinhood: 'robinhood',
  arbitrum: 'arbitrum',
  polygon: 'polygon_pos',
  optimism: 'optimism',
  bsc: 'bsc',
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
  if (!res.ok)
    throw new Error(`OpenSea temp key request failed: ${res.status}`);
  const json = (await res.json()) as {
    api_key?: string;
    apiKey?: string;
    key?: string;
  };
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
export async function discoverNftCandidates(
  chain: SupportedChain
): Promise<SeedCandidate[]> {
  const slug = OPENSEA_CHAIN_SLUGS[chain];
  // Recognised names lead. Novelty filtering downstream drops the ones already
  // seeded, so this prefix empties itself and discovery takes the slot back
  // without a second code path.
  const candidates: SeedCandidate[] = [...recognizedCandidates(chain, 'nft')];
  const recognizedCount = candidates.length;
  const seen = new Set<string>(candidates.map((c) => c.address));

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
        const res = await fetch(url, {
          headers,
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) {
          console.error(`OpenSea discovery ${res.status} for ${url}`);
          continue;
        }
        const json = (await res.json()) as {
          collections?: OpenSeaCollection[];
        };
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
    console.error(
      `OpenSea unavailable for ${chain}:`,
      (error as Error).message
    );
  }

  // Robinhood Chain must not depend on OpenSea (temp-key provisioning is
  // capped at 2/day and a standard key may not be configured): fall back to
  // Blockscout's holders-ranked token list, which needs no key at all.
  //
  // The test is whether DISCOVERY found nothing, not whether the list is
  // empty: a recognised prefix would otherwise suppress the fallback and
  // silently narrow this chain to its handful of curated names. The fallback
  // now appends rather than replaces, for the same reason.
  if (candidates.length === recognizedCount && chain === 'robinhood') {
    try {
      for (const fallback of await discoverRobinhoodNftFallback()) {
        if (seen.has(fallback.address)) continue;
        seen.add(fallback.address);
        candidates.push(fallback);
      }
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
  // Explicit holders sort — Blockscout's default order is market cap first,
  // which lets priced collections outrank larger audiences
  const res = await fetch(
    'https://robinhoodchain.blockscout.com/api/v2/tokens?type=ERC-721&sort=holders_count&order=desc',
    {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    }
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
export async function discoverTokenCandidates(
  chain: SupportedChain
): Promise<SeedCandidate[]> {
  const network = GECKO_NETWORKS[chain];
  const url = `https://api.geckoterminal.com/api/v2/networks/${network}/trending_pools?page=1`;

  const candidates: SeedCandidate[] = [...recognizedCandidates(chain, 'erc20')];
  const seen = new Set<string>(candidates.map((c) => c.address));

  let json: { data?: GeckoPool[] };
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`GeckoTerminal ${res.status} for ${network}`);
    json = (await res.json()) as { data?: GeckoPool[] };
  } catch (error) {
    // A discovery outage must not throw away names we already hold. Rethrow
    // only when there is genuinely nothing to seed, so the run still records
    // "discovery failed" in the case where that is the whole story.
    if (candidates.length === 0) throw error;
    console.error(`GeckoTerminal unavailable for ${network}:`, error);
    return candidates;
  }

  for (const pool of json.data ?? []) {
    const tokenId = pool.relationships?.base_token?.data?.id;
    if (!tokenId) continue;
    // id format: "<network>_<address>". Split on the LAST underscore, not the
    // first: network slugs can themselves contain one (polygon_pos), which made
    // the address parse as "pos_0x..." and silently skipped every Polygon pool.
    // Addresses never contain underscores, so the last one is always the split.
    const address = tokenId.slice(tokenId.lastIndexOf('_') + 1).toLowerCase();
    if (!address.startsWith('0x') || seen.has(address)) continue;

    // "BUB / WETH" → the pool's base symbol; skip infra tokens
    const baseSymbol = (pool.attributes?.name ?? '')
      .split('/')[0]
      ?.trim()
      .toLowerCase();
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

/** Candidates not seeded (or attempted) within NOVELTY_DAYS, in rank order. */
export async function selectNovelCandidates(
  candidates: SeedCandidate[]
): Promise<SeedCandidate[]> {
  const db = getDb();
  if (!db || candidates.length === 0) return candidates;

  const addresses = candidates.map((c) => c.address);
  const chain = candidates[0].chain;
  // Successes lock out for the full novelty window; failed attempts
  // (holders_imported = 0) only for the short retry window
  const result = (await db.execute(sql`
    SELECT address FROM seeded_contracts
    WHERE chain = ${chain}
      AND (
        (holders_imported > 0 AND last_seeded_at > now() - make_interval(days => ${NOVELTY_DAYS}))
        OR
        (holders_imported = 0 AND last_seeded_at > now() - make_interval(days => ${FAILURE_RETRY_DAYS}))
      )
      AND address IN (${sql.join(
        addresses.map((a) => sql`${a}`),
        sql`, `
      )})
  `)) as unknown as { rows: Array<{ address: string }> };

  const recentlySeeded = new Set(result.rows.map((r) => r.address));
  return candidates.filter((c) => !recentlySeeded.has(c.address));
}

/** Back-compat single-pick helper (first novel candidate). */
export async function selectNovelCandidate(
  candidates: SeedCandidate[]
): Promise<SeedCandidate | null> {
  return (await selectNovelCandidates(candidates))[0] ?? null;
}

/**
 * Record that a seed was ATTEMPTED, before knowing whether it succeeds.
 * Without this, a contract whose holder import persistently fails never
 * enters seeded_contracts, stays "novel" forever, and permanently blocks
 * its chain's queue — the failure mode is a cron that looks healthy while
 * seeding nothing.
 */
async function markSeedAttempt(candidate: SeedCandidate): Promise<void> {
  const db = getDb();
  if (!db) return;
  // holders_imported resets to 0 on every new attempt — the success path
  // (recordSeed) overwrites it immediately after. This is what makes a
  // failed attempt distinguishable (short lockout) from a success (full
  // novelty window) in selectNovelCandidates.
  await db.execute(sql`
    INSERT INTO seeded_contracts (address, chain, contract_type, name, holders_imported)
    VALUES (${candidate.address}, ${candidate.chain}, ${candidate.kind}, ${candidate.label}, 0)
    ON CONFLICT (address, chain) DO UPDATE SET last_seeded_at = now(), holders_imported = 0
  `);
}

/**
 * Revert an attempt marker after a BUDGET timeout: the run ran out of time,
 * the contract did nothing wrong, and it should stay novel so tomorrow's
 * fresh budget tries it first instead of locking it out for 2 days. Only
 * zero-holder rows are deleted; if the abandoned attempt later completes in
 * the background, recordSeed simply re-inserts a fresh success row.
 */
async function unmarkSeedAttempt(candidate: SeedCandidate): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db.execute(sql`
    DELETE FROM seeded_contracts
    WHERE address = ${candidate.address} AND chain = ${candidate.chain}
      AND holders_imported = 0
  `);
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
    const batch = holders.wallets
      .slice(i, i + 1000)
      .map((w) => w.toLowerCase());
    await db.execute(sql`
      INSERT INTO wallet_holdings (wallet, contract, chain, contract_type)
      VALUES ${sql.join(
        batch.map(
          (w) =>
            sql`(${w}, ${candidate.address}, ${candidate.chain}, ${holders.contractType})`
        ),
        sql`, `
      )}
      ON CONFLICT (wallet, contract, chain) DO UPDATE SET last_seen_at = now()
    `);
  }
}

/** Import one contract's holders and queue them through the lookup pipeline. */
export async function seedContract(
  candidate: SeedCandidate
): Promise<SeedRunResult> {
  /**
   * An ERC-20 seed draws on the same daily allowance a paying customer's
   * contract import needs, and the customer is by far the larger consumer of
   * it: on the day this guard was written they were 92% of the traffic and
   * reached three quarters of the day's allowance in two hours.
   *
   * So the cron yields first, and yields early. A refused seed costs one token
   * that nobody asked for and comes back tomorrow; a refused import is a
   * customer who paid, watching the feature stop.
   *
   * NFT seeds are not checked, because they resolve through a different
   * provider and cannot spend this allowance at all.
   */
  if (candidate.kind === 'erc20' && usesMeteredHolderIndex(candidate.chain)) {
    const indexBudget = await checkHolderIndexBudget(
      estimateRequests(HOLDER_CAP)
    );
    if (!indexBudget.allowed) {
      console.log(`Seed skipped, holder index budget: ${indexBudget.reason}`);
      /**
       * Undo the attempt marker. `seedFirstViable` writes it before calling
       * here, and a zero-holder row is `selectNovelCandidates`' way of
       * recording a contract that failed, which locks it out for two days.
       *
       * This contract did not fail. It was never tried. Leaving the marker
       * would punish a healthy token for a throttle it had no part in, and
       * would quietly shrink the candidate pool every day the allowance ran
       * short. The squeezed-timeout path already unmarks for this reason.
       */
      await unmarkSeedAttempt(candidate).catch(console.error);
      return {
        contract: candidate,
        holdersImported: 0,
        totalHolders: 0,
        jobId: null,
        error: 'holder index budget reserved for customer imports',
      };
    }
  }

  /**
   * `allowPublicFallback: false` — background work never borrows the public
   * explorers.
   *
   * The guard above only refuses a seed once the cron's own 20% ceiling is
   * reached. Customers hold the other 80%, so the provider can be fully spent
   * while this cron still believes it has room: it calls the index, meets
   * DAILY_ALLOWANCE_SPENT, and without this flag would silently redirect the
   * rest of the day's seeding onto free public infrastructure. That is the same
   * "spend somebody else's resources on work nobody asked for" that the budget
   * guard exists to stop, just one provider along.
   *
   * Robinhood Chain is unaffected and deliberately so: its explorer is the only
   * ERC-20 index that chain has, not a fallback, so this flag never applies to
   * it. The rule is about *borrowing* an alternative, not about explorers.
   */
  const holders = await getContractHolders(
    candidate.address,
    candidate.chain,
    HOLDER_CAP,
    {
      allowPublicFallback: false,
    }
  );

  // Decided before recording: recordSeed needs to know whether this contract
  // should count as finished or stay in the retry window.
  const socialBudget = await checkBackgroundBudget(holders.wallets.length);
  const resolutionQueued = holders.wallets.length > 0 && socialBudget.allowed;

  // recordSeed intentionally records the true holders_imported even when
  // resolution is skipped. That column is also selectNovelCandidates' state
  // machine (0 = failed, retry soon), so marking a successful import as 0 would
  // make the same top contracts novel again every couple of days and stall the
  // walk down the list. Skipped wallets are not lost: wallet_holdings keeps
  // every edge, so a later pass can resolve them without re-importing.
  await recordSeed(candidate, holders);

  // One job per contract so each seeded collection gets its own match-rate
  // stats (feeds the content pipeline). Deliberately NOT hidden: replaces
  // the synthetic-looking refresh cron in Recent Activity with real
  // collections and real numbers.
  //
  // Only this step spends Neynar credits, and it is gated separately from the
  // holder import above. When the Neynar budget is exhausted the seed still
  // grows wallet_holdings and seeded_contracts (Alchemy, Moralis and Blockscout
  // are unaffected by it); only social resolution waits for the period to roll
  // over. Gating the whole run instead would stall the holdings graph for weeks
  // over a limit that has nothing to do with the sources feeding it.
  let jobId: string | null = null;
  if (holders.wallets.length > 0 && !resolutionQueued) {
    console.warn(
      `Seeded ${candidate.label} holdings only, resolution deferred: ${socialBudget.reason}`
    );
  }
  if (resolutionQueued) {
    jobId = await createJob(
      holders.wallets,
      {},
      {
        includeENS: false,
        saveToHistory: false,
        canUseNeynar: true,
        canUseENS: false,
        tier: 'unlimited', // System job — full pipeline access
        inputSource: 'seed_cron',
      }
    );
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
 * One NFT collection and one token per chain, on all three chains.
 * Failures are per-contract: one bad discovery source or contract doesn't
 * stop the rest of the day's seeding.
 */
// How many novel candidates to try before giving up on a chain for the day
const MAX_ATTEMPTS_PER_SLOT = 3;

// Minimum budget required to START an attempt. The attempt itself is then
// hard-bounded by a race against the remaining budget (see seedFirstViable) —
// estimating a worst case by arithmetic is a losing game when ERC-20 holder
// fetches paginate up to 20 sequential requests under the hood.
const ATTEMPT_RESERVE_MS = 70_000;

// Margin kept for response serialization after the last attempt
const CLEANUP_MARGIN_MS = 10_000;

// A timeout is only INFORMATIVE about the contract when the attempt had a
// near-full budget: timing out despite this much runway means the contract
// is genuinely too slow to seed (keep the 2-day lockout, let later
// rankings have their turn). Timing out with less means the attempt was
// squeezed by a late slot — the contract stays novel for tomorrow's fresh
// budget.
const INFORMATIVE_TIMEOUT_BUDGET_MS = 150_000;

/** Distinguishes "the run's budget expired" from "the contract failed" —
 *  they must be recorded differently. */
class SeedBudgetTimeout extends Error {}

/** Reject if the promise outlives ms. The underlying work may still complete
 *  in the background before function teardown — that's harmless here: seed
 *  writes are idempotent and a late-created job is a real job. */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new SeedBudgetTimeout(
              `${label} exceeded ${Math.round(ms / 1000)}s budget`
            )
          ),
        ms
      )
    ),
  ]);
}

// A slot additionally needs its discovery calls (two 15s-timeout fetches)
// before any attempt can start
const SLOT_RESERVE_MS = ATTEMPT_RESERVE_MS + 35_000;

/**
 * Try novel candidates in rank order until one seeds successfully. Every
 * attempt — success or failure — is recorded first, so a broken contract
 * consumes its novelty and tomorrow's run moves down the rankings instead
 * of retrying it forever.
 */
async function seedFirstViable(
  candidates: SeedCandidate[],
  chain: SupportedChain,
  kind: 'nft' | 'erc20',
  deadline: number
): Promise<SeedRunResult> {
  const novel = await selectNovelCandidates(candidates);
  if (novel.length === 0) {
    return {
      contract: { address: '?', chain, kind, label: 'no novel candidates' },
      holdersImported: 0,
      totalHolders: 0,
      jobId: null,
      error: 'no novel candidates',
    };
  }

  let lastError = '';
  for (const candidate of novel.slice(0, MAX_ATTEMPTS_PER_SLOT)) {
    // A slot must not eat the whole run's budget retrying on a
    // degraded-API day — only start an attempt it can finish
    const remaining = deadline - Date.now();
    if (remaining < ATTEMPT_RESERVE_MS) {
      return {
        contract: { address: '?', chain, kind, label: 'time budget exhausted' },
        holdersImported: 0,
        totalHolders: 0,
        jobId: null,
        error: lastError || 'time budget exhausted',
      };
    }
    await markSeedAttempt(candidate);
    const attemptBudget = remaining - CLEANUP_MARGIN_MS;
    try {
      // Hard wall-clock bound: the attempt may use all remaining budget
      // minus the cleanup margin, but can never exceed it — regardless of
      // how many sequential requests the holder fetch makes internally
      return await withTimeout(
        seedContract(candidate),
        attemptBudget,
        candidate.label
      );
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      console.error(
        `Seed failed for ${candidate.label} (${candidate.address}):`,
        lastError
      );
      if (error instanceof SeedBudgetTimeout) {
        // Informative timeout (near-full budget, still too slow): keep the
        // 2-day lockout so a perpetually-slow contract can't retry first
        // every day and starve later rankings. Squeezed timeout (late
        // slot): undo the lockout — the contract did nothing wrong.
        if (attemptBudget < INFORMATIVE_TIMEOUT_BUDGET_MS) {
          await unmarkSeedAttempt(candidate).catch(console.error);
        }
        // Either way, stop attempting: no time left for another try
        return {
          contract: {
            address: '?',
            chain,
            kind,
            label: 'time budget exhausted',
          },
          holdersImported: 0,
          totalHolders: 0,
          jobId: null,
          error: lastError,
        };
      }
    }
  }

  return {
    contract: { address: '?', chain, kind, label: 'all attempts failed' },
    holdersImported: 0,
    totalHolders: 0,
    jobId: null,
    error: lastError,
  };
}

export async function runDailySeed(): Promise<SeedRunResult[]> {
  const results: SeedRunResult[] = [];
  // 240s of the route's 300s maxDuration, shared across all slots
  const deadline = Date.now() + 240_000;
  // Robinhood first: it's the chain with no competing index, so it must
  // never be the one starved when earlier slots burn the time budget
  // Deliberate order, because the run shares one time budget across all slots
  // and whatever sits last is what gets dropped when it runs out.
  //
  // Robinhood first: it is the only chain here nobody else indexes, so its
  // coverage is the differentiator. Ethereum and Base next, where the existing
  // audience is. The newer chains take what remains.
  //
  // Any supported chain missing from this list is appended rather than dropped,
  // so adding a chain can never silently stop seeding it, which is exactly the
  // bug this replaces.
  const SEED_ORDER: SupportedChain[] = [
    'robinhood',
    'ethereum',
    'base',
    'arbitrum',
    'polygon',
    'optimism',
    'bsc',
  ];
  const chains: SupportedChain[] = [
    ...SEED_ORDER.filter((c) => SUPPORTED_CHAINS.includes(c)),
    ...SUPPORTED_CHAINS.filter((c) => !SEED_ORDER.includes(c)),
  ];

  const budgetExhausted = (
    chain: SupportedChain,
    kind: 'nft' | 'erc20'
  ): SeedRunResult => ({
    contract: { address: '?', chain, kind, label: 'time budget exhausted' },
    holdersImported: 0,
    totalHolders: 0,
    jobId: null,
    error: 'time budget exhausted',
  });

  for (const chain of chains) {
    // NFT collection — discovery itself costs 15s-timeout fetches, so skip
    // the whole slot when the remaining budget can't cover discovery + seed
    if (Date.now() > deadline - SLOT_RESERVE_MS) {
      results.push(budgetExhausted(chain, 'nft'));
      continue;
    }
    try {
      const nftCandidates = await discoverNftCandidates(chain);
      results.push(
        await seedFirstViable(nftCandidates, chain, 'nft', deadline)
      );
    } catch (error) {
      results.push({
        contract: {
          address: '?',
          chain,
          kind: 'nft',
          label: 'discovery failed',
        },
        holdersImported: 0,
        totalHolders: 0,
        jobId: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Token, now on every chain: Robinhood ERC-20 holder lists resolve through
    // its Blockscout explorer, and GeckoTerminal indexes the chain for discovery
    {
      if (Date.now() > deadline - SLOT_RESERVE_MS) {
        results.push(budgetExhausted(chain, 'erc20'));
        continue;
      }
      try {
        const tokenCandidates = await discoverTokenCandidates(chain);
        results.push(
          await seedFirstViable(tokenCandidates, chain, 'erc20', deadline)
        );
      } catch (error) {
        results.push({
          contract: {
            address: '?',
            chain,
            kind: 'erc20',
            label: 'discovery failed',
          },
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
