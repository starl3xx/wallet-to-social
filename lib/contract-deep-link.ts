import { SUPPORTED_CHAINS, type SupportedChain } from './chains';

/**
 * `/?contract=0x…&chain=base` — a link that carries a contract into the
 * importer.
 *
 * Pulled out of the page so it can be tested without a browser, and so the
 * bookmarklet this exists for can be written against the same grammar rather
 * than a second reading of it.
 */
export interface ContractDeepLink {
  address: string;
  chain: SupportedChain;
}

/**
 * Marketplace chain slugs that do not match ours.
 *
 * OpenSea's URL grammar is `/item/<chain>/<contract>/<tokenId>`, and most of
 * its slugs happen to equal ours: `ethereum` and `base` are verified identical.
 * `matic` is the one known to differ, and it is the second most common chain
 * they list, so a link built from an OpenSea URL would otherwise be dropped for
 * the largest non-Ethereum collection set.
 *
 * Only aliases confirmed against a real URL belong here. A guessed alias sends
 * a lookup to the wrong chain, which returns an empty holder list rather than
 * an error, and that reads as "this contract has no holders".
 */
const CHAIN_ALIASES: Record<string, SupportedChain> = {
  matic: 'polygon',
};

/**
 * Reads a deep link out of a query string, or returns null.
 *
 * Null covers every rejection, deliberately: no link, a malformed address, an
 * unknown chain. The caller opens a modal on the strength of this, and there is
 * nothing useful to show a person who arrived on a URL they did not type.
 */
export function parseContractDeepLink(search: string): ContractDeepLink | null {
  const params = new URLSearchParams(search);

  const address = params.get('contract');
  if (!address) return null;

  // Checked here as well as on the server. This decides which modal opens, and
  // opening the importer on a malformed address shows an error nobody caused.
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return null;

  const raw = (params.get('chain') ?? 'ethereum').toLowerCase();
  const chain = CHAIN_ALIASES[raw] ?? raw;
  if (!SUPPORTED_CHAINS.includes(chain as SupportedChain)) return null;

  // Lowercased so the same contract from two sources is one string downstream.
  // Not checksummed: that is a separate concern and the API accepts either.
  return { address: address.toLowerCase(), chain: chain as SupportedChain };
}

/**
 * Builds one, for our own links and for the bookmarklet.
 *
 * Same module as the parser so the two cannot drift into disagreeing about the
 * parameter names, which is the usual way a link format breaks.
 */
export function buildContractDeepLink(
  origin: string,
  address: string,
  chain: SupportedChain
): string {
  const url = new URL(origin);
  url.searchParams.set('contract', address.toLowerCase());
  url.searchParams.set('chain', chain);
  return url.toString();
}
