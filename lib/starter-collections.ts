import { getDb } from '@/db';
import { sql } from 'drizzle-orm';
import { SUPPORTED_CHAINS, type SupportedChain } from '@/lib/chains';
import { FREE_MATCHES_PER_WINDOW } from '@/lib/packs';
import { getHolderCollection, listHolderCollections } from '@/lib/holder-pages';

/**
 * A first action that needs nothing from the visitor.
 *
 * Every other way into this product asks the visitor to bring something: a
 * CSV, a contract address, a handle. A signed-in account with no history
 * therefore sees an empty screen and has to go and find data before it can
 * find out what the product does. The seed corpus already answers that:
 * `seeded_contracts` and `wallet_holdings` hold holder lists we imported
 * ourselves, so a run needs no upload and no paid contract import.
 *
 * **It is not free of upstream calls, and nothing here should say it is.** An
 * earlier version of this comment claimed the wallets "were resolved once
 * already", which is false: `lib/seed-collections.ts` writes the holdings
 * whether or not it had the budget to resolve them, so coverage varies by
 * collection and is the `checked` figure printed on the same report page.
 * Measured 2026-08-26 over the 62 listed collections, a mean of 71 wallets in
 * a 100-wallet sample had never been checked. Resolution is therefore an
 * ordinary lookup: the holders already in `social_graph` come back out of the
 * index, and the rest are resolved live, exactly as an uploaded list of the
 * same size would be. What makes this safe to offer to an account with no
 * credits is the meter, not the absence of a cost.
 *
 * Neither table is in `db/schema.ts` (the known drift; the DDL lives in
 * `scripts/migrate-seed-tables.ts`), so everything here is raw SQL against
 * the live names, as `lib/holder-pages.ts` already is.
 */

/**
 * How many wallets a starter run submits, and therefore the most it can cost.
 *
 * **The cap is the worst case, not the expected case.** Every wallet in the
 * sample might match, and a match is a match whoever supplied the list, so the
 * number of wallets read is the ceiling on the matches debited. Sizing this
 * against `MEASURED_MATCH_RATE` was wrong twice over: the rate is a
 * corpus-wide average, and `listStarterCollections` deliberately offers the
 * MOST reachable collections it can find, which is the opposite end of that
 * distribution. Measured on 2026-08-26, the three cards resolved 85, 25 and 35
 * of their first 100 sampled wallets, so the first card alone would have spent
 * 85 of the 100 free matches on one press: an introduction that leaves nothing
 * to try your own list with.
 *
 * A quarter of the allowance is what a demonstration may cost. It leaves 75
 * matches, which at `MEASURED_MATCH_RATE` is about 316 wallets, a whole median
 * real list. `scripts/check-invariants.ts` holds the ratio, because this is a
 * bound that a later "make the sample bigger" would quietly remove.
 */
export const STARTER_WALLET_CAP = Math.round(FREE_MATCHES_PER_WINDOW / 4);

/**
 * The share of the free allowance a starter run may spend, in the worst case.
 *
 * Derived rather than written, so the cap above and the invariant that guards
 * it cannot drift apart, and so the claim "a quarter" is checkable.
 */
export const STARTER_ALLOWANCE_SHARE =
  STARTER_WALLET_CAP / FREE_MATCHES_PER_WINDOW;

/** A collection offered as a first action, and the number that earned it. */
export interface StarterCollection {
  chain: SupportedChain;
  address: string;
  name: string;
  symbol: string | null;
  /** Holders measured for the report, which is what the run samples from. */
  holders: number;
  /** The listing floor's own number: people reachable on X or Farcaster. */
  reachableAny: number;
}

/**
 * What a starter run resolves to: the label, and the list we supply.
 *
 * The chain and address come back normalised rather than being read again off
 * the caller's input, so whatever is recorded against the job is the row that
 * passed the gate and not the string that asked for it.
 */
export interface StarterWallets {
  chain: SupportedChain;
  address: string;
  name: string;
  wallets: string[];
}

/**
 * A placeholder the seeder writes when a contract exposes no name.
 *
 * Fine on a report page, where the address beside it does the identifying,
 * and wrong on a card whose whole job is to be recognisable enough to click.
 */
const PLACEHOLDER_NAMES = new Set(['unknown token', 'unknown', 'unnamed']);

/**
 * The collections worth offering, most reachable first.
 *
 * Composed over `listHolderCollections` rather than querying reachability
 * again: that function already carries the listing floor, and a second
 * expression of the same rule is the usual way a hub and a card start
 * disagreeing about which collections exist. The floor is also the right bar
 * here for the same reason it is there, since a collection whose resolution
 * job has not run would hand a first-time visitor a screen of misses.
 */
