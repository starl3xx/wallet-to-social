/**
 * Basename text-record harvest: onchain `com.twitter` records on Base L2 to
 * `social_graph`.
 *
 * A basename is a `<label>.base.eth` name registered on Base. Its owner can
 * write text records against it, and one of the keys is `com.twitter`. The
 * wallet side of the pair is owner-published onchain, exactly as an ENS text
 * record is; the handle beside it is unverified free text the owner typed. So
 * the evidence class is the same CORRELATED class `ens_onchain` already
 * carries, and the score is the same 50, deliberately below the 70 trust line.
 * See `lib/ens-harvest.ts` for the L1 twin.
 *
 * ## Why this is a sibling module rather than a parameter on the ENS harvest
 *
 * Nothing in `lib/ens-harvest.ts` is parameterised by chain, and four of its
 * stages have no counterpart here: there is no ethers ENS plugin for Base to
 * read a registry address from, the 3-argument `TextChanged` signature has
 * never fired on either Basenames resolver (measured: zero logs, whole chain),
 * L1 names stop resolving when they expire and basenames do not, and the label
 * a basename's expiry is keyed on cannot be derived from the node. The two
 * files share a shape, not a code path.
 *
 * ## The pipeline, entirely onchain over our own RPC
 *
 * 1. `eth_getLogs` for the 4-argument `TextChanged`, filtered to the two
 *    Basenames resolvers AND to the `com.twitter` key hash. Adaptive window.
 *    The log is used ONLY to enumerate candidate nodes: its inline value is
 *    read back from the name's CURRENT resolver instead, because a name moved
 *    between the two resolvers still carries the old resolver's log while the
 *    record it points at is gone (measured: 4 of 241 nodes in a recent window,
 *    and the register's wider sample put it at 5%).
 * 2. Per node, through Multicall3: the registry's current resolver, then
 *    `addr(node)` and `text(node, 'com.twitter')` on it.
 * 3. Normalise the raw record, and REJECT rather than repair what fails.
 * 4. Recover the label through the ENSIP-19 base reverse record, so the
 *    registrar's expiry can be read at all.
 * 5. Drop expired names, and names whose record predates their current
 *    registration.
 * 6. Hand the survivors to the shared attested-link ingest
 *    (`lib/attested-links.ts`), which owns fill-only, the agreement gate,
 *    conflict recording and the quality contract.
 *
 * ## Two filters this pipeline cannot ship without
 *
 * **Expiry.** An expired basename keeps resolving: the registry still names a
 * resolver, `addr(node)` still returns an address and the text records are
 * still readable. Registry `owner(node)` is not a test either, since it stays
 * stale after expiry. Harvesting unfiltered emits pairs for names anybody can
 * buy today.
 *
 * Measured rather than argued: in blocks 20,300,000 to 20,340,000 alone, 53
 * expired names still served a non-empty `com.twitter`, among them
 * `metawolf.base.eth` holding `metaawolff` and `web3titan.base.eth` holding
 * `web3_Titan`. Every one was dropped by this filter. A uniform sample of the
 * whole corpus put the expired share at 44.5%, and `drops.expired` is the
 * number that reports it, which is why an unreadable expiry is counted
 * separately: see `expiryUnreadable`.
 *
 * **Registration recency.** Re-registering does not clear the old owner's
 * records: `RegistrarController._register` optionally writes the NEW owner's
 * records and clears nothing. So a lapsed-then-reclaimed name can carry the
 * previous owner's `com.twitter` beside the new owner's `addr`, and it passes
 * the expiry test because re-registration reset the expiry. Measured on 222
 * live sampled names: 8 registered more than once, 4 holding a record older
 * than their current registration. In all four the reclaimer was the same
 * person, so the observed misattribution is zero, but the mechanism is real
 * and the guard costs one log query per 100 names.
 *
 * ## The label problem, and what it costs
 *
 * `nameExpires` is keyed on the LABELHASH and the node is
 * `keccak256(parentNode + labelhash)`, which is one-way. The label is
 * recovered through the base reverse record instead: `addr(node)`, then the
 * ENSIP-19 reverse node for that address, then `name()` on its resolver, kept
 * only when the node rebuilt from its RAW label equals the node we started
 * from and the name is a direct child of `base.eth`. That last check is what
 * makes the recovery safe: an address whose primary name is a DIFFERENT name
 * of theirs fails it and is dropped rather than expiry-checked against the
 * wrong label. It must be `rawBaseNode` and never `ethers.namehash`, for the
 * reasons set out on that function.
 *
 * It covers about 88% of nodes (measured: 206 of 233 in a live window, and 445
 * of 500 in the register's uniform sample). The uncovered remainder is dropped,
 * which is the conservative direction: an unexpiry-checkable name is exactly
 * the one the filter above exists for.
 *
 * ## Two limits of the class, stated rather than implied
 *
 * Both are inherited from `ens_onchain`, which reads its records the same way,
 * so neither is a regression. They are written down because a filter list that
 * names only what IS checked reads like a guarantee.
 *
 * **The emitted wallet is `addr(node)`, not the name's owner.** Only the owner
 * can write `addr`, so the record is still owner-published, but nothing stops
 * an owner pointing `addr` at a third party's wallet while `com.twitter` names
 * their own handle. Measured: of 20 emitted pairs re-derived from chain state,
 * 19 had `owner(node)` equal to the emitted address and one did not.
 *
 * **Nothing enforces one wallet per handle.** `dedupeByWallet` drops an
 * address two handles both claim; the other direction is unguarded, and in one
 * 942-pair window three handles were each claimed by two different basenames.
 * Fill-only ingest means such a pair cannot overwrite an existing row and the
 * disagreeing half becomes a `handle_conflicts` row, so the exposure is a
 * second wallet acquiring a handle only where the row was previously empty.
 *
 * ## Removal
 *
 * Pairs naming a suppressed wallet or handle are dropped before ingest, by
 * `dropSuppressed`. The database triggers are the backstop underneath it and
 * are NOT sufficient alone: the reason is on that function, and it is a case
 * where relying on the trigger would attach this source's name to a handle it
 * never attested.
 *
 * ## Scope: `com.twitter` only
 *
 * `com.github` and `xyz.farcaster` are written against basenames too (19,482
 * and 28,344 nodes hold a value), and neither can travel through this pipe:
 * `AttestedLink` carries a wallet, an X handle and an X account id, and has no
 * field for either. Adding them means a second writer with its own upsert, not
 * a wider scan here, so this module reads one key and says so rather than
 * collecting values it would have to drop at the end.
 */
