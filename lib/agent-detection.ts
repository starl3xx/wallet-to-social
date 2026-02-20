import { getDb, knownAgents, type KnownAgent } from '@/db';
import { inArray } from 'drizzle-orm';
import type { WalletSocialResult } from './types';

// Virtuals Protocol factory contract on Base
const VIRTUALS_FACTORY_ADDRESS = '0xF66DeA7b3e897cD44A5a231c61B6B4423dAe4F19';

// Base chain RPC endpoint
const BASE_RPC_URL = process.env.ALCHEMY_KEY
  ? `https://base-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_KEY}`
  : 'https://mainnet.base.org';

// Bio keywords that suggest an AI agent
const AGENT_BIO_REGEX = /\b(bot|agent|autonomous|ai[\s-]?(powered|driven|agent)|automated|artificial intelligence)\b/i;

// ============================================================================
// Agent Detection Result
// ============================================================================

export interface AgentDetectionResult {
  is_agent: boolean;
  agent_name?: string;
  agent_framework?: string;
  agent_type?: string;
  agent_token_symbol?: string;
  agent_detection_source: 'known_list' | 'bio_keyword' | 'onchain_heuristic' | 'manual';
  agent_verified: boolean;
}

// ============================================================================
// Strategy 1: Known List Match (highest confidence)
// ============================================================================

/**
 * Check wallets against the curated known_agents table.
 * Uses the same bulk IN query pattern as getCachedWallets().
 */
export async function detectKnownAgents(
  wallets: string[]
): Promise<Map<string, AgentDetectionResult>> {
  const results = new Map<string, AgentDetectionResult>();
  const db = getDb();
  if (!db || wallets.length === 0) return results;

  const lowercaseWallets = wallets.map((w) => w.toLowerCase());

  try {
    const rows = await db
      .select()
      .from(knownAgents)
      .where(inArray(knownAgents.wallet, lowercaseWallets));

    for (const row of rows) {
      results.set(row.wallet, {
        is_agent: true,
        agent_name: row.name,
        agent_framework: row.framework ?? undefined,
        agent_type: row.agentType ?? undefined,
        agent_token_symbol: row.tokenSymbol ?? undefined,
        agent_detection_source: 'known_list',
        agent_verified: true,
      });
    }
  } catch (error) {
    console.error('Known agents lookup error:', error);
  }

  return results;
}

// ============================================================================
// Strategy 2: Farcaster Bio Keyword Detection (medium confidence)
// ============================================================================

/**
 * Scan Farcaster bio text for agent indicators.
 * Called after Neynar returns results with bio data.
 */
export function detectAgentFromBio(
  bio: string | undefined | null
): AgentDetectionResult | null {
  if (!bio) return null;

  if (AGENT_BIO_REGEX.test(bio)) {
    return {
      is_agent: true,
      agent_detection_source: 'bio_keyword',
      agent_verified: false,
    };
  }

  return null;
}

// ============================================================================
// Strategy 3: Virtuals Factory Interaction (medium-high confidence)
// ============================================================================

/**
 * Check if a wallet has interacted with the Virtuals Protocol factory on Base.
 * Uses eth_getTransactionCount from the factory to the wallet is not feasible,
 * so we check if the wallet has received events from the factory contract.
 *
 * For efficiency, we check transaction receipts for interactions with the factory.
 */
export async function detectVirtualsAgent(
  wallet: string
): Promise<AgentDetectionResult | null> {
  try {
    // Check if wallet has sent transactions to the Virtuals factory
    const response = await fetch(BASE_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_getLogs',
        params: [{
          fromBlock: '0x0',
          toBlock: 'latest',
          address: VIRTUALS_FACTORY_ADDRESS,
          // Check for any logs involving this wallet in topics
          topics: [null, '0x000000000000000000000000' + wallet.slice(2).toLowerCase()],
        }],
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) return null;

    const data = await response.json();
    if (data.result && data.result.length > 0) {
      return {
        is_agent: true,
        agent_framework: 'virtuals',
        agent_detection_source: 'onchain_heuristic',
        agent_verified: false,
      };
    }
  } catch (error) {
    // Silently fail — this is optional enrichment
    console.error('Virtuals factory check error:', error);
  }

  return null;
}

// ============================================================================
// Combined Detection Pipeline
// ============================================================================

