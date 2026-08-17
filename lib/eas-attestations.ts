/**
 * Wallet-to-X links published as onchain attestations.
 *
 * Two schemas, on two chains, read through one adapter because the only thing
 * that differs is which field holds the handle.
 *
 * ## Why this source is worth having despite its size
 *
 * Measured on 2026-08-16: 6,643 distinct addresses across all four
 * schema/chain combinations, of which **86.3% were not in our graph at all**.
 * That was the surprise. These are crypto-native users and the graph already
 * holds 4.7 million Farcaster wallets, so the expectation was heavy overlap.
 * Instead the populations barely touch, and the net gain is 6,004 X handles.
 *
 * The other reason is legal rather than numeric. This is chain state. There is
 * no API to accept terms for, no key to hold, no rate limit to respect and no
 * provider who can revoke us. Every other pool of this size that we found was
 * either forbidden by its terms or behind a key.
 *
 * ## Why `attested-social` and not `onchain`
 *
 * The record is onchain, but `onchain` in our vocabulary means the address owner
 * published it themselves, which is what an ENS text record is. Here a third
 * party attests: the owner proved their X account to a service, and the service
 * wrote the attestation. That is the same trust model as any identity platform,
 * so it takes the same class. The storage medium is not the evidence.
 *
 * ## The GraphQL explorer is a convenience, not a dependency
 *
 * easscan is a hosted index over events any RPC can serve. It went to 504 during
 * testing. If it stays down, the same attestations are readable with
 * `eth_getLogs` against the EAS contract, and nothing about the data changes.
 */
import { ingestLinks, type AttestedLink, type LinkSource } from './attested-links';

/**
 * Deliberately does not name a vendor. The public class is `attested-social`,
 * and this internal id follows the same rule for the same reason: the mapping in
 * `lib/api-sources.ts` is an allowlist, and a leak here would be a leak there.
 */
const SOURCE: LinkSource = {
  id: 'eas',
  /** twitter(20) + eas(25) in `calculateQualityScore`. */
  quality: 45,
};

interface SchemaSource {
  label: string;
  endpoint: string;
  schemaId: string;
  /** Which decoded field carries the handle, and how to tell it is an X handle. */
  shape: 'provider-identity' | 'twitter-handle';
}

/**
 * The four combinations, each verified live before being listed here.
 *
 * `provider-identity` is a general social-verification schema
 * (`bytes32 node, string provider, string identity, string displayName,
 * bytes proof`) whose rows also cover Discord, Google, GitHub and LinkedIn, so
 * the provider field has to be checked rather than assumed.
 *
 * `twitter-handle` is CyberConnect's cyberID schema
 * (`string cyberID, string twitterHandle, string profileLink, address issuer`),
 * which is X-only by construction.
 */
const SCHEMAS: SchemaSource[] = [
  {
    label: 'verified-social (Optimism)',
    endpoint: 'https://optimism.easscan.org/graphql',
    schemaId: '0xe038cd96af4cfe0ab2b4b2218a1f3fd3a7c67b65a5de538fa2cf445b9ceab681',
    shape: 'provider-identity',
  },
  {
    label: 'verified-social (Base)',
    endpoint: 'https://base.easscan.org/graphql',
    schemaId: '0xe038cd96af4cfe0ab2b4b2218a1f3fd3a7c67b65a5de538fa2cf445b9ceab681',
    shape: 'provider-identity',
  },
  {
    label: 'cyberID (Base)',
    endpoint: 'https://base.easscan.org/graphql',
    schemaId: '0xcfcf329b79035809704e8d33780714ddf7815a06490a94d57fac562937edbcef',
    shape: 'twitter-handle',
  },
  {
    label: 'cyberID (Optimism)',
    endpoint: 'https://optimism.easscan.org/graphql',
    schemaId: '0xcfcf329b79035809704e8d33780714ddf7815a06490a94d57fac562937edbcef',
    shape: 'twitter-handle',
  },
];

const PAGE = 100;
const PAGE_DELAY_MS = 150;
/** A stop, not a target. The largest schema held 9,403 rows when measured. */
const MAX_PAGES = 400;

const ZERO = '0x' + '0'.repeat(40);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface EasSweepStats {
  schemasRead: number;
  schemasFailed: number;
  /** Schemas read only in part. Coverage is short by an unknown amount. */
  schemasPartial: number;
  attestations: number;
  links: number;
  contested: number;
  rejected: number;
  newWallets: number;
  filled: number;
  agree: number;
  conflicts: number;
}

interface Attestation {
  recipient: string;
  decodedDataJson: string;
}

/**
 * A handle a person could actually be contacted at.
 *
 * X allows letters, digits and underscore, up to 15 characters. Anything else in
 * this field is a display name, a URL, an email that landed in the wrong schema,
 * or junk, and writing it would produce a link nobody can follow.
 */