import { ethers } from 'ethers';
import { getDb } from '@/db';
import { sql } from 'drizzle-orm';
import {
  classifyLinks,
  dedupeByWallet,
  ingestLinks,
  type AttestedLink,
  type LinkSource,
} from './attested-links';
import { loadSuppressionList, isKindSuppressed } from './suppression';

const SOURCE: LinkSource = {
  /**
   * Names a public naming protocol on a public chain, not a vendor, which is
   * the rule `lib/eas-attestations.ts` states for the internal id as much as
   * for the public class.
   */
  id: 'basename_record',
  /**
   * twitter(20) + basename_record(30) in `calculateQualityScore`, matching
   * `ens_onchain`: the same evidence mechanism on a different chain. It is
   * below the 70 trust line because the Farcaster side of these wallets has
   * never been checked, and it must de-stack against `ens` and `ens_onchain`
   * for the same reason those two de-stack against each other.
   */
  quality: 50,
};

/**
 * The earliest block worth scanning.
 *
 * Measured, not assumed: the first 4-argument `TextChanged` of ANY key on
 * either Basenames resolver is block 17,577,149 (2024-07-25), and a full-range
 * query below it returns zero logs. Rounded down to leave room for a re-measure
 * that finds something slightly earlier.
 */
export const BASENAMES_SCAN_START_BLOCK = 17_500_000;

/**
 * Both Basenames resolvers, and the address filter is load-bearing.
 *
 * An unrelated naming system at 0x26e2b33ed616fb9a486884348553a8aff93141e8
 * emits the same `TextChanged` on Base with `.rockets.app` values in it, so an
 * address-free scan for this topic picks up nodes that are not basenames at
 * all (measured: 19 of 84 events in one window). Never scan Base
 * `TextChanged` without this filter.
 *
 * Both are live in production, so both must be scanned: of 400 sampled nodes
 * 268 currently resolve through the legacy resolver and 132 through the
 * upgradeable proxy.
 */
const RESOLVERS = [
  /** L2Resolver, the original. */
  '0xC6d566A56A1aFf6508b41f6c90ff131615583BCD',
  /** UpgradeableL2Resolver, the proxy names have been migrating to. */
  '0x426fA03fB86E510d0Dd9F70335Cf102a98b10875',
];

/** Basenames registry, and the registrar the expiry lives on. */
const REGISTRY = '0xB94704422c2a1E396835A571837Aa5AE53285a95';
const BASE_REGISTRAR = '0x03c4738Ee98aE44591e1A4A4F3CaB6641d95DD9a';
/** Canonical Multicall3, verified deployed at the same address on Base. */
const MULTICALL3 = ethers.getAddress(
  '0xca11bde05977b3631167028862be2a173976ca11'
);

/**
 * Hashes and topics, computed rather than pasted, so they are self-verifying.
 *
 * Only the 4-argument signature is scanned. The 3-argument one is not an
 * oversight: a single whole-chain query for it against both resolvers returns
 * an empty array, so filtering on both would cost a wider topic filter for
 * nothing.
 */
const TEXT_CHANGED_4 = ethers.id('TextChanged(bytes32,string,string,string)');
const KEY_TWITTER = ethers.id('com.twitter');
/**
 * The two registrar events that (re)establish ownership. `NameRenewed` is
 * deliberately absent: extending a registration does not change who owns the
 * name, so it cannot invalidate a record written before it.
 */
const NAME_REGISTERED = ethers.id('NameRegistered(uint256,address,uint256)');
const NAME_REGISTERED_WITH_RECORD = ethers.id(
  'NameRegisteredWithRecord(uint256,address,uint256,address,uint64)'
);
/**
 * ENSIP-19 reverse namespace for Base (chain id 8453, so `80002105.reverse`).
 * `addr.reverse` is the L1 spelling and has no resolver on Base: verified live,
 * the registry returns the zero address for the `addr.reverse` node of an
 * address whose base reverse record resolves fine.
 */
const BASE_REVERSE_NODE = ethers.namehash('80002105.reverse');

/**
 * The `base.eth` node, the parent every basename hangs off.
 *
 * Safe to compute with `namehash` because the string is a constant written
 * here and already normalised. Nothing read off the chain goes through
 * `namehash`: see `rawLabelhash` below for why.
 */
const BASE_ETH_NODE = ethers.namehash('base.eth');

/**
 * Hash a label the way the Basenames contracts do: `keccak256` over the RAW
 * label bytes, with no normalisation of any kind.
 *
 * **`ethers.namehash` is the wrong tool here and it fails silently.** It
 * applies ENSIP-15 normalisation, which lowercases, and the Basenames
 * registrar does not: `RegistrarController.valid()` checks length alone, so
 * `SemperAltius` and `semperaltius` are two separately registerable names with
 * two different nodes and two different expiries. Verified on Base mainnet
 * 2026-09-02: `nameExpires(keccak256('SemperAltius'))` is 2025-09-09 while
 * `nameExpires(keccak256('semperaltius'))` is 0; `DaanCrypto` expires
 * 2025-09-10 and `daancrypto` 2025-09-03; `Loopify` 2025-09-10 and `loopify`
 * 2025-08-22. Three pairs of distinct registrations that `namehash` collapses
 * into one. The registry agrees: `resolver(rawNode('SemperAltius'))` is the
 * live L2Resolver holding that name's `addr`, and
 * `resolver(namehash('SemperAltius.base.eth'))` is the zero address, a node
 * that does not exist.
 *
 * Using `namehash` therefore broke the expiry filter in both directions. It
 * over-dropped, discarding every mixed-case basename as unrecoverable, and it
 * failed OPEN on the mandatory filter: where the lowercase twin happened to
 * resolve to the same address, the node matched but the expiry was then read
 * for a DIFFERENT registration, so an owner could keep an expired name's
 * record alive forever by registering the case variant.
 *
 * It is also why no string read from the chain is ever passed to `namehash`.
 * `namehash` THROWS on any label ENSIP-15 rejects (`a_b`, `ab_`, `xn--ls8h`),
 * and the Base reverse registrar does not validate the string it stores, so
 * one `setName` transaction could have killed every subsequent run.
 */
const rawLabelhash = (label: string): string =>
  ethers.keccak256(ethers.toUtf8Bytes(label));

/** The registry node for `<label>.base.eth`, from the raw label. */
const rawBaseNode = (label: string): string =>
  ethers.keccak256(ethers.concat([BASE_ETH_NODE, rawLabelhash(label)]));

