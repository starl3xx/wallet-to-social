import type { SupportedChain } from './chains';

/**
 * NFT holder lists read straight off an RPC node, for chains no index covers.
 *
 * ## Why this exists
 *
 * Every other NFT holder list in this product comes from one `getOwnersForContract`
 * call: one request, the whole owner set, no pagination. HyperEVM (chain 999) has
 * no such endpoint. Measured on 2026-08-31, all three sources this repository
 * already talks to refuse the chain outright:
 *
 * - the NFT API answers `"This endpoint isn't enabled for that chain or network
 *   just yet"`,
 * - the metered ERC-20 index answers `"chain must be a valid enum value"` for both
 *   the slug and the hex chain id,
 * - and there is no public Blockscout instance: four candidate hosts all 404 on
 *   `/api/v2/stats`.
 *
 * What the chain does have is plain JSON-RPC, so the owner set is recoverable by
 * asking the contract itself, once per token id. That is what this module does.
 *
 * ## The rule this module is built around
 *
 * **A short list is worse than no list.** Every path out of here either returns a
 * provably complete owner set or throws. There is no partial success, because
 * `getContractHolders` derives `truncated` from `totalHolders` against
 * `wallets.length`, so a scan that quietly stopped early would report
 * `truncated: false` and tell the buyer it held every holder. That is the exact
 * defect `lib/contract-holders.ts` records for a capped USDG import, and the same
 * argument it already makes in prose for refusing a paging index as an NFT
 * fallback. Here it is an assertion instead of a comment: `resolved` must equal
 * `totalSupply()` or the scan throws.
 *
 * ## Measurements behind the constants (2026-08-31, HYPE TERMINAL, 6,666 tokens)
 *
 * | endpoint                 | batch 20 | batch 50 | batch 100 | 6,666 ids     |
 * |--------------------------|----------|----------|-----------|---------------|
 * | rpc.purroofgroup.com     | ok       | ok       | ok        | 8.3s, 803/s   |
 * | rpc.hyperliquid.xyz/evm  | ok       | -32010   | -32010    | throttled out |
 * | rpc.hypurrscan.io        | ok       | -32010   | -32010    | not retried   |
 *
 * `-32010` is `"The batch request was too large"`. Twenty is the only batch size
 * every probed endpoint accepted, which is why it is the size used here rather
 * than the larger one that happens to work on the fastest host.
 *
 * The official endpoint is listed last deliberately. At batch 20 with four
 * workers it returned 800 of 6,666 ids before throttling, and with eight workers
 * it returned 240. It is a correct node and a bad bulk source, so it is kept as a
 * final fallback rather than promoted for being canonical.
 *
 * ## What is deliberately NOT done here
 *
 * **No block pinning.** Pinning every call to one block height is the obvious way
 * to make a snapshot reproducible, and it is unsafe on this chain: two of the
 * three public endpoints accept a historical block tag and answer with *latest*
 * state, with no error. Measured on token 18, whose owner changed at block
 * 44,675,209: at block 44,675,200 `rpc.hyperliquid.xyz` and `rpc.hypurrscan.io`
 * both returned the post-44,675,209 owner. A pinned scan against those hosts is
 * wrong and looks right. Reading `latest` everywhere is honest about what it is:
 * a set assembled over the seconds the scan takes, which is also what the NFT API
 * returns on every other chain.
 *
 * **No multicall.** The canonical Multicall3 address was never confirmed to hold
 * code on chain 999, and the failure is silent: `eth_call` to an address with no
 * code returns `0x`, which would decode as every token being a gap. Batched
 * JSON-RPC was measured working on these exact hosts, and it is N independent
 * calls rather than one call under a shared gas cap.
 */

/** Endpoints that answered `eth_chainId` = `0x3e7` on 2026-08-31, fastest first. */
const HYPEREVM_RPCS = [
  'https://rpc.purroofgroup.com',
  'https://rpc.hypurrscan.io',
  'https://rpc.hyperliquid.xyz/evm',
];

const ONCHAIN_RPCS: Partial<Record<SupportedChain, string[]>> = {
  hyperevm: HYPEREVM_RPCS,
};

/**
 * The only batch size every probed endpoint accepts.
 *
 * The fastest host takes 100 and the other two reject anything past 20 with
 * `-32010`. Sizing to the fastest host would make failover to either of the
 * others fail on its first request, which is the moment failover exists for.
 */
const BATCH_SIZE = 20;

/** Concurrent in-flight batches. Eight halved the wall clock against four. */
const CONCURRENCY = 8;

/**
 * Refused above this supply, before a single enumeration call is made.
 *
 * The scan costs one `eth_call` per token id, so its cost is set by supply and
 * not by holder count: a 500,000-token collection is 500,000 calls to produce at
 * most `HOLDER_LIMIT` wallets. At the slowest measured rate that completed
 * (406 ids/s, four workers) this ceiling is about 30s, which fits inside the
 * caller's 45s default with the two RPC round trips it has already spent. Above
 * it, refusing immediately is cheaper and truer than starting a scan that the
 * deadline will kill in the middle.
 */
