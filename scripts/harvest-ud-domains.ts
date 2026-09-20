/**
 * Unstoppable Domains corpus harvest, domain side.
 *
 * The address-side walk (harvest-ud-profiles.ts) measured its own arithmetic
 * on 2026-09-20: 300 of the graph's most-followed missing-X wallets resolved
 * to 1 domain and 0 verified handles, because this graph's population and
 * the registry's barely overlap. This script walks the registry instead, so
 * every profile read lands on a real domain and the wallets it finds are
 * ones the graph has mostly never seen.
 *
 * Pipeline, onchain enumeration plus one offchain profile read per domain:
 *  1. eth_getLogs for `NewURI(uint256 indexed tokenId, string uri)` on each
 *     registry (Ethereum CNS + UNS, Polygon UNS, Base UNS), from the
 *     registry's deploy block, adaptive windowing, checkpoint per registry.
 *  2. For each minted domain: GET /profile/public/{domain}?fields=socialAccounts
 *     (keyless, verified live 2026-09-20). Only an X entry the registry marks
 *     `verified` AND `public` survives: wallet sign-in plus platform OAuth,
 *     both halves owner-established, the same bar as the address-side script.
 *  3. For the survivors: registry.ownerOf(tokenId) via Multicall3 on the
 *     domain's own chain, at read time, so a transferred domain attributes to
 *     its current owner and a burned one drops out. The owner wallet, not the
 *     crypto.ETH.address record, because the record is a payment pointer
 *     anyone can point anywhere; ownership is what the verified flag was
 *     earned with.
 *  4. ingestLinks() under the same source id the address-side walk uses
 *     ('ud_profile'): the evidence class names the mechanism, and the
 *     mechanism is identical; which side discovered the pair is provenance.
 *
 * A custody wallet holding many domains yields many handles for one address;
 * dedupeByWallet drops contested wallets inside a run, and across runs the
 * fill-only ingest plus one conflict row per (wallet, source) keep it
 * bounded and honest.
 *
 * The registry addresses and deploy blocks come from the resolution
 * library's published config (npm, immutable), read 2026-09-20; the
 * provider's own GitHub repo went private mid-rebrand, which is the same
 * platform risk that argues for harvesting promptly.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/harvest-ud-domains.ts                    # dry run
 *   npx tsx --env-file=.env.local scripts/harvest-ud-domains.ts --commit
 *   npx tsx --env-file=.env.local scripts/harvest-ud-domains.ts --commit --max-reads 40000
 *
 * Flags:
 *   --max-reads N     profile-read budget for this run (default 2000); RPC
 *                     calls are not metered against it
 *   --registry KEY    only this registry (eth-cns | eth-uns | polygon-uns | base-uns)
 *   --from-block N    override the checkpoint for the selected registry
 *                     (requires --registry)
 */

import { ethers } from 'ethers';
import { getDb } from '../db';
import { sql } from 'drizzle-orm';
import {
  ingestLinks,
  dedupeByWallet,
  classifyLinks,
  type AttestedLink,
  type LinkSource,
} from '../lib/attested-links';

const SOURCE: LinkSource = {
  id: 'ud_profile',
  /** twitter(20) + ud_profile(25) in `calculateQualityScore`. */
  quality: 45,
};

const API = 'https://api.unstoppabledomains.com';
/** Pause per profile read, per worker. Keyless API; politeness is the limit. */
const PAUSE_MS = 250;
/** Concurrent profile readers. 3 workers at a 250ms pause is roughly 5 rps. */
const WORKERS = 3;
/** Reorg buffer, sized for the worst chain here (Polygon). */
const REORG_BUFFER = 30;

const MULTICALL3 = ethers.getAddress(
  '0xca11bde05977b3631167028862be2a173976ca11'
);

// Event signature computed, not hardcoded, so it is self-verifying: a wrong
// signature returns zero logs on ranges known to hold mints, which the dry
// run makes visible immediately.
const NEW_URI = ethers.id('NewURI(uint256,string)');
const newUriIface = new ethers.Interface([
  'event NewURI(uint256 indexed tokenId, string uri)',
]);
const registryIface = new ethers.Interface([
  'function ownerOf(uint256 tokenId) view returns (address)',
]);
const multicallIface = new ethers.Interface([
  'function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)',
]);