/**
 * The same derivation, exported so `scripts/check-invariants.ts` can assert it
 * against real registrations rather than restate it. Kept as a thin alias so
 * the assertion tests the function the pipeline actually uses.
 */
export const rawBaseNodeForLabel = rawBaseNode;

const REGISTRY_ABI = ['function resolver(bytes32 node) view returns (address)'];
const RESOLVER_ABI = [
  'function text(bytes32 node, string key) view returns (string)',
  'function addr(bytes32 node) view returns (address)',
  'function name(bytes32 node) view returns (string)',
];
const REGISTRAR_ABI = [
  'function nameExpires(uint256 id) view returns (uint256)',
];
const MULTICALL_ABI = [
  'function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)',
];

const registryIface = new ethers.Interface(REGISTRY_ABI);
const resolverIface = new ethers.Interface(RESOLVER_ABI);
const registrarIface = new ethers.Interface(REGISTRAR_ABI);
const multicallIface = new ethers.Interface(MULTICALL_ABI);

/** Nodes resolved per Multicall3 round. What the ENS harvest settled on. */
const NODE_BATCH = 250;
/** Labelhashes per registrar log query. 100 returns ~120 logs, far under any cap. */
const REGISTRATION_LABELS_PER_CALL = 100;
/** Blocks per checkpoint. About 23 days of Base, so an interrupt is cheap. */
const CHUNK_BLOCKS = 1_000_000;
/**
 * Blocks left unscanned at the head. Base produces a block every 2 seconds, so
 * the ENS harvest's 10-block L1 buffer would be 20 seconds here. 300 blocks is
 * about 10 minutes, and over-buffering costs nothing: the next run picks the
 * range up.
 */
const REORG_BUFFER_BLOCKS = 300;

const STATE_KEY = 'basename_record_harvest';

/**
 * A default urllib User-Agent gets HTTP 403 from `mainnet.base.org`
 * (Cloudflare 1010, a banned client signature) while curl passes unchanged.
 * Node's fetch is not urllib, but an anonymous client on a public endpoint is
 * the shape that gets banned, so this names itself. A 403 wall would look
 * exactly like an empty corpus.
 */
const USER_AGENT = 'walletlink-basenames-harvest/1.0';

// ============================================================================
// RPC
// ============================================================================

/**
 * A JSON-RPC error the node returned, as opposed to a transport failure.
 *
 * The two need different handling and the distinction is the whole reason this
 * class exists: `eth_getLogs` answering "that range is too wide" is information
 * the window loop acts on, while a socket that dropped is something to retry.
 */
class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string
  ) {
    super(message);
    this.name = 'RpcError';
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function rpcUrl(): string {
  const key = process.env.ALCHEMY_KEY;
  return key
    ? `https://base-mainnet.g.alchemy.com/v2/${key}`
    : 'https://mainnet.base.org';
}

/** True when the RPC allows a log query wider than 10,000 blocks. */
function hasWideLogRange(): boolean {
  return !!process.env.ALCHEMY_KEY;
}

/**
 * One JSON-RPC call. Transport failures retry with backoff and then throw; a
 * JSON-RPC error body throws immediately as an `RpcError`, because retrying a
 * request the node understood and refused just refuses again.
 *
 * **The `RpcError` path does not fire for the two range refusals it reads as
 * though it were written for, and that is measured rather than assumed.**
 * `mainnet.base.org` answers an over-wide range with HTTP 413 and Alchemy with
 * HTTP 400, both carrying the JSON-RPC error in the body. This function tests
 * `!res.ok` BEFORE parsing, so both are classified as transport failures and
 * retried three times before the caller halves its window.
 *
 * The outcome is still correct, because `scanTextChangedLogs` halves and
 * proceeds either way; the cost is three wasted requests and about three
 * seconds per over-wide window, during a backfill only. Left as it is
 * deliberately: parsing a body on every non-2xx to reclassify it would change
 * error handling on the one path where being wrong is expensive, to save
 * requests on a path that already converges. Recorded here rather than fixed,
 * so the comment above is not read as describing what happens.
 */
async function rpc(method: string, params: unknown[]): Promise<unknown> {
  let lastTransportError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(rpcUrl(), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': USER_AGENT,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      if (!res.ok) {
        lastTransportError = new Error(`Base RPC HTTP ${res.status}`);
        await sleep(500 * (attempt + 1));
        continue;
      }
      const body = (await res.json()) as {
        result?: unknown;
        error?: { code?: number; message?: string };
      };
      if (body.error) {
        throw new RpcError(
          body.error.code ?? 0,
          body.error.message ?? 'unknown RPC error'
        );
      }
      return body.result ?? null;
    } catch (error) {
      if (error instanceof RpcError) throw error;
      lastTransportError = error;
      await sleep(500 * (attempt + 1));
    }
  }
  throw new Error(
    `Base RPC ${method} failed after 3 attempts: ${String(lastTransportError)}`
  );
}

async function multicall(
  calls: Array<{ target: string; callData: string }>
): Promise<Array<{ success: boolean; returnData: string }>> {
  const data = multicallIface.encodeFunctionData('aggregate3', [
    calls.map((c) => ({
      target: c.target,
      allowFailure: true,
      callData: c.callData,
    })),
  ]);
  const raw = (await rpc('eth_call', [
    { to: MULTICALL3, data },
    'latest',
  ])) as string;
  const [results] = multicallIface.decodeFunctionResult('aggregate3', raw);
  return (results as Array<[boolean, string]>).map(([success, returnData]) => ({
    success,
    returnData,
  }));
}

/**
 * Multicall with adaptive splitting, on the same error doctrine as the ENS
 * harvest: `allowFailure` means an inner revert never throws, so a THROWN
 * `eth_call` is a provider problem (gas cap, rate limit, outage) rather than a
 * contract saying no. A batch that fails is halved and retried; a single call
 * that keeps failing PROPAGATES, so the chunk aborts and the checkpoint does
 * not advance past a node we never read.
 */
async function multicallAdaptive(
  calls: Array<{ target: string; callData: string }>,
  attempt = 0
): Promise<Array<{ success: boolean; returnData: string }>> {
  if (calls.length === 0) return [];
  try {
    return await multicall(calls);
  } catch (error) {
    if (calls.length === 1) {
      if (attempt < 3) {
        await sleep(1500 * (attempt + 1));
        return multicallAdaptive(calls, attempt + 1);
      }
      throw error;
    }
    const mid = Math.floor(calls.length / 2);
    const [left, right] = await Promise.all([
      multicallAdaptive(calls.slice(0, mid)),
      multicallAdaptive(calls.slice(mid)),
    ]);
    return [...left, ...right];
  }
}