const MAX_ONCHAIN_SUPPLY = 12_000;

/** `ownerOf(uint256)` */
const OWNER_OF = '0x6352211e';
/** `totalSupply()` */
const TOTAL_SUPPLY = '0x18160ddd';

const ZERO = '0x' + '0'.repeat(40);

export function hasOnchainHolderSource(chain: SupportedChain): boolean {
  return chain in ONCHAIN_RPCS;
}

interface RpcCall {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params: unknown[];
}

interface RpcReply {
  id?: number;
  result?: string;
  error?: { code?: number; message?: string };
}

function ownerOfCall(id: number): RpcCall {
  return {
    jsonrpc: '2.0',
    id,
    method: 'eth_call',
    params: [
      { to: '', data: OWNER_OF + id.toString(16).padStart(64, '0') },
      'latest',
    ],
  };
}

/**
 * Is this per-entry error the contract saying "no such token"?
 *
 * The distinction is the whole correctness argument for the walk. A revert is a
 * gap in the id space and the scan steps over it; anything else is the node
 * failing, and treating that as a gap would silently drop a real token and its
 * owner. Both the standard revert code and the message are checked, because a
 * node that reports reverts some third way makes every id look like a transport
 * failure, which ends in a thrown error rather than a short list. That is the
 * safe direction to be wrong in.
 */
function isRevert(error: { code?: number; message?: string } | undefined) {
  if (!error) return false;
  if (error.code === 3) return true;
  return /execution reverted|invalid token|nonexistent/i.test(
    error.message ?? ''
  );
}

