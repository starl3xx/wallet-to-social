/**
 * Scrape agent wallets from Virtuals Protocol + hol.org → known_agents table
 *
 * Usage:
 *   npx tsx scripts/scrape-agents.ts                  # scrape all sources → DB
 *   npx tsx scripts/scrape-agents.ts --virtuals-only  # just Virtuals
 *   npx tsx scripts/scrape-agents.ts --hol-only       # just hol.org
 *   npx tsx scripts/scrape-agents.ts --dry-run        # stats only, no DB write
 */

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { sql } from 'drizzle-orm';
import { knownAgents } from '../db/schema';

// ============================================================================
// Types
// ============================================================================

interface ScrapedAgent {
  wallet: string; // lowercase 0x address
  name: string;
  framework: string | null;
  agentType: string | null;
  tokenSymbol: string | null;
  twitterHandle: string | null;
  farcaster: string | null;
  source: 'virtuals' | 'hol'; // which scraper found it
}

interface VirtualsApiResponse {
  data: {
    id: number;
    name: string;
    symbol: string | null;
    walletAddress: string | null;
    sentientWalletAddress: string | null;
    socials: {
      TWITTER?: string;
      VERIFIED_LINKS?: { TWITTER?: string };
      VERIFIED_USERNAMES?: { TWITTER?: string };
    } | null;
    status: string;
  };
}

interface HolHit {
  id: string;
  name: string;
  registry: string;
  description?: string;
  endpoints?: {
    customEndpoints?: { wallet?: string };
    [key: string]: unknown;
  };
  metadata?: {
    ownerAddress?: string;
    [key: string]: unknown;
  };
  profile?: {
    socials?: Array<{ platform: string; handle: string }>;
    display_name?: string;
  };
}

interface HolSearchResponse {
  hits: HolHit[];
  total: number;
  page: number;
  limit: number;
}

// ============================================================================
// Config
// ============================================================================

const VIRTUALS_MAX_ID = 25000;
const VIRTUALS_CONCURRENT = 50;
const VIRTUALS_DELAY_MS = 100;
const VIRTUALS_TIMEOUT_MS = 15000;

const HOL_PAGE_SIZE = 100;
const HOL_MAX_PAGES_PER_QUERY = 50; // Cap at 5000 entries per query
const HOL_TIMEOUT_MS = 15000;
const HOL_DELAY_MS = 200;
const HOL_SKIP_REGISTRIES = new Set(['pulsemcp']);

const DB_BATCH_SIZE = 100;

// ============================================================================
// Helpers
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Extract a bare Twitter handle from a URL or handle string */
function extractTwitterHandle(raw: string | undefined | null): string | null {
  if (!raw) return null;
  // Handle full URLs like "https://x.com/virtualspixie"
  const urlMatch = raw.match(/(?:twitter\.com|x\.com)\/(@?[\w]+)/i);
  if (urlMatch) return urlMatch[1].replace(/^@/, '');
  // Handle bare "@handle" or "handle"
  const bare = raw.replace(/^@/, '').trim();
  return bare.length > 0 && /^[\w]+$/.test(bare) ? bare : null;
}

/** Map a hol.org registry name to our framework enum */
function holRegistryToFramework(registry: string): string | null {
  const map: Record<string, string> = {
    'virtuals-protocol': 'virtuals',
    'erc-8004': 'erc8004',
    elizaos: 'elizaos',
    'eliza-os': 'elizaos',
    olas: 'olas',
    autonolas: 'olas',
    moltbook: 'moltbook',
    zerepy: 'zerepy',
    arc: 'arc',
    ai16z: 'elizaos',
  };
  return map[registry.toLowerCase()] ?? registry.toLowerCase();
}

function isValidEthAddress(addr: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(addr);
}

// ============================================================================
// Virtuals Protocol Scraper
// ============================================================================

/** Result distinguishes "not found" (404/no wallet) from "error" (timeout/network) */
type FetchResult =
  | { status: 'ok'; agents: ScrapedAgent[] }
  | { status: 'skip' } // 404, no wallet, or no data
  | { status: 'error' }; // timeout, network failure, bad response