/** Decode one aggregate3 result, or null if the inner call failed or was empty. */
function decodeCall(
  iface: ethers.Interface,
  fn: string,
  result: { success: boolean; returnData: string } | undefined
): unknown {
  if (!result || !result.success || result.returnData === '0x') return null;
  try {
    return iface.decodeFunctionResult(fn, result.returnData)[0];
  } catch {
    // A non-conforming resolver. Skip it rather than guess at the bytes.
    return null;
  }
}

/**
 * The three shapes a decoded result is narrowed to. They are checks rather than
 * casts on purpose: `decodeFunctionResult` is typed as `any` at the element
 * level, so a cast here would assert the ABI matched rather than confirm it.
 */
const asAddress = (value: unknown): string | null =>
  typeof value === 'string' &&
  ethers.isAddress(value) &&
  value !== ethers.ZeroAddress
    ? value
    : null;

const asText = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

const asBigInt = (value: unknown): bigint | null =>
  typeof value === 'bigint' ? value : null;

/**
 * The ENSIP-19 reverse node for an address on Base:
 * `keccak256(BASE_REVERSE_NODE + keccak256(lowercase hex address, no 0x))`.
 */
const reverseNode = (wallet: string): string =>
  ethers.keccak256(
    ethers.concat([
      BASE_REVERSE_NODE,
      ethers.keccak256(ethers.toUtf8Bytes(wallet.toLowerCase().slice(2))),
    ])
  );

// ============================================================================
// Normalisation
// ============================================================================

export type RecordRejection =
  | 'empty'
  | 'numeric'
  | 'malformed'
  | 'tooShort'
  | 'reservedPath';

/**
 * Paths on `x.com` that are not profiles.
 *
 * A URL-shaped record is only a profile link when the first path segment IS
 * the handle, and for these it is a page of the site instead. Without this the
 * URL recovery below hands back the segment as if it were a handle, and every
 * one of these is a real account belonging to somebody unrelated: measured
 * live, `https://x.com/logout` (twice) and `https://x.com/home` (once) are
 * already in the corpus.
 *
 * The worst case is `x.com/intent/user?screen_name=<handle>`, where the
 * correct handle sits in the query string: the old regex threw the right
 * answer away and substituted `@intent`. Refusing is the only safe move,
 * because a record that is a site URL is not an attestation about whoever
 * happens to own that word as a handle.
 *
 * Not exhaustive by construction, and it does not need to be. It is a floor
 * under a free-text field, so a name that is missing here is refused by the
 * length and shape rules or lands on a genuine profile URL.
 */
const X_RESERVED_PATHS = new Set([
  'about',
  'account',
  'bookmarks',
  'compose',
  'download',
  'explore',
  'followers',
  'following',
  'hashtag',
  'help',
  'home',
  'i',
  'intent',
  'jobs',
  'lists',
  'login',
  'logout',
  'messages',
  'notifications',
  'oauth',
  'privacy',
  'search',
  'session',
  'settings',
  'share',
  'signup',
  'status',
  'statuses',
  'topics',
  'tos',
  'tweet',
  'welcome',
  'widgets',
]);

/**
 * The shortest value accepted as a handle.
 *
 * X requires 4 to 15 characters for a new username, so handles shorter than
 * that exist only as rare legacy accounts. In a field an owner typed by hand,
 * a one to three character value is overwhelmingly a placeholder or a slip,
 * and it lands on a real stranger: of the ten most common short values in the
 * live corpus, nine resolve to existing X accounts today (`@y`, `@b`, `@t`,
 * `@w`, `@jb`, `@npx`, `@ada`, `@iii`, `@uuu` all answer 200; only `@e` is
 * free). The corpus holds 1,073 such values out of 57,305 that otherwise pass,
 * so refusing them costs 1.9% and prevents roughly 770 wrong pairs.
 *
 * This is the same judgement the all-digit refusal below makes, applied to a
 * class four times larger, and it is written down for the same reason: it is a
 * decision about evidence, not a side effect of a regex.
 */
const MIN_HANDLE_LENGTH = 4;

export type NormalisedRecord =
  | { handle: string; reject: null }
  | { handle: null; reject: RecordRejection };

/**
 * Turn a raw `com.twitter` text record into a handle, or refuse it.
 *
 * **Recover, then validate, then reject. Never strip.** That last part is the
 * whole point, and it is why `cleanTwitterHandle` is not reused here.
 * `cleanTwitterHandle` deletes every character outside `[a-z0-9_]` and keeps
 * whatever is left, which is right for a value that arrived from a source that
 * already believed it was a handle, and wrong for free text an owner typed into
 * a name record: it turns `x.com/Cristhianrg12` into the handle `xcom` and
 * `emrah28.base.eth` into `emrah28baseeth`. Both are accepted today, and both
 * are invented. This function returns null for them instead.
 *
 * The rules are measured against the current value of every node holding this
 * key, not sampled. A bare `^[A-Za-z0-9_]{1,15}$` gate accepts 93.61%; adding
 * the two recoveries below (a leading `@`, at 3.13%, and the URL forms, at
 * 0.53%) takes it to 96.83% without accepting anything the bare gate would not
 * have accepted after the prefix was removed.
 *
 * The ingest re-runs `cleanTwitterHandle` over whatever this returns, which is
 * a no-op on a value already matching `^[a-z0-9_]{1,15}$`.
 */
