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
  /**
   * When this collection's holder set was last confirmed onchain: the same
   * `max(last_seen_at)` that defines its current batch. The sitemap publishes
   * it as `lastmod`, the report states it in a sentence a reader can see, and
   * the report's Dataset node carries it as `dateModified`. Three surfaces,
   * one fact about the data, so none of them can drift into stamping the
   * time a page happened to render.
   *
   * Null only for a seeded contract with no holdings rows at all, which is
   * the same condition `getHolderStats` returns null for. The report 404s
   * there, so nothing has to invent a date to fill the gap.
   */
  lastSeenAt: string | null;
}

/** A collection above the listing floor, carrying the number that earned it. */
export interface ListedHolderCollection extends HolderCollection {
  reachableAny: number;
  /**
   * Narrowed: the listing joins `latest`, so a collection with no holdings
   * cannot appear here at all.
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
 * The seeder writes a placeholder when a contract exposes no name, and a
 * placeholder is never a display name.
 *
 * `lib/contract-holders.ts` returns 'Unknown Token' when every RPC endpoint
 * failed, or when name() and symbol() both reverted. The string records a
 * failed read, not a fact about the contract, so a report titled with it
 * answers no query and contradicts /llms.txt, which tells agents these
 * reports cover named collections.
 *
 * The rule was already written twice: once as this predicate in
 * scripts/concierge-signals.ts, which the reply lanes call so a placeholder
 * cannot beat a real @username, and once as a bare `<> 'Unknown Token'` in
 * getHolderOverlap below. The listing query had neither and filtered only on
 * NULL, so two placeholder-named reports were listed, sitemapped and
 * prerendered (verified against production on 2026-09-07: exactly two, both
 * clearing the listing floor). This is the one authority now.
 */
const PLACEHOLDER_NAME = /^unknown\b/i;

export function isNamed(name: string | null | undefined): boolean {
  return Boolean(name && !PLACEHOLDER_NAME.test(name));
}

/**
 * The same rule for the `sc` alias, so the listing and the overlap query
 * filter on the rule rather than on a literal each.
 *
 * The word boundary is spelled as a character class rather than as Postgres's
 * own `\y` because drizzle's `sql` tag reads the cooked template strings, not
 * `.raw`: JavaScript drops the backslash of an unrecognised escape before any
 * tag sees it, so `'^unknown\y'` would reach Postgres as `^unknowny` and match
 * nothing, silently. That is not hypothetical; the first version of this
 * predicate was written that way and returned zero rows against a corpus
 * holding two. Checked live on 2026-09-07 over all 260 seeded_contracts names:
 * this predicate and isNamed classify every one of them the same way.
 */
const namedContract = sql`sc.name IS NOT NULL AND sc.name !~* '^unknown([^a-z0-9_]|$)'`;

/**
 * Every named collection above the listing floor; the page list, the sitemap
 * and generateStaticParams. Below-floor and placeholder-named pages stay live
 * at their direct URLs through getHolderCollection, they just are not pointed
 * at, so a placeholder-named page also carries its own noindex (the
 * generateMetadata in app/holders/[chain]/[address]/page.tsx). The reachable
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
    WHERE sc.holders_imported > 0 AND ${namedContract}
      AND r.reachable >= ${LISTING_MIN_REACHABLE}
      -- The float cast is load-bearing: bound beside an int multiplication
      -- the parameter infers as integer and 0.05 fails to parse.
      AND r.reachable >= r.holder_count * ${LISTING_MIN_RATE}::float8
    ORDER BY r.reachable DESC, sc.name
  `)) as unknown as { rows: ListedHolderCollection[] };
  return result.rows;
}

/**
 * One seeded collection, with the date its holder set was last confirmed
 * onchain.
 *
 * That date is the same `max(last_seen_at)` the stats and overlap queries
 * anchor their current-batch window on, computed here by the same `latest`
 * CTE rather than read from `seeded_contracts.last_seeded_at`: a re-seed
 * commits that column in an earlier separate statement, so it can outrun the
 * holdings it describes. The report publishes this value in its copy and in
 * its `dateModified`, and both must name the batch the figures beside them
 * were measured over.
 *
 * A cross join, not an inner one. The aggregate returns a row whatever the
 * holdings table holds, so a seeded contract whose holdings have not landed
 * yet still resolves to a collection with a null date, exactly as it did
 * before this column existed; the 404 for that case stays where it already
 * was, in `getHolderStats`.
 */
export async function getHolderCollection(
  chain: string,
  address: string
): Promise<HolderCollection | null> {
  const db = getDb();
  if (!db) return null;
  const result = (await db.execute(sql`
    WITH latest AS (
      SELECT max(last_seen_at) AS at FROM wallet_holdings
      WHERE contract = ${address.toLowerCase()} AND chain = ${chain}
    )
    SELECT sc.address, sc.chain, sc.name, sc.symbol,
           sc.contract_type AS "contractType",
           sc.total_holders AS "totalHolders",
           sc.holders_imported AS "holdersImported",
           latest.at AS "lastSeenAt"
    FROM seeded_contracts sc, latest
    WHERE sc.address = ${address.toLowerCase()} AND sc.chain = ${chain}
      AND sc.holders_imported > 0
  `)) as unknown as { rows: HolderCollection[] };
  return result.rows[0] ?? null;
}

/**
 * The number of holders the seeder stops importing at.
 *
 * The value lives here as well as in `lib/seed-collections.ts` because the
 * page needs it and that module is the whole seeding pipeline: importing one
 * constant from it would pull the ingest into a rendered route. The two are
 * asserted equal in `scripts/check-invariants.ts`, so this is a second copy
 * of a number rather than a second opinion about it.
 *
 * It matters on the page because `seeded_contracts.total_holders` is the
 * source's reported total, and for some contracts that total came back as
 * exactly the cap. A reported total equal to the cap and equal to what we
 * imported is not a total, and must not be published as one.
 */
export const HOLDER_IMPORT_CAP = 2000;

/**
 * What the measured set actually is, decided once for both surfaces.
 *
 * The visible sentence and the Dataset node were computing this separately
 * and disagreeing. For the six contracts whose reported total came back as
 * exactly the cap, the prose said "all 2,000 indexed holders" while the
 * Dataset said the sample was the import cap and the real base may be
 * larger. An answer engine quotes the prose, so the page shipped the
 * over-claim the Dataset was added to prevent. One predicate now, four
 * cases, and the copy for each is derived from it rather than restated.
 *
 * Measured against production on 2026-09-07 over the 177 named contracts
 * that hold imported wallets, so these are the cases that exist rather
 * than the cases one can imagine:
 *
 *   sample        57  total > imported, e.g. 2,000 of 16,582
 *   complete      70  total reported and equal to imported, under the cap
 *   capped         6  imported hit the cap; total is the cap or absent
 *   unknownTotal  44  no usable total, imported under the cap
 *
 * `total_holders` is never null in practice: the seeder writes 0 when the
 * source reported no total, which is why zero is treated as absent here.
 * Before this predicate those 44 contracts published `totalHolders: 0` as
 * a machine-readable PropertyValue, a flatly false number for a collection
 * with hundreds of holders.
 */
export type HolderBasis =
  | { kind: 'sample'; measured: number; total: number }
  | { kind: 'complete'; measured: number }
  | { kind: 'capped'; measured: number }
  | { kind: 'unknownTotal'; measured: number };

export function holderBasis(collection: {
  holdersImported: number;
  totalHolders: number | null;
}): HolderBasis {
  const measured = collection.holdersImported;
  // Zero is the seeder's "the source told us nothing", not a holder count.
  const total =
    collection.totalHolders !== null && collection.totalHolders > 0
      ? collection.totalHolders
      : null;

  if (total !== null && total > measured)
    return { kind: 'sample', measured, total };
  // Order matters: a reported total equal to the cap and equal to what we
  // imported is the cap wearing a total's clothes, so the cap test has to
  // run before the equal-totals test can call it complete.
  if (measured >= HOLDER_IMPORT_CAP) return { kind: 'capped', measured };
  if (total !== null) return { kind: 'complete', measured };
  return { kind: 'unknownTotal', measured };
}

/**
 * The one description of the measured set, in prose an extractor can quote.
 *
 * A noun phrase in every case, so a caller can drop it into a sentence
 * without the grammar depending on which case it got. The hedge the two
 * partial cases need is a separate sentence from `holderBasisCaveat`,
 * because reading it inline produced "measured over the first 2,000
 * holders, which is the import cap, so the full holder base may be larger,
 * against the walletlink.social index", where the qualifier buries the
 * clause it qualifies.
 *
 * `subject` reads naturally in both places it is used: the visible sentence
 * says "holders" and the Dataset says "addresses holding <collection>".
 *
 * Every case appends `ofCollection` LAST, so nothing may follow it. A
 * trailing clause reads correctly only when that suffix is empty, which is
 * the visible sentence, and garbles the Dataset, which is the surface a
 * machine reads. `unknownTotal` therefore states the count alone and lets
 * `holderBasisCaveat` say the total was never reported.
 */
export function holderBasisPhrase(
  basis: HolderBasis,
  subject: { measuredNoun: string; ofCollection: string }
): string {
  const n = basis.measured.toLocaleString();
  switch (basis.kind) {
    case 'sample':
      return `the top ${n} of ${basis.total.toLocaleString()} ${subject.measuredNoun}${subject.ofCollection}`;
    case 'complete':
      return `all ${n} ${subject.measuredNoun}${subject.ofCollection}`;
    case 'capped':
      return `the first ${n} ${subject.measuredNoun}${subject.ofCollection}`;
    case 'unknownTotal':
      return `the ${n} ${subject.measuredNoun}${subject.ofCollection}`;
  }
}

/**
 * What the phrase above does not say on its own, as its own sentence.
 *
 * Null for the two cases that need no hedge. The two that do are the ones
 * where the measured count is not the holder base and nothing on the page
 * would otherwise say so, which is exactly the over-claim this predicate
 * exists to stop.
 */
export function holderBasisCaveat(basis: HolderBasis): string | null {
  switch (basis.kind) {
    case 'sample':
    case 'complete':
      return null;
    case 'capped':
      return `That is the import cap, so the full holder base may be larger.`;
    case 'unknownTotal':
      return `No total holder count was reported for the collection, so this may not be all of them.`;
  }
}

/**
 * The page's numbers, one aggregate over at most HOLDER_IMPORT_CAP (2,000)
 * wallets. x_accounts joins on the lowercased handle, the same rule as
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
     AND sc.holders_imported > 0 AND ${namedContract}
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

/**
 * Contracts whose stored `contract_type` is wrong by construction, because
 * they predate the standard that would have answered the detector.
 *
 * `detectContractType` (lib/contract-holders.ts) asks ERC-165 for ERC-721,
 * then for ERC-1155, and treats a revert as "no ERC-165, so ERC-20". That is
 * the right default: a contract that answers neither interface and does
 * answer decimals() is almost always a token. CryptoPunks is the case where
 * it is wrong and cannot be right. The contract predates ERC-721: there is
 * no ERC-165, `ownerOf` does not exist, ownership lives in
 * `punkIndexToAddress`, and the detector therefore records ERC-20 without
 * ever making a mistake. The page then published the guess as a fact, in a
 * sentence a model can quote with us as the source: "the wallets holding
 * this ERC-20 on Ethereum". Seen live on 2026-09-07 at the one holder report
 * /llms.txt cites by hand.
 *
 * Keyed by `chain:address` because a stored type is only ever wrong for a
 * specific deployment, and the address is the same one app/llms.txt/route.ts
 * links (checked against the seeded_contracts row: name CRYPTOPUNKS, chain
 * ethereum, contract_type ERC-20).
 *
 * ## Why this is an allowlist and not a rule
 *
 * The tempting general rule, "say `collection` wherever the type was inferred
 * rather than read", cannot be written against this data: the detector
 * collapses "ERC-165 answered false" and "ERC-165 reverted" into the same
 * string, so the rule would strip an accurate label from nearly every real
 * ERC-20 we publish. Measured 2026-09-07 by calling all thirteen seeded
 * Ethereum contracts stored as ERC-20: every one reverts or answers false on
 * supportsInterface(ERC-721) and every one reverts ownerOf, punks included.
 * Nothing the corpus records separates punks from a genuine token, which is
 * why this is a list of contracts somebody read rather than a heuristic.
 * An entry is added only after somebody can say why the detector could not
 * have got it right.
 *
 * Nothing here changes what the ingest stores, and the entry does not make
 * the page correct in every other respect: lib/recognized-contracts.ts still
 * refuses to seed CryptoPunks until the ingest has a punks-specific ownership
 * reader.
 */
const PRE_ERC721_COLLECTIONS = new Set([
  'ethereum:0xb47e3cd837ddf8e4c57f05d70ab865de6e193bbb',
]);

/**
 * 'ERC-721' as itself; the legacy lowercase markers never reach pages.
 *
 * Takes the chain and address as well as the type, so the sentence on the
 * page can be right about a contract the detector could not classify.
 */
export function standardLabel(
  contractType: string,
  chain: string,
  address: string
): string {
  if (PRE_ERC721_COLLECTIONS.has(`${chain}:${address.toLowerCase()}`)) {
    return 'collection';
  }
  return contractType.startsWith('ERC') ? contractType : 'token';
}