interface RegistryConfig {
  key: string;
  /** Registry contract, from the resolution library's published config. */
  address: string;
  deployBlock: number;
  alchemyHost: string;
  publicRpc: string;
  network: number;
}

const REGISTRIES: RegistryConfig[] = [
  {
    key: 'eth-cns',
    address: '0xD1E5b0FF1287aA9f9A268759062E4Ab08b9Dacbe',
    deployBlock: 0x8a958b,
    alchemyHost: 'eth-mainnet.g.alchemy.com',
    publicRpc: 'https://eth.llamarpc.com',
    network: 1,
  },
  {
    key: 'eth-uns',
    address: '0x049aba7510f45BA5b64ea9E658E342F904DB358D',
    deployBlock: 0xc2fede,
    alchemyHost: 'eth-mainnet.g.alchemy.com',
    publicRpc: 'https://eth.llamarpc.com',
    network: 1,
  },
  {
    key: 'polygon-uns',
    address: '0xa9a6A3626993D487d2Dbda3173cf58cA1a9D9e9f',
    deployBlock: 0x01272eb5,
    alchemyHost: 'polygon-mainnet.g.alchemy.com',
    publicRpc: 'https://polygon.drpc.org',
    network: 137,
  },
  {
    key: 'base-uns',
    address: '0xF6c1b83977DE3dEffC476f5048A0a84d3375d498',
    deployBlock: 0x01215a53,
    alchemyHost: 'base-mainnet.g.alchemy.com',
    // Not mainnet.base.org: this repo already measured it 403ing clients
    // that send no named User-Agent, which an anonymous ethers provider is.
    publicRpc: 'https://base-rpc.publicnode.com',
    network: 8453,
  },
];

function getProvider(cfg: RegistryConfig): ethers.JsonRpcProvider {
  const endpoint = process.env.ALCHEMY_KEY
    ? `https://${cfg.alchemyHost}/v2/${process.env.ALCHEMY_KEY}`
    : cfg.publicRpc;
  return new ethers.JsonRpcProvider(endpoint, cfg.network, {
    staticNetwork: true,
  });
}