export function normaliseTwitterRecord(raw: string): NormalisedRecord {
  const value = raw.trim();
  if (value === '') return { handle: null, reject: 'empty' };

  /**
   * Both URL spellings, with or without a scheme. The bare-host form is the
   * one `cleanTwitterHandle` gets wrong, because its own URL strip requires
   * `https?://`.
   */
  const url = value.match(
    /^(?:https?:\/\/)?(?:www\.)?(?:twitter|x)\.com\/(?:#!\/)?@?([A-Za-z0-9_]{1,15})(?:[/?#].*)?$/i
  );

  /**
   * A URL whose first segment is a page of the site is refused outright, and
   * never falls through to the bare-value path: `x.com/home` is a link to X,
   * not a claim about whoever owns the handle `home`.
   */
  if (url && X_RESERVED_PATHS.has(url[1].toLowerCase()))
    return { handle: null, reject: 'reservedPath' };

  const candidate = url ? url[1] : value.replace(/^@/, '');

  /**
   * All-digit values are refused, and this is a judgement rather than a rule
   * the data proves. A numeric handle is legal on X, but the observed
   * distribution here is placeholders (`1`, `666`, `11111111`, `1212312121`)
   * and a numeric string is the value most likely to land on an unrelated real
   * account if it is wrong. It costs 244 of 56,409 records, under half a
   * percent, and it is written down rather than left as a side effect of a
   * regex.
   */
  if (/^\d+$/.test(candidate)) return { handle: null, reject: 'numeric' };
  if (!/^[A-Za-z0-9_]{1,15}$/.test(candidate))
    return { handle: null, reject: 'malformed' };
  /**
   * Length is checked AFTER the shape, so a short value is reported as short
   * rather than lumped in with the malformed ones. See `MIN_HANDLE_LENGTH`.
   */
  if (candidate.length < MIN_HANDLE_LENGTH)
    return { handle: null, reject: 'tooShort' };

  return { handle: candidate.toLowerCase(), reject: null };
}

// ============================================================================
// Checkpoint
// ============================================================================

export async function getCheckpoint(): Promise<number | null> {
  const db = getDb();
  if (!db) throw new Error('Database not configured');
  const result = (await db.execute(
    sql`SELECT value->>'lastBlock' AS last_block FROM ingest_state WHERE name = ${STATE_KEY}`
  )) as unknown as { rows: Array<{ last_block: string | null }> };
  const raw = result.rows[0]?.last_block;
  return raw ? parseInt(raw, 10) : null;
}

/**
 * Every `${...}` inside `jsonb_build_object` carries an explicit cast. Without
 * one Postgres cannot infer the parameter type and the statement fails at plan
 * time with 42P18, in every environment, on every call. That is not
 * hypothetical here: it is the defect that turned the Neynar credit ceiling off
 * for 19 days. `scripts/check-invariants.ts` asserts the rule over a fixed list
 * of files, and THIS FILE MUST BE ADDED TO THAT LIST or the assertion silently
 * does not cover it.
 */
async function saveCheckpoint(lastBlock: number): Promise<void> {
  const db = getDb();
  if (!db) throw new Error('Database not configured');
  await db.execute(sql`
    INSERT INTO ingest_state (name, value, updated_at)
    VALUES (${STATE_KEY}, jsonb_build_object('lastBlock', ${lastBlock}::bigint), now())
    ON CONFLICT (name) DO UPDATE
    SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
  `);
}

// ============================================================================
// Stage 1: enumerate candidate nodes
// ============================================================================

interface ScanResult {
  /** Node to the highest block in this range that wrote its `com.twitter`. */
  latestWrite: Map<string, number>;
  logCount: number;
}

/**
 * Scan `[fromBlock, toBlock]` for `com.twitter` writes on the two resolvers.
 *
 * The window self-tunes, and its ceiling depends on the provider because the
 * two impose different limits, both measured:
 *
 * - `mainnet.base.org` refuses `toBlock - fromBlock > 10000` outright, with
 *   code -32614. Offset 10,000 works and 10,001 does not.
 * - Alchemy allows EITHER a range up to 10,000 blocks with no response cap, OR
 *   any range at all capped at 10,000 logs. The second mode is what makes a
 *   backfill cheap.
 *
 * A range Alchemy refuses is halved and retried, which is why the ceiling can
 * be set optimistically: the busiest month wrote 16,971 records and simply
 * costs an extra halving when the window lands on it.
 *
 * Cost, instrumented rather than extrapolated from an unbounded probe. This
 * function is called once per CHUNK and restarts its window at 10,000 every
 * time, so the window never grows past `CHUNK_BLOCKS`. A real 1,000,000-block
 * chunk took 7 log queries (spans 10k, 20k, 40k, 80k, 160k, 320k, 370k), so a
 * full backfill of the live range is roughly 240 log queries plus about 200
 * registrar queries. That is far below the 5,080 a fixed 10,000-block window
 * would need, which is the point, but it is not the 40 an earlier note here
 * claimed: that figure was measured with unbounded ranges the chunked caller
 * never issues.
 */
async function scanTextChangedLogs(
  fromBlock: number,
  toBlock: number
): Promise<ScanResult> {
  const latestWrite = new Map<string, number>();
  let logCount = 0;

  const maxWindow = hasWideLogRange() ? 8_000_000 : 10_000;
  const minWindow = 500;
  let window = Math.min(10_000, maxWindow);
  let block = fromBlock;

  while (block <= toBlock) {
    const upper = Math.min(block + window - 1, toBlock);
    let logs: Array<{ topics: string[]; blockNumber: string }>;
    try {
      logs = (await rpc('eth_getLogs', [
        {
          address: RESOLVERS,
          topics: [TEXT_CHANGED_4, null, [KEY_TWITTER]],
          fromBlock: '0x' + block.toString(16),
          toBlock: '0x' + upper.toString(16),
        },
      ])) as Array<{ topics: string[]; blockNumber: string }>;
    } catch (error) {
      if (window <= minWindow) {
        throw new Error(
          `Basenames: eth_getLogs failing at the minimum window at block ${block}: ${String(error)}`
        );
      }
      window = Math.max(Math.floor(window / 2), minWindow);
      continue;
    }

    for (const log of logs) {
      const node = log.topics[1];
      const at = Number.parseInt(log.blockNumber, 16);
      if (!node || !Number.isFinite(at)) continue;
      const seen = latestWrite.get(node);
      if (seen === undefined || at > seen) latestWrite.set(node, at);
    }
    logCount += logs.length;
    block = upper + 1;

    if (logs.length < 4000) window = Math.min(window * 2, maxWindow);
    else if (logs.length > 8000)
      window = Math.max(Math.floor(window / 2), minWindow);
  }

  return { latestWrite, logCount };
}

// ============================================================================
// Stage 2 to 5: resolve, normalise, recover the label, check the expiry
// ============================================================================

/** Every reason a candidate was dropped, counted separately and always reported. */
export interface BasenameDrops {
  /** The registry names no resolver for this node any more. */
  noResolver: number;
  /** The resolver holds no address, so there is no wallet side to the pair. */
  noAddress: number;
  /** The record is empty at the name's CURRENT resolver: moved or cleared. */
  recordCleared: number;
  /** An all-digit record, refused deliberately. */
  handleNumeric: number;
  /** A record that is not a handle and could not be recovered into one. */
  handleMalformed: number;
  /** One to three characters, refused deliberately. See `MIN_HANDLE_LENGTH`. */
  handleTooShort: number;
  /** A link to a page of X rather than to a profile. See `X_RESERVED_PATHS`. */
  handleReservedPath: number;
  /** No base reverse name, or one that is not this node, so no expiry check. */
  labelUnrecovered: number;
  /** The registration has lapsed. Anybody can buy this name today. */
  expired: number;
  /**
   * The registrar's answer could not be read at all: the Multicall inner call
   * failed or returned something that did not decode.
   *
   * Counted APART from `expired`, and the separation is load-bearing rather
   * than tidy. `nameExpires` of an id that was never registered returns 0,
   * which is `<= now`, so a derivation bug that computes the wrong labelhash
   * for every name presents as a high `expired` count and nothing else. That
   * is exactly how the `namehash` defect hid: `expired` is the statistic the
   * docs quote to justify the filter, and it would read the same if the
   * registrar call were failing outright. A run whose `expiryUnreadable` is
   * non-trivial is a broken run, not a run that found lapsed names.
   */
  expiryUnreadable: number;
  /** The record predates the current registration, so it may be the last owner's. */
  staleRegistration: number;
  /** The wallet or the handle is on the suppression list. See `dropSuppressed`. */
  suppressed: number;
}

const emptyDrops = (): BasenameDrops => ({
  noResolver: 0,
  noAddress: 0,
  recordCleared: 0,
  handleNumeric: 0,
  handleMalformed: 0,
  handleTooShort: 0,
  handleReservedPath: 0,
  labelUnrecovered: 0,
  expired: 0,
  expiryUnreadable: 0,
  staleRegistration: 0,
  suppressed: 0,
});

interface Candidate {
  node: string;
  wallet: string;
  handle: string;
  /** The highest block in the scanned range that wrote this node's record. */
  writtenAt: number;
  labelhash: string;
}

/**
 * Resolve a batch of nodes into link candidates, dropping at each stage and
 * counting every drop.
 *
 * Five Multicall3 rounds, in an order chosen so each one only pays for what
 * survived the last: resolver, then address and record, then the reverse
 * resolver, then the reverse name, then the expiry. The record is normalised
 * between rounds two and three so a malformed value never pays for a label
 * recovery.
 */
async function resolveCandidates(
  latestWrite: Map<string, number>,
  drops: BasenameDrops,
  onReject: HarvestOptions['onReject']
): Promise<Candidate[]> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const out: Candidate[] = [];
  /** Entries, not keys, so the write block travels with the node it belongs to. */
  const entries = [...latestWrite.entries()].map(([node, writtenAt]) => ({
    node,
    writtenAt,
  }));

  for (let i = 0; i < entries.length; i += NODE_BATCH) {
    const slice = entries.slice(i, i + NODE_BATCH);

    // Round 1: the resolver the registry names TODAY, not the one that logged.
    const round1 = await multicallAdaptive(
      slice.map(({ node }) => ({
        target: REGISTRY,
        callData: registryIface.encodeFunctionData('resolver', [node]),
      }))
    );
    const withResolver: Array<{
      node: string;
      writtenAt: number;
      resolver: string;
    }> = [];
    slice.forEach((entry, j) => {
      const resolver = asAddress(
        decodeCall(registryIface, 'resolver', round1[j])
      );
      if (!resolver) {
        drops.noResolver++;
        return;
      }
      withResolver.push({ ...entry, resolver });
    });
    if (withResolver.length === 0) continue;

    // Round 2: the wallet and the record, both read from that resolver.
    const round2 = await multicallAdaptive(
      withResolver.flatMap(({ node, resolver }) => [
        {
          target: resolver,
          callData: resolverIface.encodeFunctionData('addr', [node]),
        },
        {
          target: resolver,
          callData: resolverIface.encodeFunctionData('text', [
            node,
            'com.twitter',
          ]),
        },
      ])
    );
    const normalised: Array<{
      node: string;
      writtenAt: number;
      wallet: string;
      handle: string;
    }> = [];
    withResolver.forEach((entry, j) => {
      const addr = asAddress(decodeCall(resolverIface, 'addr', round2[j * 2]));
      if (!addr) {
        drops.noAddress++;
        return;
      }
      const raw = asText(decodeCall(resolverIface, 'text', round2[j * 2 + 1]));
      if (raw === null || raw.trim() === '') {
        drops.recordCleared++;
        return;
      }
      const normalisedRecord = normaliseTwitterRecord(raw);
      if (normalisedRecord.handle === null) {
        if (normalisedRecord.reject === 'numeric') drops.handleNumeric++;
        else if (normalisedRecord.reject === 'tooShort') drops.handleTooShort++;
        else if (normalisedRecord.reject === 'reservedPath')
          drops.handleReservedPath++;
        else drops.handleMalformed++;
        onReject?.(raw, normalisedRecord.reject);
        return;
      }
      normalised.push({
        node: entry.node,
        writtenAt: entry.writtenAt,
        wallet: addr.toLowerCase(),
        handle: normalisedRecord.handle,
      });
    });
    if (normalised.length === 0) continue;

    /**
     * Rounds 3 and 4 are keyed on the WALLET, not the node: several nodes can
     * point at one address and they would all ask the same reverse record.
     */
    const wallets = [...new Set(normalised.map((n) => n.wallet))];

    // Round 3: the reverse resolver for each distinct address.
    const round3 = await multicallAdaptive(
      wallets.map((wallet) => ({
        target: REGISTRY,
        callData: registryIface.encodeFunctionData('resolver', [
          reverseNode(wallet),
        ]),
      }))
    );
    const withReverse: Array<{ wallet: string; resolver: string }> = [];
    wallets.forEach((wallet, j) => {
      const resolver = asAddress(
        decodeCall(registryIface, 'resolver', round3[j])
      );
      if (!resolver) return;
      withReverse.push({ wallet, resolver });
    });

    // Round 4: the primary name behind each reverse record.
    const round4 = await multicallAdaptive(
      withReverse.map(({ wallet, resolver }) => ({
        target: resolver,
        callData: resolverIface.encodeFunctionData('name', [
          reverseNode(wallet),
        ]),
      }))
    );
    const primaryName = new Map<string, string>();
    withReverse.forEach(({ wallet }, j) => {
      const name = asText(decodeCall(resolverIface, 'name', round4[j]));
      if (name) primaryName.set(wallet, name);
    });

    /**
     * Keep a label only when the primary name is a direct child of `base.eth`
     * AND the node derived from its RAW label is the node we started from.
     * Without that equality an owner whose primary name is a different name of
     * theirs would have that OTHER name's expiry checked, which is a filter
     * that reports on the wrong name and passes.
     *
     * The derivation is `rawBaseNode`, never `namehash`: see its comment for
     * the three live registrations that prove why, and for why no chain-read
     * string is handed to `namehash` anywhere in this module.
     */
    const withLabel: Candidate[] = [];
    for (const n of normalised) {
      const name = primaryName.get(n.wallet);
      const match = name ? /^([^.]+)\.base\.eth$/.exec(name) : null;
      if (!name || !match || rawBaseNode(match[1]) !== n.node) {
        drops.labelUnrecovered++;
        continue;
      }
      withLabel.push({ ...n, labelhash: rawLabelhash(match[1]) });
    }
    if (withLabel.length === 0) continue;

    // Round 5: the registrar's expiry, the filter this whole detour exists for.
    const round5 = await multicallAdaptive(
      withLabel.map((c) => ({
        target: BASE_REGISTRAR,
        callData: registrarIface.encodeFunctionData('nameExpires', [
          c.labelhash,
        ]),
      }))
    );
    withLabel.forEach((c, j) => {
      const expires = asBigInt(
        decodeCall(registrarIface, 'nameExpires', round5[j])
      );
      /**
       * Strictly greater, which is the registrar's own test: its
       * `onlyNonExpired` modifier reverts when
       * `nameExpires[id] <= block.timestamp`. A name inside its 90-day grace
       * period is expired by this test and is dropped, which is right: the
       * owner has not renewed and the record is no longer a live claim.
       */
      if (expires === null) {
        drops.expiryUnreadable++;
        return;
      }
      if (expires <= BigInt(nowSeconds)) {
        drops.expired++;
        return;
      }
      out.push(c);
    });
  }

  return out;
}

