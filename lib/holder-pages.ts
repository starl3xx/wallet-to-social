import { getDb } from '@/db';
import { sql } from 'drizzle-orm';
import { CHAIN_LABELS, type SupportedChain } from '@/lib/chains';

/**
 * Data for the per-collection holder reachability pages (/holders).
 *
 * seeded_contracts and wallet_holdings are not in db/schema.ts (the known
 * drift; their DDL is scripts/migrate-seed-tables.ts), so everything here is
 * raw SQL against the live names. Pages render these numbers at ISR time,
 * which by the figure checker's own rule exempts them from the registry: the
 * checker guards static literals, and nothing here is one.
 *
 * ## The labels are part of the contract
 *
 * `checked` counts holders with any social_graph row, and a row can be a
 * persisted negative, so it must render as "checked", never "has an
 * identity". Identity is `withTwitter` / `withFarcaster`. `reachableAny` (a
 * live X handle or a Farcaster account) is the one number a campaign can
 * act on, and the docs rule that keeps "has an identity" apart from
 * "reachable" applies to every surface these numbers touch. Wallet lists
 * themselves are never published: aggregates only.
 */
export interface HolderCollection {
  address: string;
  chain: SupportedChain;
  name: string;
  symbol: string | null;
  contractType: string;
  totalHolders: number | null;
  holdersImported: number;
}

export interface HolderStats {
  holderCount: number;
  checked: number;
  withTwitter: number;
  twitterVerified: number;
  withFarcaster: number;
  xLive: number;
  xUnclaimed: number;
  xSuspended: number;
  reachableAny: number;
  avgFcFollowers: number | null;
  medianFcFollowers: number | null;
}

export interface HolderOverlap {
  address: string;
  chain: SupportedChain;
  name: string;
  sharedHolders: number;
}

/** Every collection that seeded successfully; the page list and the sitemap. */
export async function listHolderCollections(): Promise<HolderCollection[]> {
  const db = getDb();
  if (!db) return [];
  const result = (await db.execute(sql`
    SELECT address, chain, name, symbol, contract_type AS "contractType",
           total_holders AS "totalHolders", holders_imported AS "holdersImported"
    FROM seeded_contracts
    WHERE holders_imported > 0 AND name IS NOT NULL
    ORDER BY holders_imported DESC, name
  `)) as unknown as { rows: HolderCollection[] };
  return result.rows;
}

export async function getHolderCollection(
  chain: string,
  address: string
): Promise<HolderCollection | null> {
  const db = getDb();
  if (!db) return null;
  const result = (await db.execute(sql`
    SELECT address, chain, name, symbol, contract_type AS "contractType",
           total_holders AS "totalHolders", holders_imported AS "holdersImported"
    FROM seeded_contracts
    WHERE address = ${address.toLowerCase()} AND chain = ${chain}
      AND holders_imported > 0
  `)) as unknown as { rows: HolderCollection[] };
  return result.rows[0] ?? null;
}

/**
 * The page's numbers, one aggregate over at most HOLDER_CAP (2,000) wallets.
 * x_accounts joins on the lowercased handle, the same rule as
 * lib/handle-reachability.ts.
 */