export async function listStarterCollections(
  limit = 3
): Promise<StarterCollection[]> {
  const listed = await listHolderCollections();
  return listed
    .filter((c) => !PLACEHOLDER_NAMES.has(c.name.trim().toLowerCase()))
    .slice(0, limit)
    .map((c) => ({
      chain: c.chain,
      address: c.address,
      name: c.name,
      symbol: c.symbol,
      holders: c.holdersImported,
      reachableAny: c.reachableAny,
    }));
}

/**
 * The wallets behind one collection, or null.
 *
 * SECURITY: a collection that is not a row in `seeded_contracts` is refused,
 * and refused before a single wallet is read. Without that, this is a free
 * bypass of the paid contract importer: a caller could name any contract on
 * any chain and have us import and resolve its holders for nothing. The
 * refusal is the first statement in the function for that reason, and the
 * holdings query below runs only once a seeded row has come back.
 *
 * Nothing else about the resulting job is special. The caller runs it through
 * the same rate limit, the same credit meter and the same per-lookup cap as a
 * list somebody uploaded; the only thing we supplied is the list.
 */
export async function getStarterWallets(
  chain: string,
  address: string
): Promise<StarterWallets | null> {
  const link = parseStarterParam(`${chain}:${address}`);
  if (!link) return null;

  // The gate. Seeded contracts only, checked before any holdings are read.
  const collection = await getHolderCollection(link.chain, link.address);
  if (!collection) return null;

  const db = getDb();
  if (!db) return null;

  const result = (await db.execute(sql`
    WITH latest AS (
      -- The current-batch rule getHolderStats uses, for the same reason: a
      -- re-seed upserts but never prunes, so a row the newest batch did not
      -- touch belongs to somebody who has since sold.
      SELECT max(last_seen_at) AS at FROM wallet_holdings
      WHERE contract = ${link.address} AND chain = ${link.chain}
    )
    SELECT wh.wallet
    FROM wallet_holdings wh, latest
    WHERE wh.contract = ${link.address} AND wh.chain = ${link.chain}
      AND wh.last_seen_at >= latest.at - interval '1 hour'
    -- Ordered by a hash of the address, not by the address itself. Deterministic
    -- either way, but ascending hex sorts the leading-zero addresses to the
    -- front, and those are vanity and contract addresses rather than people:
    -- the plain sort opened one collection's sample on 0x…dead, the burn
    -- address, followed by four more that each begin with at least four zeros.
    ORDER BY md5(wh.wallet)
    LIMIT ${STARTER_WALLET_CAP}
  `)) as unknown as { rows: { wallet: string }[] };

  if (result.rows.length === 0) return null;

  return {
    chain: link.chain,
    address: link.address,
    // A seeded row can carry no name; the symbol, then the address, keep the
    // history label from being blank rather than falling back to a noun.
    name: collection.name || collection.symbol || collection.address,
    wallets: result.rows.map((r) => r.wallet),
  };
}

/** `<chain>:<address>`, the form the `?collection=` parameter carries. */
export interface StarterLink {
  chain: SupportedChain;
  address: string;
}

/**
 * Reads one, or returns null.
 *
 * The same grammar and the same strictness as `lib/contract-deep-link.ts`,
 * and null covers every rejection for the same reason: nothing useful can be
 * said to a person who arrived on a URL they did not type. It is a separate
 * parameter from `?contract=` deliberately. That one routes an unentitled
 * visitor to the buy-credits modal, which is the opposite of what a first
 * action is for.
 *
 * Marketplace chain aliases are not accepted here. `?contract=` takes them
 * because a bookmarklet builds it from somebody else's URL; this parameter is
 * only ever built by `buildStarterHref` from our own data.
 */
export function parseStarterParam(value: string | null): StarterLink | null {
  if (!value) return null;

  const [rawChain, rawAddress, ...rest] = value.split(':');
  // A third segment means this is not our grammar, so it is not ours to guess at.
  if (rest.length > 0 || !rawChain || !rawAddress) return null;

  const chain = rawChain.toLowerCase();
  if (!SUPPORTED_CHAINS.includes(chain as SupportedChain)) return null;

  // Checked here as well as on the server, as the contract deep link is: this
  // decides whether a lookup starts, and starting one on a malformed address
  // shows an error nobody caused.
  if (!/^0x[a-fA-F0-9]{40}$/.test(rawAddress)) return null;

  // Lowercased so the parameter and the seeded row are one string. The seeder
  // writes lowercase, so a checksummed address would otherwise miss the gate.
  return { chain: chain as SupportedChain, address: rawAddress.toLowerCase() };
}

/**
 * Builds one, so a page that has already named a collection can carry it.
 *
 * Same module as the parser, so the two cannot drift into disagreeing about
 * the parameter name, which is the usual way a link format breaks.
 */
export function buildStarterHref(chain: string, address: string): string {
  return `/?collection=${chain}:${address.toLowerCase()}`;
}