async function fetchVirtualsAgent(id: number): Promise<FetchResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), VIRTUALS_TIMEOUT_MS);

  try {
    const res = await fetch(`https://api.virtuals.io/api/virtuals/${id}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });

    if (res.status === 404) return { status: 'skip' };
    if (!res.ok) return { status: 'error' };

    const json = (await res.json()) as VirtualsApiResponse;
    const d = json.data;
    if (!d || !d.name) return { status: 'skip' };

    // Extract Twitter handle from socials
    const twitterRaw =
      d.socials?.VERIFIED_USERNAMES?.TWITTER ??
      d.socials?.VERIFIED_LINKS?.TWITTER ??
      d.socials?.TWITTER ??
      null;
    const twitterHandle = extractTwitterHandle(twitterRaw);

    const agents: ScrapedAgent[] = [];
    const base = {
      name: d.name,
      framework: 'virtuals' as const,
      agentType: null,
      tokenSymbol: d.symbol ? `$${d.symbol}` : null,
      twitterHandle,
      farcaster: null,
      source: 'virtuals' as const,
    };

    // Add both walletAddress and sentientWalletAddress as separate rows
    if (d.walletAddress && isValidEthAddress(d.walletAddress)) {
      agents.push({ ...base, wallet: d.walletAddress.toLowerCase() });
    }
    if (
      d.sentientWalletAddress &&
      isValidEthAddress(d.sentientWalletAddress) &&
      d.sentientWalletAddress.toLowerCase() !== d.walletAddress?.toLowerCase()
    ) {
      agents.push({
        ...base,
        wallet: d.sentientWalletAddress.toLowerCase(),
      });
    }

    return agents.length > 0 ? { status: 'ok', agents } : { status: 'skip' };
  } catch {
    return { status: 'error' };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function scrapeVirtuals(): Promise<Map<string, ScrapedAgent>> {
  const results = new Map<string, ScrapedAgent>();
  const ids = Array.from({ length: VIRTUALS_MAX_ID }, (_, i) => i + 1);

  let fetched = 0;
  let found = 0;
  let errors = 0;

  console.log(
    `\nScraping Virtuals Protocol (IDs 1..${VIRTUALS_MAX_ID}, ${VIRTUALS_CONCURRENT} concurrent)...`
  );

  for (let i = 0; i < ids.length; i += VIRTUALS_CONCURRENT) {
    const batch = ids.slice(i, i + VIRTUALS_CONCURRENT);
    const settled = await Promise.allSettled(
      batch.map((id) => fetchVirtualsAgent(id))
    );

    for (const result of settled) {
      fetched++;
      if (result.status === 'rejected') {
        errors++;
        continue;
      }
      const fetchResult = result.value;
      if (fetchResult.status === 'error') {
        errors++;
      } else if (fetchResult.status === 'ok') {
        for (const agent of fetchResult.agents) {
          // First writer wins (don't overwrite if already scraped)
          if (!results.has(agent.wallet)) {
            results.set(agent.wallet, agent);
            found++;
          }
        }
      }
    }

    // Progress logging every 1000 IDs
    if (fetched % 1000 < VIRTUALS_CONCURRENT) {
      const pct = ((fetched / VIRTUALS_MAX_ID) * 100).toFixed(1);
      process.stdout.write(
        `\r  Virtuals: ${fetched}/${VIRTUALS_MAX_ID} fetched (${pct}%), ${found} wallets found, ${errors} errors`
      );
    }

    if (i + VIRTUALS_CONCURRENT < ids.length) {
      await sleep(VIRTUALS_DELAY_MS);
    }
  }

  console.log(
    `\n  Virtuals done: ${found} unique wallets from ${fetched} IDs (${errors} errors)`
  );
  return results;
}

// ============================================================================
// hol.org Scraper
// ============================================================================

async function fetchHolPage(
  query: string,
  page: number
): Promise<{ hits: HolHit[]; total: number }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), HOL_TIMEOUT_MS);

  try {
    const url = `https://hol.org/registry/api/v1/search?q=${encodeURIComponent(query)}&limit=${HOL_PAGE_SIZE}&page=${page}`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });

    if (!res.ok) return { hits: [], total: 0 };

    const json = (await res.json()) as HolSearchResponse;
    return { hits: json.hits ?? [], total: json.total ?? 0 };
  } catch {
    return { hits: [], total: 0 };
  } finally {
    clearTimeout(timeoutId);
  }
}