export async function getHolderStats(
  chain: string,
  address: string
): Promise<HolderStats | null> {
  const db = getDb();
  if (!db) return null;
  const result = (await db.execute(sql`
    WITH latest AS (
      -- Re-seeds upsert but never prune, so rows the newest batch did not
      -- touch are ex-holders. Anchoring on the holdings' own newest
      -- last_seen_at (not seeded_contracts.last_seeded_at, which recordSeed
      -- commits in a separate earlier statement) keeps the filter correct
      -- even when a re-seed dies between the two writes.
      SELECT max(last_seen_at) AS at FROM wallet_holdings
      WHERE contract = ${address.toLowerCase()} AND chain = ${chain}
    ),
    holders AS (
      SELECT wh.wallet
      FROM wallet_holdings wh, latest
      WHERE wh.contract = ${address.toLowerCase()} AND wh.chain = ${chain}
        AND wh.last_seen_at >= latest.at - interval '1 hour'
    )
    SELECT
      count(*)::int                                                      AS "holderCount",
      count(g.wallet)::int                                               AS "checked",
      count(*) FILTER (WHERE g.twitter_handle IS NOT NULL)::int          AS "withTwitter",
      count(*) FILTER (WHERE g.twitter_handle IS NOT NULL
                         AND g.twitter_verified = true)::int             AS "twitterVerified",
      count(*) FILTER (WHERE g.farcaster IS NOT NULL)::int               AS "withFarcaster",
      count(*) FILTER (WHERE x.status = 'live')::int                     AS "xLive",
      count(*) FILTER (WHERE x.status = 'not_found')::int                AS "xUnclaimed",
      count(*) FILTER (WHERE x.status = 'unavailable')::int              AS "xSuspended",
      count(*) FILTER (WHERE x.status = 'live'
                          OR g.farcaster IS NOT NULL)::int               AS "reachableAny",
      round(avg(g.fc_followers) FILTER (WHERE g.farcaster IS NOT NULL))::int AS "avgFcFollowers",
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY g.fc_followers)
            FILTER (WHERE g.fc_followers IS NOT NULL))::int              AS "medianFcFollowers"
    FROM holders h
    LEFT JOIN social_graph g ON g.wallet = h.wallet
    LEFT JOIN x_accounts x ON x.handle = lower(g.twitter_handle)
  `)) as unknown as { rows: HolderStats[] };
  const stats = result.rows[0];
  return stats && stats.holderCount > 0 ? stats : null;
}

/**
 * The other seeded collections these holders also hold, for the overlap
 * section and the internal-link mesh. Seeded contracts only, so every named
 * collection already has its own page to link to.
 */
export async function getHolderOverlap(
  chain: string,
  address: string,
  limit = 5
): Promise<HolderOverlap[]> {
  const db = getDb();
  if (!db) return [];
  const result = (await db.execute(sql`
    WITH latest AS (
      SELECT max(last_seen_at) AS at FROM wallet_holdings
      WHERE contract = ${address.toLowerCase()} AND chain = ${chain}
    ),
    holders AS (
      SELECT wh.wallet
      FROM wallet_holdings wh, latest
      WHERE wh.contract = ${address.toLowerCase()} AND wh.chain = ${chain}
        AND wh.last_seen_at >= latest.at - interval '1 hour'
    ),
    -- The same current-batch rule per counterparty contract, computed once.
    other_latest AS (
      SELECT contract, chain, max(last_seen_at) AS at FROM wallet_holdings
      GROUP BY contract, chain
    )
    SELECT sc.address, sc.chain, sc.name, count(*)::int AS "sharedHolders"
    FROM wallet_holdings wh
    JOIN holders h ON h.wallet = wh.wallet
    JOIN other_latest ol ON ol.contract = wh.contract AND ol.chain = wh.chain
    JOIN seeded_contracts sc
      ON sc.address = wh.contract AND sc.chain = wh.chain
     AND sc.holders_imported > 0 AND sc.name IS NOT NULL
    WHERE NOT (wh.contract = ${address.toLowerCase()} AND wh.chain = ${chain})
      AND wh.last_seen_at >= ol.at - interval '1 hour'
    GROUP BY sc.address, sc.chain, sc.name
    ORDER BY count(*) DESC
    LIMIT ${limit}
  `)) as unknown as { rows: HolderOverlap[] };
  return result.rows;
}

export function chainLabel(chain: string): string {
  return CHAIN_LABELS[chain as SupportedChain] ?? chain;
}

/** 'ERC-721' as itself; the legacy lowercase markers never reach pages. */
export function standardLabel(contractType: string): string {
  return contractType.startsWith('ERC') ? contractType : 'token';
}
