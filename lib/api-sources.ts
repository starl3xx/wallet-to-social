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

  /**
   * Onchain attestations. The record lives on Base or Optimism, but the class is
   * still `attested-social` rather than `onchain`: `onchain` means the address
   * owner published it themselves, which is what an ENS text record is. Here a
   * service attests on their behalf after they proved the account to it. The
   * storage medium is not the evidence.
   */
  eas: 'attested-social',

  /**
   * A token deploy requested from an X account and delivered to a wallet. Both
   * halves are established by the act: the account had to post, and the wallet
   * had to be the one named.
   */
  clanker: 'attested-social',

  /**
   * A bind-by-tweet flow: the person connects the wallet to an identity
   * platform, which then requires a tweet naming that wallet from the
   * account being bound. The tweet is the public half of a binding the
   * platform established end to end; the class is named for the mechanism,
   * never the platform, same as every entry here.
   */
  debank_tweet: 'attested-social',

  /**
   * A deprecated governance-delegate registry: the delegate signed the
   * address and posted the signature in a tweet from the account, and the
   * registry's verifier checked both before publishing the pair. Frozen
   * corpus, both halves owner-established.
   */
  sybil_list: 'attested-social',

  /**
   * A governance platform profile set with a wallet-signed message that
   * names the handle. Wallet-side attestation at ENS-record strength; not
   * `onchain`, because nothing is published to a chain.
   */
  snapshot_profile: 'attested-social',

  /**
   * A marketplace account where the wallet is the login and the social
   * account is attached by OAuth sign-in: both halves owner-established.
   */
  opensea_profile: 'attested-social',

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

/**
 * The internal source ids that map to a public evidence class, as a list SQL
 * can be given.
 *
 * `publicSources` is the allowlist and stays the only one; this is the same
 * table read from the other end, for the one query that has to filter by source
 * *before* it has a row rather than after. Reverse lookup needs it: a wallet is
 * matched by a second attested handle only where that attestation would also be
 * shown, and `alsoOnXForWallets` decides "would be shown" by dropping any
 * source this map does not name. A reverse query without the same filter would
 * return a wallet for a handle the row itself never displays, and would leak
 * the existence of an unmapped source by the shape of the result.
 *
 * Derived, never typed out again: a second hand-written copy is how an
 * allowlist and its enforcement drift apart.
 */
export const MAPPED_SOURCE_IDS: string[] = Object.entries(SOURCE_CLASSES)
  .filter(([, mapped]) => mapped !== undefined)
  .map(([id]) => id);

/** Stable output order, so responses do not vary by insertion order. */
const SOURCE_ORDER: PublicSource[] = [
  'onchain',
  'farcaster',
  'attested-social',
  'manual',
  'aggregated',
];

/**
 * The evidence classes that mean the wallet owner published the link
 * themselves: everything in the vocabulary except `aggregated`, which is
 * correlated by a third party. This set is what an `attested` field on any
 * projection derives from, never the narrower `verified` flag, which is true
 * for the onchain, manual and attested-social routes and so reports false on
 * the majority Farcaster-attested handles. The prose statement of the same fact is
 * `ATTESTED_SENTENCE` in `lib/canonical-sentences.ts`; a class added here is
 * a change to that sentence too.
 */
export const ATTESTED_SOURCES: ReadonlySet<PublicSource> = new Set([
  'onchain',
  'farcaster',
  'attested-social',
  'manual',
]);

/**
 * Whether one public source value is attested evidence. Takes `unknown`
 * because callers read the `sources` array back off a serialized response,
 * where nothing has verified the element type.
 */
export function isAttestedSource(value: unknown): boolean {
  return (
    typeof value === 'string' && ATTESTED_SOURCES.has(value as PublicSource)
  );
}

/**
 * Translates internal source identifiers into public evidence classes.
 * Deduplicates, drops anything unrecognized, and returns undefined rather
 * than an empty array so callers can omit the field entirely.
 */
/**
 * Coerce whatever is in a `source` field into the list it was supposed to be.
 *
 * The field is typed `string[]` and that type is a claim about JSON, which is
 * not a thing a type can check. It was wrong in production: our own CSV export
 * writes `source` as a comma-joined string, and a customer who exported results
 * and re-uploaded that file had the string merged straight over the array by
 * `lib/job-processor.ts`. 480,674 stored result rows held an array; two held a
 * string, and the only surface that noticed called `.map` and crashed.
 *
 * A string is the shape that actually occurs, so it is the shape that is
 * recovered rather than discarded: splitting on the comma gives back exactly
 * what the export joined. Anything else becomes an empty list, which every
 * caller already handles.
 *
 * Iterating a string is the specific trap this exists to close. `for (const s
 * of "web3bio,neynar")` walks characters, and so does `[...existing.source]`,
 * so the bug's signature is a provenance list made of single letters rather
 * than an exception anybody would see.
 */
export function asSourceList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string');
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

export function publicSources(sources: unknown): PublicSource[] | undefined {
  const list = asSourceList(sources);
  if (list.length === 0) return undefined;

  const classes = new Set<PublicSource>();
  for (const source of list) {
    const mapped = SOURCE_CLASSES[source];
    if (mapped) classes.add(mapped);
  }

  if (classes.size === 0) return undefined;
  return SOURCE_ORDER.filter((c) => classes.has(c));
}