interface Args {
  commit: boolean;
  maxReads: number;
  registry: string | null;
  fromBlock: number | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    commit: false,
    maxReads: 2000,
    registry: null,
    fromBlock: null,
  };
  const takesValue = new Set(['--max-reads', '--registry', '--from-block']);
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--commit') {
      args.commit = true;
      continue;
    }
    if (!takesValue.has(flag)) throw new Error(`Unknown flag: ${flag}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`${flag} needs a value`);
    }
    i++;
    if (flag === '--registry') {
      if (!REGISTRIES.some((r) => r.key === value))
        throw new Error(
          `Unknown registry: ${value} (expected ${REGISTRIES.map((r) => r.key).join(' | ')})`
        );
      args.registry = value;
    } else {
      const n = Number(value);
      if (!Number.isInteger(n) || n <= 0)
        throw new Error(`${flag} needs a positive integer`);
      if (flag === '--max-reads') args.maxReads = n;
      else args.fromBlock = n;
    }
  }
  if (args.fromBlock !== null && args.registry === null)
    throw new Error('--from-block requires --registry');
  return args;
}

// ============================================================================
// Checkpoints (ingest_state, one row per registry)
// ============================================================================

function stateKey(cfg: RegistryConfig): string {
  return `ud_domain_enum_${cfg.key}`;
}

async function getCheckpoint(cfg: RegistryConfig): Promise<number | null> {
  const db = getDb();
  if (!db) throw new Error('Database not configured');
  const result = (await db.execute(
    sql`SELECT value->>'lastBlock' AS last_block FROM ingest_state WHERE name = ${stateKey(cfg)}`
  )) as unknown as { rows: Array<{ last_block: string | null }> };
  const raw = result.rows[0]?.last_block;
  return raw ? parseInt(raw, 10) : null;
}

async function saveCheckpoint(
  cfg: RegistryConfig,
  lastBlock: number
): Promise<void> {
  const db = getDb();
  if (!db) throw new Error('Database not configured');
  await db.execute(sql`
    INSERT INTO ingest_state (name, value, updated_at)
    VALUES (${stateKey(cfg)}, jsonb_build_object('lastBlock', ${lastBlock}::bigint), now())
    ON CONFLICT (name) DO UPDATE
    SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
  `);
}

// ============================================================================
// Stage 1: NewURI log scan (adaptive window, sized by domain count)
// ============================================================================

interface MintedDomain {
  name: string;
  tokenId: string;
}

/**
 * One getLogs window. Throws on provider failure so the caller can shrink.
 */
async function fetchNewUriLogs(
  provider: ethers.JsonRpcProvider,
  cfg: RegistryConfig,
  fromBlock: number,
  toBlock: number
): Promise<MintedDomain[]> {
  const logs = (await provider.send('eth_getLogs', [
    {
      address: cfg.address,
      fromBlock: '0x' + fromBlock.toString(16),
      toBlock: '0x' + toBlock.toString(16),
      topics: [NEW_URI],
    },
  ])) as Array<{ topics: string[]; data: string }>;

  const domains: MintedDomain[] = [];
  for (const log of logs) {
    try {
      const parsed = newUriIface.parseLog({
        topics: log.topics,
        data: log.data,
      });
      if (!parsed) continue;
      const name = (parsed.args[1] as string).trim().toLowerCase();
      // A domain name reaches a URL path; refuse anything that could not be
      // one rather than encoding surprises away. Labels must not begin or
      // end with a hyphen: the registry really holds
      // -unstoppabletestdomain001.crypto, and the profile API answers 400
      // "Invalid domain" for it (found by the first probe, 2026-09-20).
      const LABEL = '[a-z0-9]([a-z0-9-]*[a-z0-9])?';
      if (!new RegExp(`^${LABEL}(\\.${LABEL})+$`).test(name)) continue;
      domains.push({
        name,
        tokenId: (parsed.args[0] as bigint).toString(),
      });
    } catch {
      // A log this interface cannot parse is not a NewURI mint.
    }
  }
  return domains;
}

// ============================================================================
// Stage 2: profile reads (the budgeted resource)
// ============================================================================

type Outcome =
  | 'invalidName'
  | 'noProfile'
  | 'noSocial'
  | 'unverified'
  | 'privateEntry'
  | 'numericId'
  | 'handle';

async function readProfile(
  domain: string
): Promise<{ handle: string | null; outcome: Outcome }> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(
      `${API}/profile/public/${encodeURIComponent(domain)}?fields=socialAccounts`,
      { headers: { Accept: 'application/json' } }
    );
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= 4)
        throw new Error(
          `UD API ${res.status} on ${domain} after ${attempt} attempts`
        );
      await new Promise((r) => setTimeout(r, attempt * 5000));
      continue;
    }
    if (res.status === 404) return { handle: null, outcome: 'noProfile' };
    // 400 is the API refusing the NAME, not failing the read: the registry
    // holds names the profile service will not parse, and one bad string
    // must not abort a window whose other domains are fine.
    if (res.status === 400) return { handle: null, outcome: 'invalidName' };
    if (!res.ok) {
      throw new Error(
        `UD API ${res.status} on ${domain}: ${(await res.text()).slice(0, 300)}`
      );
    }
    const json = (await res.json()) as {
      socialAccounts?: {
        twitter?: { location?: string; verified?: boolean; public?: boolean };
      };
    };
    const twitter = json.socialAccounts?.twitter;
    if (!twitter?.location) return { handle: null, outcome: 'noSocial' };
    if (twitter.verified !== true)
      return { handle: null, outcome: 'unverified' };
    if (twitter.public !== true)
      return { handle: null, outcome: 'privateEntry' };
    if (/^\d+$/.test(twitter.location.trim()))
      return { handle: null, outcome: 'numericId' };
    return { handle: twitter.location, outcome: 'handle' };
  }
}

/** A small worker pool: WORKERS readers, each pausing PAUSE_MS per read. */
async function readProfiles(
  domains: MintedDomain[],
  counts: Record<Outcome, number>
): Promise<Array<{ domain: MintedDomain; handle: string }>> {
  const hits: Array<{ domain: MintedDomain; handle: string }> = [];
  let next = 0;
  async function worker() {
    while (next < domains.length) {
      const domain = domains[next++];
      const { handle, outcome } = await readProfile(domain.name);
      counts[outcome]++;
      if (handle) hits.push({ domain, handle });
      await new Promise((r) => setTimeout(r, PAUSE_MS));
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(WORKERS, domains.length) }, worker)
  );
  return hits;
}

// ============================================================================
// Stage 3: current owner via Multicall3, on the domain's own chain
// ============================================================================

async function multicallAdaptive(
  provider: ethers.JsonRpcProvider,
  calls: Array<{ target: string; callData: string }>,
  attempt = 0
): Promise<Array<{ success: boolean; returnData: string }>> {
  try {
    const data = multicallIface.encodeFunctionData('aggregate3', [
      calls.map((c) => ({
        target: c.target,
        allowFailure: true,
        callData: c.callData,
      })),
    ]);
    const raw = await provider.call({ to: MULTICALL3, data });
    const [results] = multicallIface.decodeFunctionResult('aggregate3', raw);
    return (results as Array<[boolean, string]>).map(
      ([success, returnData]) => ({ success, returnData })
    );
  } catch (error) {
    if (calls.length === 1) {
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        return multicallAdaptive(provider, calls, attempt + 1);
      }
      // Propagate: the window aborts and the checkpoint stays put, so these
      // domains are read again rather than silently dropped.
      throw error;
    }
    const mid = Math.floor(calls.length / 2);
    const [left, right] = await Promise.all([
      multicallAdaptive(provider, calls.slice(0, mid), attempt),
      multicallAdaptive(provider, calls.slice(mid), attempt),
    ]);
    return [...left, ...right];
  }
}

/**
 * Addresses that hold tokens as infrastructure, never as an owner. A CNS
 * domain migrated to UNS is locked in the UNS registry rather than burned,
 * so its CNS ownerOf answers with the registry contract; binding a verified
 * handle to that address would be a link to plumbing. Dropping it loses
 * nothing: the migration minted the same domain on a UNS registry, whose own
 * NewURI walk finds it with the real owner.
 */
const INFRA_ADDRESSES: ReadonlySet<string> = new Set(
  REGISTRIES.map((r) => r.address.toLowerCase())
);

async function resolveOwners(
  provider: ethers.JsonRpcProvider,
  cfg: RegistryConfig,
  hits: Array<{ domain: MintedDomain; handle: string }>,
  onInfraOwner: () => void
): Promise<AttestedLink[]> {
  const links: AttestedLink[] = [];
  const BATCH = 250;
  for (let i = 0; i < hits.length; i += BATCH) {
    const batch = hits.slice(i, i + BATCH);
    const results = await multicallAdaptive(
      provider,
      batch.map((h) => ({
        target: cfg.address,
        callData: registryIface.encodeFunctionData('ownerOf', [
          BigInt(h.domain.tokenId),
        ]),
      }))
    );
    for (let j = 0; j < batch.length; j++) {
      const r = results[j];
      // ownerOf reverts for a burned token; allowFailure surfaces that as
      // success=false and the domain simply drops out.
      if (!r.success || r.returnData === '0x') continue;
      try {
        const [owner] = registryIface.decodeFunctionResult(
          'ownerOf',
          r.returnData
        );
        if (owner && owner !== ethers.ZeroAddress) {
          const wallet = (owner as string).toLowerCase();
          if (INFRA_ADDRESSES.has(wallet)) {
            onInfraOwner();
            continue;
          }
          links.push({ wallet, handle: batch[j].handle });
        }
      } catch {
        // Non-conforming return data: skip the domain, keep the run.
      }
    }
  }
  return links;
}

// ============================================================================
// Orchestration
// ============================================================================

interface Totals {
  windows: number;
  domains: number;
  reads: number;
  links: number;
  /** Verified handles whose token sits in a registry contract (migration lock). */
  infraOwners: number;
  counts: Record<Outcome, number>;
}

async function walkRegistry(
  cfg: RegistryConfig,
  args: Args,
  totals: Totals,
  remainingReads: () => number
): Promise<'exhausted' | 'budget'> {
  const provider = getProvider(cfg);
  const head = await provider.getBlockNumber();
  const target = head - REORG_BUFFER;

  const checkpoint = await getCheckpoint(cfg);
  let block =
    (args.registry === cfg.key ? args.fromBlock : null) ??
    (checkpoint !== null ? checkpoint + 1 : cfg.deployBlock);

  console.log(
    `[${cfg.key}] from block ${block.toLocaleString()} to ${target.toLocaleString()}` +
      (checkpoint !== null
        ? ` (checkpoint was ${checkpoint.toLocaleString()})`
        : ' (backfill start)')
  );

  // Window sized by the budgeted resource: the profile reads its mints will
  // cost, not the block count. Dense mint ranges shrink it, quiet ones grow it.
  let window = 5_000;
  const MIN_WINDOW = 10;
  const MAX_WINDOW = 200_000;

  while (block <= target) {
    if (remainingReads() <= 0) return 'budget';
    const upper = Math.min(block + window - 1, target);

    let domains: MintedDomain[];
    try {
      domains = await fetchNewUriLogs(provider, cfg, block, upper);
    } catch {
      if (window <= MIN_WINDOW)
        throw new Error(
          `[${cfg.key}] eth_getLogs failing at minimum window (block ${block})`
        );
      window = Math.max(Math.floor(window / 2), MIN_WINDOW);
      continue;
    }

    // A window whose mints exceed the remaining budget is not started: it
    // shrinks until it fits or the run ends here, and the checkpoint never
    // moves past a domain nobody read.
    if (domains.length > remainingReads()) {
      if (window > MIN_WINDOW) {
        window = Math.max(Math.floor(window / 2), MIN_WINDOW);
        continue;
      }
      return 'budget';
    }

    if (domains.length > 0) {
      const hits = await readProfiles(domains, totals.counts);
      totals.reads += domains.length;
      totals.domains += domains.length;

      if (hits.length > 0) {
        const links = await resolveOwners(provider, cfg, hits, () => {
          totals.infraOwners++;
        });
        totals.links += links.length;
        if (args.commit && links.length > 0) {
          await ingestLinks(links, SOURCE);
        } else if (!args.commit && links.length > 0) {
          const { links: deduped, contested, rejected } = dedupeByWallet(links);
          const classified = await classifyLinks(deduped);
          console.log(
            `[${cfg.key}] would ingest:`,
            JSON.stringify({
              links: deduped.length,
              contested,
              rejected,
              ...classified,
            })
          );
        }
      }
    }

    totals.windows++;
    if (args.commit) await saveCheckpoint(cfg, upper);
    block = upper + 1;

    if (domains.length < 200) window = Math.min(window * 2, MAX_WINDOW);
    else if (domains.length > 800)
      window = Math.max(Math.floor(window / 2), MIN_WINDOW);

    if (totals.windows % 20 === 0) {
      console.log(
        `[${cfg.key}] block ${upper.toLocaleString()} | ${totals.domains.toLocaleString()} domains | ` +
          `${totals.counts.handle} verified handles | ${totals.links} links | ${totals.reads} reads`
      );
    }
  }
  return 'exhausted';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  if (!process.env.ALCHEMY_KEY) {
    console.log(
      'ALCHEMY_KEY not set: using public RPC endpoints, which cap getLogs harder.'
    );
  }

  const registries = args.registry
    ? REGISTRIES.filter((r) => r.key === args.registry)
    : REGISTRIES;

  console.log(
    `${args.commit ? 'COMMIT' : 'dry run'}: ${registries.map((r) => r.key).join(', ')}, ` +
      `budget ${args.maxReads} profile reads`
  );

  const totals: Totals = {
    windows: 0,
    domains: 0,
    reads: 0,
    links: 0,
    infraOwners: 0,
    counts: {
      invalidName: 0,
      noProfile: 0,
      noSocial: 0,
      unverified: 0,
      privateEntry: 0,
      numericId: 0,
      handle: 0,
    },
  };
  const remainingReads = () => args.maxReads - totals.reads;

  let stopped: 'exhausted' | 'budget' = 'exhausted';
  for (const cfg of registries) {
    stopped = await walkRegistry(cfg, args, totals, remainingReads);
    if (stopped === 'budget') break;
  }

  const c = totals.counts;
  console.log(
    `\nDomains: ${totals.domains.toLocaleString()} read, ${c.invalidName} invalid names (400), ` +
      `${c.noProfile} without a profile, ` +
      `${c.noSocial} without socials, ${c.unverified} unverified (skipped), ` +
      `${c.privateEntry} private (skipped), ${c.numericId} numeric-id (skipped), ` +
      `${c.handle} with a verified handle, ${totals.infraOwners} lock-held (dropped), ${totals.links} owner links`
  );
  console.log(
    stopped === 'budget'
      ? `Read budget (${args.maxReads}) reached; re-run to continue from the checkpoints.`
      : 'All selected registries walked to the chain head.'
  );
  if (!args.commit) {
    console.log(
      '\nDry run: nothing written, no checkpoints saved. Re-run with --commit.'
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