// ============================================================================
// Stage 6: registration recency
// ============================================================================

/**
 * Drop any candidate whose record was written before the name's current
 * registration, because that record belongs to whoever owned the name last.
 *
 * One `eth_getLogs` per 100 labelhashes, over the whole chain, filtered on the
 * two registrar events that establish ownership. Measured: 100 labelhashes
 * return about 120 logs, comfortably inside Alchemy's 10,000-log cap, so this
 * costs one call per 100 names and never pages.
 *
 * It needs a provider that allows a whole-chain range, which the public
 * endpoint does not (it caps every log query at 10,000 blocks). When it cannot
 * run, NOTHING is dropped and the caller is told, rather than the guard
 * quietly reporting a clean pass: the mandatory expiry filter has already run,
 * this one closes a narrower case (measured at 4 of 222 live names, with zero
 * observed misattribution among them), and a silent skip is the failure mode
 * this codebase keeps finding in its own guards.
 *
 * What it does NOT cover, stated rather than implied: a name whose record was
 * harvested in an earlier run and which lapsed and changed hands afterwards
 * with no new record written. A forward checkpointed scan never revisits it,
 * so it stays in the graph until something else corrects it. That is the same
 * property the ENS harvest has, and closing it means a periodic re-read of
 * every node rather than a filter here.
 */
