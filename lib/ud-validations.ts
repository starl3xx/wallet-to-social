/**
 * X handles that Unstoppable Domains itself verified, read from the chain.
 *
 * Between 2020-07-16 and 2023-02-18 UD verified X accounts for domain owners
 * and wrote the result onchain as two records on the domain: the handle
 * (`social.twitter.username`) and UD's signature over it
 * (`validation.social.twitter.username`). The signature covers the token id,
 * the owner at the time and the handle, so a domain that changed hands since
 * fails the check by construction: the current owner is not the one UD signed.
 *
 * Everything here reads public chain state over our own RPC and makes no
 * request to UD, whose Terms exclude blockchain networks from "the Site"
 * (Linear STA-13). The verifier follows UD's own MIT-licensed SDK
 * (`@unstoppabledomains/resolution`, `isValidTwitterSignature`), including two
 * of its quirks, because a signature is valid only against the exact bytes UD
 * signed:
 *
 *   - Any value starting with `0x` is hashed as hex bytes, pair by pair with
 *     `parseInt`, so a handle like `0xabc` is not hashed as text. A pair that
 *     is not hex becomes byte 0, as it does in the SDK's `js-sha3` input.
 *   - The SDK's signer constant is not valid EIP-55, so the comparison is on
 *     lowercase. A strict checksum compare matches no record at all.
 *
 * Three more traps from the 2026-09-23 research, each of which silently loses
 * records: the legacy CNS resolvers emit a different event,
 * `Set(uint256,string,string,uint256)`, which holds 93 of the tokens; the
 * latest event is not the current record, so current state is read through
 * ProxyReader; and a domain bridged to Polygon keeps a stale copy on Ethereum,
 * so a token binds to Polygon when its Polygon owner is non-zero and to
 * Ethereum otherwise.
 */
import { ethers } from 'ethers';

/** UD's validation signer, lowercase (see the header on EIP-55). */
export const UD_TWITTER_SIGNER = '0x12cfb13522f13a78b650a8bcbfcf50b7cb899d82';
export const HANDLE_KEY = 'social.twitter.username';
export const VALIDATION_KEY = 'validation.social.twitter.username';

/** The two chains that carry records; Base and Sonic carry none (measured). */
export const UD_CHAINS = {
  1: {
    host: 'eth-mainnet.g.alchemy.com',
    /** The first CNS block; nothing earlier carries a record. */
    fromBlock: 9_082_251,
    proxyReader: '0x578853aa776Eef10CeE6c4dd2B5862bdcE767A8B',
  },
  137: {
    host: 'polygon-mainnet.g.alchemy.com',
    fromBlock: 19_345_077,
    proxyReader: '0x91EDd8708062bd4233f4Dd0FCE15A7cb4d500091',
  },
} as const;
export type UdChain = keyof typeof UD_CHAINS;

const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';
const UNS_SET = ethers.id('Set(uint256,string,string,string,string)');
const CNS_SET = ethers.id('Set(uint256,string,string,uint256)');
const KEY_HASHES = [
  ethers.id(HANDLE_KEY),
  ethers.id(VALIDATION_KEY),
  // The pre-2020 spellings, which the research found keyed alongside.
  ethers.id('twitter_username'),
  ethers.id('validation_twitter_username'),
];

/** Hex to bytes exactly as UD's SDK does it (`hexToBytes` in its utils). */
export function sdkHexToBytes(value: string): Uint8Array {
  const hex = value.replace(/^0x/i, '');
  const bytes: number[] = [];
  for (let c = 0; c < hex.length; c += 2) {
    const n = parseInt(hex.substr(c, 2), 16);
    bytes.push(Number.isNaN(n) ? 0 : n & 0xff);
  }
  return Uint8Array.from(bytes);
}

/** The message UD signed for a (token, owner, handle). */
export function validationMessage(
  tokenIdDecimal: string,
  owner: string,
  handle: string
): string {
  return [tokenIdDecimal, owner, HANDLE_KEY, handle]
    .map((v) =>
      ethers.keccak256(
        v.startsWith('0x') ? sdkHexToBytes(v) : ethers.toUtf8Bytes(v)
      )
    )
    .join('');
}

/** Whether UD's key signed this handle for this token and this owner. */
export function isUdValidated(input: {
  tokenIdDecimal: string;
  owner: string;
  handle: string;
  signature: string;
}): boolean {
  if (!input.handle || !input.signature) return false;
  try {
    const signer = ethers.verifyMessage(
      validationMessage(input.tokenIdDecimal, input.owner, input.handle),
      input.signature
    );
    return signer.toLowerCase() === UD_TWITTER_SIGNER;
  } catch {
    return false;
  }
}

function rpcUrl(chain: UdChain): string {
  const key = process.env.ALCHEMY_KEY;
  if (!key) throw new Error('ALCHEMY_KEY is required');
  return `https://${UD_CHAINS[chain].host}/v2/${key}`;
}

