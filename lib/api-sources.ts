/**
 * Public vocabulary for the `sources` field on API responses.
 *
 * The `social_graph.sources` column stores internal pipeline identifiers, and
 * several of them are the literal names of third-party providers. Returning
 * that array verbatim published our supply chain to every API consumer: a
 * customer could read which vendors we buy from, and a competitor could
 * reconstruct the pipeline from a handful of sample wallets.
 *
 * This maps each internal identifier to a class of *evidence* instead. The
 * distinction customers actually need is "how was this attested", not "who
 * told us" — an onchain ENS record and a protocol-level Farcaster
 * verification carry different weight, and that difference survives the
 * translation intact.
 *
 * ALLOWLIST, NOT DENYLIST. Anything absent from the map is dropped rather
 * than passed through. A new ingest path added later cannot leak a vendor
 * name by default; it shows up as no source at all until someone
 * deliberately classifies it here. That failure mode is a missing label,
 * which is recoverable. The other direction is a disclosure, which is not.
 */

/** Evidence classes exposed on the public API. */
export type PublicSource =
  | 'onchain'
  | 'farcaster'
  | 'attested-social'
  | 'aggregated'
  | 'manual';

const SOURCE_CLASSES: Record<string, PublicSource | undefined> = {
  // Onchain ENS text records — self-published by the address owner.
  ens: 'onchain',
  ens_onchain: 'onchain',

  // Farcaster's own account verifications. Both of these read the same
  // protocol-level attestation, so they collapse to one public class.
  neynar: 'farcaster',
  farcaster_sweep: 'farcaster',

  // Third-party identity index. Weaker evidence: correlated, not attested.
  web3bio: 'aggregated',

  /**
   * An identity platform where the person proved the wallet with a signature
   * and the account with a sign-in.
   *
   * Its own class rather than `aggregated`, because it is not correlated: both
   * ends are attested by the owner. It is not `farcaster` either, since that
   * names a protocol-level record, and it is not `onchain`, since nothing here
   * is published to a chain. Calling it `aggregated` would have been the
   * cautious-looking choice and the inaccurate one, understating 68,894 matches
   * that a customer filtering for attested evidence should be seeing.
   *
   * The class is named for the mechanism, never the vendor. A provider's name
   * must not reach the public API for the same reason it must not reach the UI
   * or the docs.
   */
  ethos: 'attested-social',

  // Reviewed by us. Doubles as the identity mapping below.
  manual: 'manual',

  // Identity mappings, so the function is IDEMPOTENT. Two call sites now map
  // independently: the reverse-lookup route maps before results reach the
  // browser, and the CSV export maps whatever it is handed. Without these, the
  // second pass would look up 'onchain' in a table of internal identifiers,
  // find nothing, and drop it, silently emptying the source column on exported
  // reverse-lookup results. An allowlist that composes with itself is the only
  // safe shape when more than one layer can apply it.
  onchain: 'onchain',
  farcaster: 'farcaster',
  'attested-social': 'attested-social',
  aggregated: 'aggregated',

  // Persisted negatives. These rows are filtered out before serialization,
  // but map it explicitly so it can never fall through to the default.
  none: undefined,
};

/** Stable output order, so responses do not vary by insertion order. */
const SOURCE_ORDER: PublicSource[] = [
  'onchain',
  'farcaster',
  'attested-social',
  'manual',
  'aggregated',
];

/**
 * Translates internal source identifiers into public evidence classes.
 * Deduplicates, drops anything unrecognized, and returns undefined rather
 * than an empty array so callers can omit the field entirely.
 */
export function publicSources(sources: string[] | null | undefined): PublicSource[] | undefined {
  if (!sources || sources.length === 0) return undefined;

  const classes = new Set<PublicSource>();
  for (const source of sources) {
    const mapped = SOURCE_CLASSES[source];
    if (mapped) classes.add(mapped);
  }

  if (classes.size === 0) return undefined;
  return SOURCE_ORDER.filter((c) => classes.has(c));
}