async function dropStaleRegistrations(
  candidates: Candidate[],
  headBlock: number,
  drops: BasenameDrops
): Promise<{ kept: Candidate[]; skipped: boolean }> {
  if (candidates.length === 0) return { kept: candidates, skipped: false };
  if (!hasWideLogRange()) {
    console.warn(
      'Basenames: no wide-range RPC configured, so the registration-recency ' +
        'guard did not run. Nothing was dropped on its account.'
    );
    return { kept: candidates, skipped: true };
  }

  const latestRegistration = new Map<string, number>();
  for (let i = 0; i < candidates.length; i += REGISTRATION_LABELS_PER_CALL) {
    const chunk = candidates.slice(i, i + REGISTRATION_LABELS_PER_CALL);
    let logs: Array<{ topics: string[]; blockNumber: string }>;
    try {
      logs = (await rpc('eth_getLogs', [
        {
          address: BASE_REGISTRAR,
          topics: [
            [NAME_REGISTERED, NAME_REGISTERED_WITH_RECORD],
            chunk.map((c) => c.labelhash),
          ],
          /**
           * The whole chain, not `BASENAMES_SCAN_START_BLOCK`: that constant is
           * the floor for TEXT writes, and a name can have been registered long
           * before anybody wrote a record against it. A guard that started at
           * the text floor would find no registration for the oldest names and
           * pass them for the wrong reason.
           */
          fromBlock: '0x0',
          toBlock: '0x' + headBlock.toString(16),
        },
      ])) as Array<{ topics: string[]; blockNumber: string }>;
    } catch (error) {
      console.warn(
        `Basenames: registration-recency guard failed and was skipped: ${String(error)}`
      );
      return { kept: candidates, skipped: true };
    }
    for (const log of logs) {
      const labelhash = log.topics[1];
      const at = Number.parseInt(log.blockNumber, 16);
      if (!labelhash || !Number.isFinite(at)) continue;
      const seen = latestRegistration.get(labelhash);
      if (seen === undefined || at > seen)
        latestRegistration.set(labelhash, at);
    }
  }

  const kept = candidates.filter((c) => {
    const registeredAt = latestRegistration.get(c.labelhash);
    /**
     * A labelhash with no registration log keeps the candidate. The expiry
     * round has already proved the name is registered and unexpired, so a
     * missing log means the registrar established it some other way, not that
     * nobody owns it. Dropping on an absent log would let a gap in the event
     * history read as evidence, which is the direction this repo keeps
     * getting wrong.
     */
    if (registeredAt === undefined) return true;
    if (c.writtenAt < registeredAt) {
      drops.staleRegistration++;
      return false;
    }
    return true;
  });

  return { kept, skipped: false };
}

// ============================================================================
// Orchestration
// ============================================================================

export interface BasenameHarvestStats {
  fromBlock: number;
  /** The last block this run actually scanned. */
  toBlock: number;
  blocksScanned: number;
  logsFound: number;
  nodesSeen: number;
  /** Nodes that survived every filter. */
  candidates: number;
  dropped: BasenameDrops;
  /** True when the registration-recency guard could not run. See its comment. */
  registrationCheckSkipped: boolean;
  /** True when the run stopped on its block budget rather than at the head. */
  budgetReached: boolean;
  links: number;
  contested: number;
  rejected: number;
  newWallets: number;
  filled: number;
  agree: number;
  conflicts: number;
  /** Where the checkpoint stands after this run; null on a dry run. */
  checkpointBlock: number | null;
}