/**
 * Run agent detection on a batch of wallet results.
 * Applies all three strategies in priority order:
 * 1. Known list (highest confidence, bulk query)
 * 2. Bio keyword (from existing Neynar data)
 * 3. Virtuals on-chain check (optional, for wallets without other signals)
 *
 * Results from higher-confidence sources take precedence.
 */
export async function enrichWithAgentDetection(
  results: Map<string, WalletSocialResult>,
  options?: { skipOnchain?: boolean }
): Promise<void> {
  const wallets = Array.from(results.keys());

  // Strategy 1: Known list match (bulk, fastest)
  const knownResults = await detectKnownAgents(wallets);

  // Apply known agent results
  for (const [wallet, agentData] of knownResults) {
    const existing = results.get(wallet);
    if (existing) {
      results.set(wallet, {
        ...existing,
        is_agent: agentData.is_agent,
        agent_name: agentData.agent_name,
        agent_framework: agentData.agent_framework,
        agent_type: agentData.agent_type,
        agent_token_symbol: agentData.agent_token_symbol,
        agent_verified: agentData.agent_verified,
      });
    }
  }

  // Strategy 2: Bio keyword detection (for wallets not already identified)
  for (const [wallet, result] of results) {
    if (result.is_agent) continue; // Already identified by known list
    if (!result.fc_bio) continue; // No bio data available

    const bioResult = detectAgentFromBio(result.fc_bio);
    if (bioResult) {
      results.set(wallet, {
        ...result,
        is_agent: true,
        agent_verified: false,
      });
    }
  }

  // Strategy 3: Virtuals on-chain check (optional, for remaining unidentified wallets)
  if (!options?.skipOnchain) {
    const unidentified = Array.from(results.entries())
      .filter(([, r]) => !r.is_agent)
      .map(([wallet]) => wallet);

    // Only check a limited number to avoid rate limits
    const MAX_ONCHAIN_CHECKS = 20;
    const toCheck = unidentified.slice(0, MAX_ONCHAIN_CHECKS);

    const onchainPromises = toCheck.map(async (wallet) => {
      const onchainResult = await detectVirtualsAgent(wallet);
      if (onchainResult) {
        const existing = results.get(wallet);
        if (existing) {
          results.set(wallet, {
            ...existing,
            is_agent: true,
            agent_framework: onchainResult.agent_framework,
            agent_verified: false,
          });
        }
      }
    });

    await Promise.allSettled(onchainPromises);
  }
}

// ============================================================================
// Known Agents CRUD (for admin endpoint)
// ============================================================================

export async function getKnownAgents(): Promise<KnownAgent[]> {
  const db = getDb();
  if (!db) return [];

  try {
    return await db.select().from(knownAgents).orderBy(knownAgents.name);
  } catch (error) {
    console.error('Get known agents error:', error);
    return [];
  }
}

export async function addKnownAgent(agent: {
  wallet: string;
  name: string;
  framework?: string;
  agentType?: string;
  tokenSymbol?: string;
  twitterHandle?: string;
  farcaster?: string;
}): Promise<KnownAgent | null> {
  const db = getDb();
  if (!db) return null;

  try {
    const [result] = await db
      .insert(knownAgents)
      .values({
        wallet: agent.wallet.toLowerCase(),
        name: agent.name,
        framework: agent.framework ?? null,
        agentType: agent.agentType ?? null,
        tokenSymbol: agent.tokenSymbol ?? null,
        twitterHandle: agent.twitterHandle ?? null,
        farcaster: agent.farcaster ?? null,
      })
      .onConflictDoUpdate({
        target: knownAgents.wallet,
        set: {
          name: agent.name,
          framework: agent.framework ?? null,
          agentType: agent.agentType ?? null,
          tokenSymbol: agent.tokenSymbol ?? null,
          twitterHandle: agent.twitterHandle ?? null,
          farcaster: agent.farcaster ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();

    return result;
  } catch (error) {
    console.error('Add known agent error:', error);
    return null;
  }
}

export async function removeKnownAgent(wallet: string): Promise<boolean> {
  const db = getDb();
  if (!db) return false;

  try {
    const { rowCount } = await db
      .delete(knownAgents)
      .where(inArray(knownAgents.wallet, [wallet.toLowerCase()]));

    return (rowCount ?? 0) > 0;
  } catch (error) {
    console.error('Remove known agent error:', error);
    return false;
  }
}