function extractHolAgent(hit: HolHit): ScrapedAgent | null {
  // Skip registries we don't want
  if (HOL_SKIP_REGISTRIES.has(hit.registry?.toLowerCase())) return null;

  // Get wallet address — check each candidate individually to avoid
  // a non-null invalid string (e.g. "") blocking valid lower-priority sources
  const candidates = [
    hit.id,
    hit.endpoints?.customEndpoints?.wallet,
    hit.metadata?.ownerAddress,
  ];
  const wallet = candidates.find((c) => c != null && isValidEthAddress(c));
  if (!wallet) return null;

  // Extract Twitter from profile socials if available
  let twitterHandle: string | null = null;
  if (hit.profile?.socials && Array.isArray(hit.profile.socials)) {
    const twitterSocial = hit.profile.socials.find(
      (s) =>
        s.platform?.toLowerCase() === 'twitter' ||
        s.platform?.toLowerCase() === 'x'
    );
    if (twitterSocial?.handle) {
      twitterHandle = extractTwitterHandle(twitterSocial.handle);
    }
  }

  return {
    wallet: wallet.toLowerCase(),
    name: hit.name || `hol-${hit.id}`,
    framework: holRegistryToFramework(hit.registry || 'unknown'),
    agentType: null,
    tokenSymbol: null,
    twitterHandle,
    farcaster: null,
    source: 'hol',
  };
}

async function scrapeHol(): Promise<Map<string, ScrapedAgent>> {
  const results = new Map<string, ScrapedAgent>();

  // Targeted queries that yield wallet-bearing entries on hol.org.
  // Full pagination (104K entries) finds zero wallets outside these search terms.
  const SEARCH_QUERIES = [
    'virtuals',
    'token',
    'trading',
    'crypto',
    'defi',
    'agent',
    'wallet',
    'onchain',
    'nft',
  ];

  let totalFetched = 0;

  console.log(
    `\nScraping hol.org registry (${SEARCH_QUERIES.length} targeted queries)...`
  );

  for (const query of SEARCH_QUERIES) {
    let page = 1;
    let queryFound = 0;

    // Fetch first page to get total
    const firstPage = await fetchHolPage(query, 1);
    const total = firstPage.total;

    if (total === 0) {
      await sleep(HOL_DELAY_MS);
      continue;
    }

    // Process first page
    for (const hit of firstPage.hits) {
      const agent = extractHolAgent(hit);
      if (agent && !results.has(agent.wallet)) {
        results.set(agent.wallet, agent);
        queryFound++;
      }
    }
    totalFetched += firstPage.hits.length;
    page++;

    // Paginate remaining (capped to avoid scanning 59K entries for a few wallets)
    const totalPages = Math.min(
      Math.ceil(total / HOL_PAGE_SIZE),
      HOL_MAX_PAGES_PER_QUERY
    );
    while (page <= totalPages) {
      await sleep(HOL_DELAY_MS);
      const { hits } = await fetchHolPage(query, page);
      if (hits.length === 0) break;

      totalFetched += hits.length;
      for (const hit of hits) {
        const agent = extractHolAgent(hit);
        if (agent && !results.has(agent.wallet)) {
          results.set(agent.wallet, agent);
          queryFound++;
        }
      }
      page++;
    }

    console.log(`  q="${query}": ${total} results, ${queryFound} new wallets`);
    await sleep(HOL_DELAY_MS);
  }

  console.log(
    `  hol.org done: ${results.size} unique wallets from ${totalFetched} entries scanned`
  );
  return results;
}