export interface HarvestOptions {
  fromBlock: number;
  /** Cap the blocks one run will scan. The cron uses it; a backfill does not. */
  maxBlocks?: number;
  /** Classify and report without writing anything, checkpoint included. */
  dryRun?: boolean;
  onProgress?: (message: string) => void;
  /**
   * Every raw record the normaliser refused, with its reason.
   *
   * The counts in `BasenameDrops` say how many, which is what a scheduled run
   * needs; the values themselves are for a person tuning the rules at a
   * terminal, so the caller decides whether to keep any. The CLI samples ten;
   * the cron passes nothing.
   */
  onReject?: (raw: string, reason: RecordRejection) => void;
}

/**
 * Drop pairs naming a suppressed address or a suppressed handle.
 *
 * The storage triggers are underneath this and would refuse the row anyway, so
 * it would be easy to think the filter is decorative. It is not, and the way
 * it fails without one is worth stating.
 *
 * For a suppressed HANDLE the trigger sets `NEW.twitter_handle` to NULL before
 * the `ON CONFLICT`, so the first arm of the handle CASE in
 * `lib/attested-links.ts` compares against NULL, evaluates to NULL rather than
 * true, and is not taken. Control reaches the ELSE, which appends
 * `basename_record` to the sources of a row whose handle came from an entirely
 * different source, and the score CASE falls through the same way. Because
 * this source maps to `onchain`, and `onchain` is inside `ATTESTED_SOURCES`,
 * the public API would then report an owner-published onchain attestation for
 * a handle this source never attested. Suppressing an identifier is what makes
 * that fire, which is the exact opposite of what suppression is for.
 *
 * Fails closed: `loadSuppressionList` throwing aborts the harvest rather than
 * letting a chunk through unfiltered.
 */
async function dropSuppressed(
  links: AttestedLink[],
  drops: BasenameDrops
): Promise<AttestedLink[]> {
  if (links.length === 0) return links;
  const sets = await loadSuppressionList();
  const kept = links.filter(
    (link) =>
      !isKindSuppressed(sets, 'wallet', link.wallet) &&
      !isKindSuppressed(sets, 'twitter', link.handle)
  );
  drops.suppressed += links.length - kept.length;
  return kept;
}

/**
 * Harvest from `fromBlock` towards the chain head, in chunks.
 *
 * The checkpoint advances only after a chunk's candidates are fully resolved
 * and written, so an interrupt costs the retry and nothing else. Re-running a
 * chunk is free: the ingest is fill-only and idempotent.
 */
export async function harvestBasenameRecords(
  opts: HarvestOptions
): Promise<BasenameHarvestStats> {
  const { fromBlock, maxBlocks, dryRun = false, onProgress, onReject } = opts;

  const headHex = (await rpc('eth_blockNumber', [])) as string | null;
  if (!headHex)
    throw new Error('Basenames: could not read the Base head block');
  const head = Number.parseInt(headHex, 16);
  const chainTarget = head - REORG_BUFFER_BLOCKS;
  const budgetTarget =
    maxBlocks === undefined ? chainTarget : fromBlock + maxBlocks - 1;
  const targetBlock = Math.min(chainTarget, budgetTarget);

  const stats: BasenameHarvestStats = {
    fromBlock,
    toBlock: fromBlock - 1,
    blocksScanned: 0,
    logsFound: 0,
    nodesSeen: 0,
    candidates: 0,
    dropped: emptyDrops(),
    registrationCheckSkipped: false,
    budgetReached: false,
    links: 0,
    contested: 0,
    rejected: 0,
    newWallets: 0,
    filled: 0,
    agree: 0,
    conflicts: 0,
    checkpointBlock: null,
  };
  if (fromBlock > targetBlock) return stats;

  let block = fromBlock;
  while (block <= targetBlock) {
    const chunkEnd = Math.min(block + CHUNK_BLOCKS - 1, targetBlock);

    const scan = await scanTextChangedLogs(block, chunkEnd);
    stats.blocksScanned += chunkEnd - block + 1;
    stats.logsFound += scan.logCount;
    stats.nodesSeen += scan.latestWrite.size;

    const resolved = await resolveCandidates(
      scan.latestWrite,
      stats.dropped,
      onReject
    );
    const { kept, skipped } = await dropStaleRegistrations(
      resolved,
      head,
      stats.dropped
    );
    if (skipped) stats.registrationCheckSkipped = true;
    stats.candidates += kept.length;

    const candidateLinks: AttestedLink[] = kept.map((c) => ({
      wallet: c.wallet,
      handle: c.handle,
      /**
       * A text record carries a handle and nothing else, so there is no X
       * account id to attach. Passing null is what every source without one
       * does.
       *
       * What it costs, stated rather than left implied: the recency guard
       * above covers a NAME that changed hands, and nothing covers a HANDLE
       * that did. A record written in 2024 whose X handle has since been
       * renamed or released and retaken is emitted as a current pair, and
       * without the account id nothing downstream can tell a rename from a
       * deletion. The correction path is the reachability sweep that re-reads
       * handles, not a filter here.
       */
      twitterUserId: null,
    }));

    const links = await dropSuppressed(candidateLinks, stats.dropped);

    if (dryRun) {
      /**
       * The dry run goes through the same `dedupeByWallet` and `classifyLinks`
       * the commit path uses, rather than a second opinion about what would
       * happen. `conflicts` counts disagreements found, since none are written.
       */
      const { links: deduped, contested, rejected } = dedupeByWallet(links);
      const counts = await classifyLinks(deduped);
      stats.links += deduped.length;
      stats.contested += contested;
      stats.rejected += rejected;
      stats.newWallets += counts.newWallets;
      stats.filled += counts.wouldFill;
      stats.agree += counts.agree;
      stats.conflicts += counts.disagree;
    } else {
      if (links.length > 0) {
        const ingested = await ingestLinks(links, SOURCE);
        stats.links += ingested.links;
        stats.contested += ingested.contested;
        stats.rejected += ingested.rejected;
        stats.newWallets += ingested.newWallets;
        stats.filled += ingested.filled;
        stats.agree += ingested.agree;
        stats.conflicts += ingested.conflicts;
      }
      /**
       * The checkpoint advances over a chunk with no links too: those blocks
       * were read, not left pending.
       */
      await saveCheckpoint(chunkEnd);
      stats.checkpointBlock = chunkEnd;
    }

    stats.toBlock = chunkEnd;
    onProgress?.(
      `block ${chunkEnd.toLocaleString()} | ${stats.nodesSeen.toLocaleString()} nodes | ` +
        `${stats.candidates.toLocaleString()} candidates | ${stats.links.toLocaleString()} links | ` +
        `dropped ${JSON.stringify(stats.dropped)}`
    );

    block = chunkEnd + 1;
  }

  stats.budgetReached = targetBlock < chainTarget;
  return stats;
}
