/**
 * The onchain rail: one Agent pack, paid in USDC on Base, no account needed.
 *
 * ## What this is not
 *
 * It is not per-call pricing. The `exact` scheme charges before anything has
 * resolved, and this product's whole position is that a wallet resolving to
 * nothing costs nothing. Charging per call would contradict the pricing on
 * every other surface. So the rail sells a pack, the pack is metered on matches
 * exactly as a card purchase is, and misses stay free.
 *
 * ## The identifier a payment is remembered by
 *
 * `<network>:<from>:<nonce>` from the EIP-3009 authorization the payer signed,
 * never the transaction hash. The hash is unknown when a facilitator times out,
 * and a `settlement_pending` response can carry one for a transaction that was
 * broadcast and never mined; keying on it would double-grant in precisely the
 * case the key exists to prevent. The authorization is fixed before settlement
 * is attempted, and USDC's own `_authorizationStates[from][nonce]` refuses to
 * honour it twice, so a replayed payload cannot buy a second pack.
 *
 * ## The rail is inert until it is configured
 *
 * `X402_PAY_TO` is unset by default and the endpoint answers 503 without it.
 * A payment rail that quietly works with a default address is a rail that pays
 * somebody else.
 */
import { x402ResourceServer, HTTPFacilitatorClient } from '@x402/core/server';
import { verifyTypedData } from 'viem';
import { registerExactEvmScheme } from '@x402/evm/exact/server';

/** Base mainnet, CAIP-2. Protocol v2 identifies networks this way. */
export const BASE_MAINNET = 'eip155:8453';

/** The same chain, as EIP-712 wants it. */
export const BASE_CHAIN_ID = 8453;

/**
 * USDC on Base mainnet, and its EIP-712 domain.
 *
 * The domain name is "USD Coin" on mainnet and "USDC" on Base Sepolia. Getting
 * it wrong does not fail loudly: every signature simply fails to recover to the
 * payer, so every payment is rejected for no visible reason. Verified against
 * the contract by eth_call rather than copied.
 */
export const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

/**
 * The facilitator that verifies and settles.
 *
 * Chosen by probing `/supported` for a kind with `x402Version: 2`,
 * `network: eip155:8453` and `scheme: exact`, rather than by reading a
 * marketing page. Several facilitators advertise Base mainnet and serve
 * protocol v1 only, and the v2 client refuses them at `initialize()`.
 */
const FACILITATOR_URL =
  process.env.X402_FACILITATOR_URL ?? 'https://facilitator.payai.network';

/** Where the USDC goes. Unset means the rail is switched off. */
export function payToAddress(): string | null {
  const configured = process.env.X402_PAY_TO;
  return configured && configured.startsWith('0x') ? configured : null;
}

let cached: x402ResourceServer | null = null;

/**
 * The resource server, built once per process.
 *
 * `initialize()` fetches what the facilitator supports and throws if the route
 * asks for something it cannot do, which is the check that catches a
 * facilitator serving only protocol v1. It is awaited on first use rather than
 * at module load, so a facilitator outage cannot stop the app from booting.
 */
export async function getResourceServer(): Promise<x402ResourceServer> {
  if (cached) return cached;
  const server = new x402ResourceServer(
    new HTTPFacilitatorClient({ url: FACILITATOR_URL })
  );
  // No network argument: the EVM scheme registers an eip155:* wildcard, and
  // what we actually accept is decided by the payment requirements below.
  registerExactEvmScheme(server, {});
  await server.initialize();
  cached = server;
  return server;
}

/**
 * The settlement identifier for a payment payload.
 *
 * Returns null when the payload carries no EIP-3009 authorization, which means
 * the caller sent something this rail cannot remember having honoured. That is
 * refused rather than settled: a payment we cannot make idempotent is a payment
 * we can be charged for twice.
 */
export function settlementIdFor(payload: unknown): string | null {
  const p = payload as
    | { payload?: { authorization?: { from?: unknown; nonce?: unknown } } }
    | undefined;
  const auth = p?.payload?.authorization;
  const from = typeof auth?.from === 'string' ? auth.from.toLowerCase() : null;
  const nonce =
    typeof auth?.nonce === 'string' ? auth.nonce.toLowerCase() : null;
  if (!from || !nonce) return null;
  return `${BASE_MAINNET}:${from}:${nonce}`;
}

/**
 * Whether the payload was actually signed by the address it names.
 *
 * This is the check that makes a replay safe to honour. `from` and `nonce`
 * both appear in USDC's public `AuthorizationUsed` event, so anyone reading
 * Base can rebuild the outer shape of a payload that names somebody else's
 * settled payment. Possession of those two values proves nothing. Possession
 * of a signature over them proves the private key.
 *
 * ECDSA only. A smart-contract wallet signs under EIP-1271, which needs an RPC
 * call to the wallet, so a contract payer fails this check and falls through
 * to the support path rather than being served. That is the safe direction to
 * fail in: it refuses a real buyer rather than serving an impostor.
 *
 * Verified against the requirements we ourselves issued, never against values
 * taken from the payload, so a caller cannot supply a domain that makes their
 * own signature check out.
 */
export async function signedByPayer(
  payload: unknown,
  requirements: { asset: string; extra: Record<string, unknown> }
): Promise<boolean> {
  const p = payload as
    | {
        payload?: {
          signature?: unknown;
          authorization?: Record<string, unknown>;
        };
      }
    | undefined;
  const auth = p?.payload?.authorization;
  const signature = p?.payload?.signature;
  if (!auth || typeof signature !== 'string') return false;

  const { name, version } = requirements.extra as {
    name?: string;
    version?: string;
  };
  if (!name || !version) return false;

  const str = (v: unknown) => (typeof v === 'string' ? v : String(v ?? ''));

  try {
    return await verifyTypedData({
      address: str(auth.from) as `0x${string}`,
      domain: {
        name,
        version,
        chainId: BASE_CHAIN_ID,
        verifyingContract: requirements.asset as `0x${string}`,
      },
      types: {
        TransferWithAuthorization: [
          { name: 'from', type: 'address' },
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'validAfter', type: 'uint256' },
          { name: 'validBefore', type: 'uint256' },
          { name: 'nonce', type: 'bytes32' },
        ],
      },
      primaryType: 'TransferWithAuthorization',
      message: {
        from: str(auth.from) as `0x${string}`,
        to: str(auth.to) as `0x${string}`,
        value: BigInt(str(auth.value) || '0'),
        validAfter: BigInt(str(auth.validAfter) || '0'),
        validBefore: BigInt(str(auth.validBefore) || '0'),
        nonce: str(auth.nonce) as `0x${string}`,
      },
      signature: signature as `0x${string}`,
    });
  } catch {
    // A malformed signature, address or numeric field. Not signed by the
    // payer as far as this rail is concerned.
    return false;
  }
}

/** The payer's address from a payload, for the account the pack belongs to. */
export function payerFrom(payload: unknown): string | null {
  const p = payload as
    | { payload?: { authorization?: { from?: unknown } } }
    | undefined;
  const from = p?.payload?.authorization?.from;
  return typeof from === 'string' ? from.toLowerCase() : null;
}