let rpcId = 0;
async function rpc<T>(
  chain: UdChain,
  method: string,
  params: unknown[],
  attempt = 0
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(rpcUrl(chain), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
    });
  } catch (error) {
    if (attempt < 4) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      return rpc(chain, method, params, attempt + 1);
    }
    throw error;
  }
  if (res.status === 429 && attempt < 6) {
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    return rpc(chain, method, params, attempt + 1);
  }
  const body = (await res.json().catch(() => null)) as {
    result?: T;
    error?: { message?: string };
  } | null;
  // Never echo the URL: it carries the key.
  if (!body || body.error) {
    throw new Error(
      `${method} failed for chain ${chain}: ${body?.error?.message ?? `HTTP ${res.status}`}`
    );
  }
  return body.result as T;
}

type Log = { topics: string[]; data: string; blockNumber: string };

/** getLogs over a block range, halving the window when a provider refuses. */
async function getLogs(
  chain: UdChain,
  topics: (string | string[] | null)[],
  from: number,
  to: number
): Promise<Log[]> {
  const out: Log[] = [];
  let window = 1_000_000;
  let b = from;
  while (b <= to) {
    const up = Math.min(b + window - 1, to);
    try {
      const logs = await rpc<Log[]>(chain, 'eth_getLogs', [
        {
          topics,
          fromBlock: '0x' + b.toString(16),
          toBlock: '0x' + up.toString(16),
        },
      ]);
      out.push(...logs);
      b = up + 1;
      if (logs.length < 2000) window = Math.min(window * 2, 5_000_000);
    } catch (error) {
      if (window <= 1000) throw error;
      window = Math.max(Math.floor(window / 4), 1000);
    }
  }
  return out;
}

/**
 * Every token that ever carried one of the keys, on both chains.
 *
 * Discovery only: which tokens to look at. The records themselves are read as
 * current state below, and the events are not trusted for anything else. That
 * is also why no contract address filter is needed: a token id that is not a
 * real UD domain reads nothing through ProxyReader and drops out.
 */
export async function discoverTokens(): Promise<Set<string>> {
  const tokens = new Set<string>();
  for (const chain of Object.keys(UD_CHAINS).map(Number) as UdChain[]) {
    const head =
      parseInt(await rpc<string>(chain, 'eth_blockNumber', []), 16) - 30;
    const from = UD_CHAINS[chain].fromBlock;
    // UNS: Set(tokenId indexed, keyIndex indexed, valueIndex indexed, key, value)
    for (const l of await getLogs(
      chain,
      [UNS_SET, null, KEY_HASHES],
      from,
      head
    )) {
      tokens.add(BigInt(l.topics[1]).toString());
    }
    if (chain === 1) {
      // Legacy CNS: the key hash sits at topic 1 or 2 depending on the
      // resolver version, and the token id is the last topic.
      for (const topics of [
        [CNS_SET, KEY_HASHES],
        [CNS_SET, null, KEY_HASHES],
      ] as (string | string[] | null)[][]) {
        for (const l of await getLogs(chain, topics, from, head)) {
          tokens.add(BigInt(l.topics[l.topics.length - 1]).toString());
        }
      }
    }
  }
  return tokens;
}

export interface UdRecord {
  tokenId: string;
  chain: UdChain;
  owner: string;
  handle: string;
  signature: string;
}

const proxyIface = new ethers.Interface([
  'function getData(string[] keys, uint256 tokenId) view returns (address resolver, address owner, string[] values)',
]);
const multicallIface = new ethers.Interface([
  'function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)',
]);

async function readChain(
  chain: UdChain,
  tokenIds: string[]
): Promise<Map<string, { owner: string; handle: string; signature: string }>> {
  const out = new Map<
    string,
    { owner: string; handle: string; signature: string }
  >();
  for (let i = 0; i < tokenIds.length; i += 200) {
    const batch = tokenIds.slice(i, i + 200);
    const data = multicallIface.encodeFunctionData('aggregate3', [
      batch.map((t) => ({
        target: UD_CHAINS[chain].proxyReader,
        allowFailure: true,
        callData: proxyIface.encodeFunctionData('getData', [
          [HANDLE_KEY, VALIDATION_KEY],
          BigInt(t),
        ]),
      })),
    ]);
    const raw = await rpc<string>(chain, 'eth_call', [
      { to: MULTICALL3, data },
      'latest',
    ]);
    const [results] = multicallIface.decodeFunctionResult('aggregate3', raw);
    (results as Array<[boolean, string]>).forEach(
      ([success, returnData], j) => {
        if (!success) return;
        const [, owner, values] = proxyIface.decodeFunctionResult(
          'getData',
          returnData
        );
        out.set(batch[j], {
          owner: String(owner),
          handle: String(values[0] ?? ''),
          signature: String(values[1] ?? ''),
        });
      }
    );
  }
  return out;
}

/**
 * The current record for each token, from the chain it binds to: Polygon when
 * its Polygon owner is non-zero, Ethereum otherwise.
 */
export async function readCurrent(tokenIds: string[]): Promise<UdRecord[]> {
  const [eth, poly] = await Promise.all([
    readChain(1, tokenIds),
    readChain(137, tokenIds),
  ]);
  const records: UdRecord[] = [];
  for (const tokenId of tokenIds) {
    const p = poly.get(tokenId);
    const chain: UdChain = p && p.owner !== ethers.ZeroAddress ? 137 : 1;
    const r = chain === 137 ? p : eth.get(tokenId);
    if (!r || r.owner === ethers.ZeroAddress) continue;
    records.push({ tokenId, chain, ...r });
  }
  return records;
}