// ============================================================================
// Merge & Upsert
// ============================================================================

function mergeAgents(
  virtuals: Map<string, ScrapedAgent>,
  hol: Map<string, ScrapedAgent>
): Map<string, ScrapedAgent> {
  // Start with Virtuals (richer data)
  const merged = new Map(virtuals);

  // Add hol.org entries only if not already from Virtuals
  for (const [wallet, agent] of hol) {
    if (!merged.has(wallet)) {
      merged.set(wallet, agent);
    }
  }

  return merged;
}

async function upsertAgents(
  agents: Map<string, ScrapedAgent>,
  dryRun: boolean
): Promise<void> {
  if (dryRun) {
    console.log(
      `\n[DRY RUN] Would upsert ${agents.size} agents. No DB writes.`
    );

    // Print source breakdown
    let virtualsCount = 0;
    let holCount = 0;
    for (const agent of agents.values()) {
      if (agent.source === 'virtuals') virtualsCount++;
      else holCount++;
    }
    console.log(`  From Virtuals: ${virtualsCount}`);
    console.log(`  From hol.org:  ${holCount}`);
    return;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required for DB writes');
    process.exit(1);
  }

  const neonClient = neon(databaseUrl);
  const db = drizzle(neonClient);

  const entries = Array.from(agents.values());
  let upserted = 0;

  console.log(`\nUpserting ${entries.length} agents to known_agents...`);

  for (let i = 0; i < entries.length; i += DB_BATCH_SIZE) {
    const batch = entries.slice(i, i + DB_BATCH_SIZE).map((agent) => ({
      wallet: agent.wallet,
      name: agent.name,
      framework: agent.framework,
      agentType: agent.agentType,
      tokenSymbol: agent.tokenSymbol,
      twitterHandle: agent.twitterHandle,
      farcaster: agent.farcaster,
    }));

    await db
      .insert(knownAgents)
      .values(batch)
      .onConflictDoUpdate({
        target: knownAgents.wallet,
        set: {
          // COALESCE: only fill NULLs, never overwrite existing data
          name: sql`COALESCE(${knownAgents.name}, EXCLUDED.name)`,
          framework: sql`COALESCE(${knownAgents.framework}, EXCLUDED.framework)`,
          agentType: sql`COALESCE(${knownAgents.agentType}, EXCLUDED.agent_type)`,
          tokenSymbol: sql`COALESCE(${knownAgents.tokenSymbol}, EXCLUDED.token_symbol)`,
          twitterHandle: sql`COALESCE(${knownAgents.twitterHandle}, EXCLUDED.twitter_handle)`,
          farcaster: sql`COALESCE(${knownAgents.farcaster}, EXCLUDED.farcaster)`,
          updatedAt: new Date(),
        },
      });

    upserted += batch.length;

    if (upserted % 500 === 0 || upserted === entries.length) {
      console.log(`  Upserted ${upserted}/${entries.length}`);
    }
  }

  console.log(`Done! ${upserted} agents upserted.`);
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const virtualsOnly = args.includes('--virtuals-only');
  const holOnly = args.includes('--hol-only');
  const dryRun = args.includes('--dry-run');

  console.log('Agent Scraper');
  console.log('=============');
  if (dryRun) console.log('[DRY RUN MODE]');
  if (virtualsOnly) console.log('Scraping Virtuals only');
  if (holOnly) console.log('Scraping hol.org only');

  const startTime = Date.now();

  let virtualsAgents = new Map<string, ScrapedAgent>();
  let holAgents = new Map<string, ScrapedAgent>();

  if (!holOnly) {
    virtualsAgents = await scrapeVirtuals();
  }

  if (!virtualsOnly) {
    holAgents = await scrapeHol();
  }

  const merged = mergeAgents(virtualsAgents, holAgents);

  console.log(`\nTotal unique wallets: ${merged.size}`);

  await upsertAgents(merged, dryRun);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nCompleted in ${elapsed}s`);
}

main().catch((error) => {
  console.error('Scrape error:', error);
  process.exit(1);
});
