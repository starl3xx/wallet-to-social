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

/** A collection above the listing floor, carrying the number that earned it. */
export interface ListedHolderCollection extends HolderCollection {
  reachableAny: number;
  /**
   * When this collection's holder set was last confirmed onchain: the same
   * `max(last_seen_at)` that defines its current batch. The sitemap publishes
   * it as `lastmod`, so the value has to be a fact about the data rather than
   * the time the page was rendered.
   */
  lastSeenAt: string;
}

/**
 * The listing floor: the hub, the sitemap and prerendering carry a report
 * only once it shows at least this many reachable people, at at least this
 * share of the measured holders. A freshly seeded collection starts near
 * zero because its resolution job has not run (the API budget can pause for
 * weeks), and a zero that means "not yet checked" must never be published
 * as a finding. The floor keys on the reachable count rather than checked
 * coverage because reachable only ever undercounts: everyone shown was
 * really found, so a collection that clears the floor is safe to list even
 * mid-measurement, and one that later clears it graduates on the next
 * revalidation with no manual step.
 */
export const LISTING_MIN_REACHABLE = 20;
export const LISTING_MIN_RATE = 0.05;

/**
 * The minimum shared holders a counterparty needs before its overlap row is
 * published.
 *
 * This is a disclosure floor, not a quality floor, and it is not the same
 * quantity as LISTING_MIN_REACHABLE even though the number matches. Holder
 * lists are free from any block explorer, so a published intersection is a
 * set operation anyone can invert: "3 wallets hold both A and B" plus two
 * public holder lists names those three wallets. Aggregates protect people
 * only while the cell is large enough that differencing it returns a crowd.
 * Twenty is the same k-anonymity floor the listing rule already uses, applied
 * to the other place a small number reaches a page.
 */
export const OVERLAP_MIN_SHARED = 20;

/**
 * Below this checked coverage, a page is a measurement still running rather
 * than a measured rate, and says so.
 *
 * ## This used to also require the page to be below the listing floor
 *
 * It read `!meetsListingFloor(...) && checked < holderCount * 0.5`, on the
 * reasoning that a page clearing the floor had found enough people to be worth
 * publishing, so its numbers were the finding. Those are two different claims,
 * and the conjunction quietly asserted that clearing the floor implies being
 * measured. It does not, and the gap is not a corner case: `reachableAny` only
 * ever undercounts, which is exactly why the floor keys on it, so a collection
 * with a dense holder base clears the floor on its first few hundred checked
 * wallets and then renders as finished.
 *
 * Found on a real page. A collection seeded 2026-08-31 stood at 198 reachable
 * of 764 holders with 239 checked: it cleared the floor at 25.9%, the note
 * could not fire, and the page published a lower bound computed over 31% of the
 * holder set as though it were the collection's rate. The remaining 525 wallets
 * were not unreachable, they were unasked.
 *
 * So the floor no longer gates the note. Coverage alone decides it, which is
 * the only thing the sentence was ever about. A fully checked collection that
 * misses the floor (a bot-heavy holder base) still gets no note, because it is
 * above this coverage line: that case was never carried by the floor term.
 */
export const MEASUREMENT_IN_PROGRESS_BELOW = 0.5;

export function meetsListingFloor(
  reachable: number,
  holderCount: number
): boolean {
  return (
    reachable >= LISTING_MIN_REACHABLE &&
    reachable >= holderCount * LISTING_MIN_RATE
  );
}

export function measurementInProgress(stats: HolderStats): boolean {
  return stats.checked < stats.holderCount * MEASUREMENT_IN_PROGRESS_BELOW;
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

/**
 * Every collection above the listing floor; the page list, the sitemap and
 * generateStaticParams. Below-floor pages stay live at their direct URLs
 * through getHolderCollection, they just are not pointed at. The reachable
 * count is the same expression getHolderStats uses over the same
 * current-batch window, so the hub label and the page figure agree.
 */
export async function listHolderCollections(): Promise<
  ListedHolderCollection[]
> {
  // Preview deployments get the empty listing and never reach Neon. The
  // holders hub and the sitemap both prerender through this listing at build
  // time, which is the same build-time read that let concurrent preview
  // builds starve each other (docs/CI.md, the Vercel row). Every caller
  // already renders an empty listing gracefully, because a database-less
  // build takes the `!db` branch below to the same answer. Exact equality on
  // purpose: production and local builds keep the live query. Asserted in
  // `scripts/check-invariants.ts`.
  if (process.env.VERCEL_ENV === 'preview') return [];
  const db = getDb();
  if (!db) return [];
  const result = (await db.execute(sql`
    WITH latest AS (
      SELECT contract, chain, max(last_seen_at) AS at
      FROM wallet_holdings GROUP BY contract, chain
    ),
    holders AS (
      SELECT wh.contract, wh.chain, wh.wallet
      FROM wallet_holdings wh
      JOIN latest l ON l.contract = wh.contract AND l.chain = wh.chain
      WHERE wh.last_seen_at >= l.at - interval '1 hour'
    ),
    reach AS (
      SELECT h.contract, h.chain,
             count(*)::int AS holder_count,
             count(*) FILTER (WHERE x.status = 'live'
                                 OR g.farcaster IS NOT NULL)::int AS reachable
      FROM holders h
      LEFT JOIN social_graph g ON g.wallet = h.wallet
      LEFT JOIN x_accounts x ON x.handle = lower(g.twitter_handle)
      GROUP BY h.contract, h.chain
    )
    SELECT sc.address, sc.chain, sc.name, sc.symbol,
           sc.contract_type AS "contractType",
           sc.total_holders AS "totalHolders",
           sc.holders_imported AS "holdersImported",
           r.reachable AS "reachableAny",
           l.at AS "lastSeenAt"
    FROM seeded_contracts sc
    JOIN reach r ON r.contract = sc.address AND r.chain = sc.chain
    JOIN latest l ON l.contract = sc.address AND l.chain = sc.chain
    WHERE sc.holders_imported > 0 AND sc.name IS NOT NULL
      AND r.reachable >= ${LISTING_MIN_REACHABLE}
      -- The float cast is load-bearing: bound beside an int multiplication
      -- the parameter infers as integer and 0.05 fails to parse.
      AND r.reachable >= r.holder_count * ${LISTING_MIN_RATE}::float8
    ORDER BY r.reachable DESC, sc.name
  `)) as unknown as { rows: ListedHolderCollection[] };
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
     AND sc.name <> 'Unknown Token'
    WHERE NOT (wh.contract = ${address.toLowerCase()} AND wh.chain = ${chain})
      AND wh.last_seen_at >= ol.at - interval '1 hour'
    GROUP BY sc.address, sc.chain, sc.name
    HAVING count(*) >= ${OVERLAP_MIN_SHARED}
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
