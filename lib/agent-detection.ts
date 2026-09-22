import { getDb, knownAgents, type KnownAgent } from '@/db';
import { inArray } from 'drizzle-orm';

// Bio keywords that suggest an AI agent
// Note: bare "agent" is excluded to avoid false positives ("real estate agent", etc.)
const AGENT_BIO_REGEX =
  /\b(bot|autonomous agent|ai[\s-]?(powered|driven|agent)|automated|artificial intelligence|onchain agent|crypto agent|defi agent|trading bot)\b/i;

// ============================================================================
// Agent Detection Result
// ============================================================================

export interface AgentDetectionResult {
  is_agent: boolean;
  agent_name?: string;
  agent_framework?: string;
  agent_type?: string;
  agent_token_symbol?: string;
  /**
   * The X handle of the AGENT itself, where the list holds one.
   *
   * Never put on a result row. It exists so `lib/agent-claim.ts` can tell an
   * agent that has a social presence from the human who deployed it: the two
   * are indistinguishable without it, and the wallet address alone is wrong
   * about which one it belongs to far more often than not.
   */
  agent_twitter_handle?: string;
  agent_detection_source:
    'known_list' | 'bio_keyword' | 'onchain_heuristic' | 'manual';
  agent_verified: boolean;
}

// ============================================================================
// Strategy 1: Known List Match (highest confidence)
// ============================================================================

/**
 * Check wallets against the curated known_agents table.
 * Uses the same bulk IN query pattern as getCachedWallets().
 *
 * "Curated" overstates it, and the overstatement mattered. The table is
 * scraped from Virtuals Protocol's own API, whose `walletAddress` per agent is
 * frequently the CREATOR's wallet rather than an autonomous one. A match here
 * is therefore a third-party claim about an address, not a verified fact about
 * it, and `lib/agent-claim.ts` is what decides whether it survives contact with
 * what the address owner published. This function only reports the claim.
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
        agent_twitter_handle: row.twitterHandle ?? undefined,
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