async function rpcPost(
  url: string,
  body: RpcCall | RpcCall[],
  timeoutMs: number
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      /**
       * The error body is the useful part, so it is read rather than skipped.
       *
       * These nodes return a well-formed JSON-RPC error object under an HTTP
       * 400: the batch-size refusal arrives that way, and so does the log-range
       * refusal. A client that only parses 2xx sees an opaque failure and
       * retries the same oversized request forever.
       */
      const text = await response.text();
      throw new Error(`RPC ${response.status}: ${text.slice(0, 200)}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function remaining(deadlineMs: number) {
  return deadlineMs - Date.now();
}

/**
 * One batch of `ownerOf` calls against one host.
 *
 * Returns a map from token id to owner. Ids that reverted are absent, which the
 * caller counts as gaps. Throws on anything that is not a clean answer, so the
 * caller can fail over rather than record phantom gaps.
 */
async function ownerBatch(
  url: string,
  address: string,
  ids: number[],
  timeoutMs: number
): Promise<Map<number, string>> {
  const calls = ids.map((id) => {
    const call = ownerOfCall(id);
    (call.params[0] as { to: string }).to = address;
    return call;
  });

  const body = await rpcPost(url, calls, timeoutMs);

  /**
   * A rejected batch answers with one error object, not an array.
   *
   * Indexing that object per call yields `undefined` every time, and the natural
   * reading of "no result" is "this token does not exist", which would turn one
   * refused request into twenty phantom burned tokens. So the shape is checked
   * before anything is read out of it.
   */
  if (!Array.isArray(body)) {
    const err = (body as RpcReply | null)?.error;
    throw new Error(
      `batch rejected: ${err?.message ?? JSON.stringify(body).slice(0, 160)}`
    );
  }

  const owners = new Map<number, string>();
  const byId = new Map<number, RpcReply>();
  for (const entry of body as RpcReply[]) {
    if (typeof entry?.id === 'number') byId.set(entry.id, entry);
  }

  for (const id of ids) {
    /**
     * Matched by JSON-RPC id, never by array position.
     *
     * A batch response may come back in any order, and every entry here is a
     * valid 32-byte address, so a reordered response read positionally produces
     * a plausible holder list with the right cardinality and the wrong owners.
     * There is no way to detect that afterwards.
     */
    const entry = byId.get(id);
    if (!entry) throw new Error(`no reply for token ${id}`);
    if (entry.error) {
      if (isRevert(entry.error)) continue;
      throw new Error(
        `token ${id}: ${entry.error.message ?? entry.error.code ?? 'rpc error'}`
      );
    }
    const raw = entry.result;
    if (!raw || raw === '0x') continue;
    if (raw.length < 42) throw new Error(`token ${id}: short result ${raw}`);
    const owner = '0x' + raw.slice(-40).toLowerCase();
    if (owner === ZERO) continue;
    owners.set(id, owner);
  }
  return owners;
}

async function readTotalSupply(
  urls: string[],
  address: string,
  timeoutMs: number
): Promise<number> {
  let lastError: unknown;
  for (const url of urls) {
    try {
      const body = (await rpcPost(
        url,
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_call',
          params: [{ to: address, data: TOTAL_SUPPLY }, 'latest'],
        },
        timeoutMs
      )) as RpcReply;
      if (body?.error || !body?.result || body.result === '0x') {
        throw new Error(body?.error?.message ?? 'totalSupply unavailable');
      }
      return Number(BigInt(body.result));
    } catch (error) {
      lastError = error;
    }
  }
  /**
   * Without a supply there is nothing to bound the walk with and nothing to
   * prove completeness against, so this is fatal rather than a fallback into a
   * "scan until it stops answering" loop. Such a loop would return zero holders
   * on any collection whose first id reverts, and report success.
   */
  throw new Error(
    `ONCHAIN_NO_TOTAL_SUPPLY: ${lastError instanceof Error ? lastError.message : lastError}`
  );
}

/**
 * The complete owner set for an ERC-721, read one token id at a time.
 *
 * Throws rather than returning a partial list. See the module comment.
 */
export async function getOnchainNftHolders(
  address: string,
  chain: SupportedChain,
  limit: number,
  deadlineMs: number
): Promise<{
  wallets: string[];
  totalHolders: number;
  balances: Map<string, string>;
}> {
  const configured = ONCHAIN_RPCS[chain];
  if (!configured) throw new Error('CHAIN_NO_NFT_SUPPORT');
  const urls: string[] = configured;

  const lower = address.toLowerCase();
  const supply = await readTotalSupply(urls, lower, 10_000);

  if (!Number.isFinite(supply) || supply <= 0) {
    throw new Error('ONCHAIN_NO_TOTAL_SUPPLY');
  }
  if (supply > MAX_ONCHAIN_SUPPLY) {
    /**
     * Refused before spending anything. The caller can tell the customer the
     * list is unavailable for this collection, which is true, rather than hand
     * them a slice of it.
     */
    throw new Error('COLLECTION_TOO_LARGE');
  }

  /**
   * Ids `0 .. supply` inclusive: one more than the supply, on purpose.
   *
   * The two conventions in the wild are 0-based `[0, supply-1]` and 1-based
   * `[1, supply]`, and this range contains both, so no probe is needed to tell
   * them apart. The measured collection is 1-based: `ownerOf(0)` reverts and
   * `ownerOf(6666)` resolves. A walk that had started at 0 and stopped at the
   * first revert would have returned zero holders there and called it a success.
   *
   * A revert anywhere inside the range is a gap and the walk continues past it.
   * The proof is the count at the end, not the shape of the range.
   */
  const ids: number[] = [];
  for (let id = 0; id <= supply; id++) ids.push(id);

  const owners = new Map<number, string>();
  const groups: number[][] = [];
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    groups.push(ids.slice(i, i + BATCH_SIZE));
  }

  let cursor = 0;
  let failure: Error | null = null;

  async function worker() {
    while (!failure) {
      const index = cursor++;
      if (index >= groups.length) return;
      if (remaining(deadlineMs) <= 0) {
        failure ??= new Error('HOLDER_SCAN_INCOMPLETE');
        return;
      }

      let lastError: unknown;
      let done = false;
      for (const url of urls) {
        const budget = Math.min(15_000, Math.max(1_000, remaining(deadlineMs)));
        try {
          const batch = await ownerBatch(url, lower, groups[index], budget);
          for (const [id, owner] of batch) owners.set(id, owner);
          done = true;
          break;
        } catch (error) {
          // Every host is tried at the same cursor before the scan is called
          // lost. A rate-limited or size-refusing host is a reason to move on,
          // not a reason to shrink the request: the batch size here is already
          // the smallest one every host accepted.
          lastError = error;
        }
      }
      if (!done) {
        failure ??= new Error(
          `HOLDER_SCAN_INCOMPLETE: ${lastError instanceof Error ? lastError.message : lastError}`
        );
        return;
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, groups.length) }, worker)
  );
  if (failure) throw failure;

  /**
   * The completeness proof.
   *
   * Every live token resolved to exactly one owner, so the number of resolved
   * ids must equal the supply the contract reports. Fewer means the range missed
   * live tokens (sparse ids, a burn mid-supply, a mint that moved the supply
   * mid-scan), and there is no way to tell which from here. Any of them makes
   * the owner set short, and a short owner set is the one thing this module
   * refuses to return.
   */
  if (owners.size !== supply) {
    throw new Error(
      `HOLDER_SCAN_INCOMPLETE: resolved ${owners.size} of ${supply} tokens`
    );
  }

  const bags = new Map<string, number>();
  const order: string[] = [];
  for (const owner of owners.values()) {
    const seen = bags.get(owner);
    if (seen === undefined) order.push(owner);
    bags.set(owner, (seen ?? 0) + 1);
  }

  const balances = new Map<string, string>();
  for (const [owner, count] of bags) balances.set(owner, String(count));

  return {
    wallets: order.slice(0, limit),
    totalHolders: order.length,
    balances,
  };
}