const isPlausibleHandle = (h: string) => /^[A-Za-z0-9_]{1,15}$/.test(h);

function linkFrom(a: Attestation, shape: SchemaSource['shape']): AttestedLink | null {
  const wallet = String(a.recipient ?? '').toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(wallet) || wallet === ZERO) return null;

  let decoded: Record<string, unknown>;
  try {
    decoded = Object.fromEntries(
      (JSON.parse(a.decodedDataJson) as Array<{ name: string; value?: { value?: unknown } }>).map(
        (f) => [f.name, f.value?.value]
      )
    );
  } catch {
    return null;
  }

  let raw: unknown;
  if (shape === 'twitter-handle') {
    raw = decoded.twitterHandle;
  } else {
    // The provider field decides. Rows for Discord, Google, GitHub and LinkedIn
    // share this schema, and taking `identity` without checking would file a
    // Gmail address as an X handle.
    const provider = String(decoded.provider ?? '').toLowerCase();
    if (provider !== 'com.twitter' && provider !== 'twitter') return null;
    raw = decoded.identity;
  }

  if (typeof raw !== 'string') return null;
  const handle = raw.trim().replace(/^@/, '');
  if (!isPlausibleHandle(handle)) return null;

  // No account id: neither schema carries one. The id field stays null rather
  // than being filled with the attestation uid, which identifies the record and
  // not the account.
  return { wallet, handle, twitterUserId: null };
}

/** Page one schema. Returns null if it could not be read at all. */
async function readSchema(
  s: SchemaSource
): Promise<{ links: AttestedLink[]; rows: number; partial: boolean } | null> {
  const links: AttestedLink[] = [];
  let rows = 0;
  let skip = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    let batch: Attestation[] | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(s.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: `{ attestations(where:{schemaId:{equals:"${s.schemaId}"}, revoked:{equals:false}}, take:${PAGE}, skip:${skip}, orderBy:{time:desc}){ recipient decodedDataJson } }`,
          }),
        });
        if (!res.ok) {
          await sleep(1000 * (attempt + 1));
          continue;
        }
        const body = (await res.json()) as { data?: { attestations?: Attestation[] } };
        batch = body?.data?.attestations ?? null;
        break;
      } catch {
        await sleep(1000 * (attempt + 1));
      }
    }

    // Page zero failing means the schema was never read; a later page failing
    // means partial coverage. Both are reported rather than silently accepted.
    // Page zero failing means the schema was never read; a later page failing
    // means partial coverage. Both are reported, and `partial` matters: without
    // it a schema that died halfway counted as read and the cron returned 200
    // on an incomplete sweep.
    if (batch === null) return page === 0 ? null : { links, rows, partial: true };
    if (batch.length === 0) break;

    rows += batch.length;
    for (const a of batch) {
      const link = linkFrom(a, s.shape);
      if (link) links.push(link);
    }
    skip += PAGE;
    await sleep(PAGE_DELAY_MS);
  }

  return { links, rows, partial: false };
}

/**
 * Read every schema and merge what they hold.
 *
 * The same person appears in more than one of these, and the same address can
 * appear on both chains, so the union is much smaller than the sum: 6,643
 * distinct addresses from roughly 9,800 attestations when measured. The shared
 * ingest deduplicates and drops anything two accounts both claim.
 */
export async function sweepEasAttestations(
  onProgress?: (msg: string) => void
): Promise<EasSweepStats> {
  const all: AttestedLink[] = [];
  let attestations = 0;
  let schemasRead = 0;
  let schemasFailed = 0;
  let schemasPartial = 0;

  for (const schema of SCHEMAS) {
    const result = await readSchema(schema);
    if (!result) {
      schemasFailed++;
      onProgress?.(`EAS: ${schema.label} could not be read`);
      continue;
    }
    schemasRead++;
    if (result.partial) schemasPartial++;
    attestations += result.rows;
    all.push(...result.links);
    onProgress?.(`EAS: ${schema.label}: ${result.rows} attestations, ${result.links.length} links`);
  }

  if (schemasRead === 0) throw new Error('EAS sweep: no schema could be read');

  const ingested = await ingestLinks(all, SOURCE);
  onProgress?.(
    `EAS: ${ingested.links} links, ${ingested.newWallets} new wallets, ` +
      `${ingested.filled} filled, ${ingested.agree} agree, ${ingested.conflicts} conflicts`
  );

  return {
    schemasRead,
    schemasFailed,
    schemasPartial,
    attestations,
    links: ingested.links,
    contested: ingested.contested,
    rejected: ingested.rejected,
    newWallets: ingested.newWallets,
    filled: ingested.filled,
    agree: ingested.agree,
    conflicts: ingested.conflicts,
  };
}
