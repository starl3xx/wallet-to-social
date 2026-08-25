/**
 * Buy an Agent pack with USDC on Base. No account, no card, no email.
 *
 * POST with no payment answers 402 and a `PAYMENT-REQUIRED` header describing
 * what to pay. POST again with a `PAYMENT-SIGNATURE` header and the response
 * carries a fresh API key and the balance behind it.
 *
 * ## This path never touches the v1 contract
 *
 * `/v1` already answers 402 for `NO_CREDITS`, with no `accepts`, and an x402
 * client cannot tell "pay me" from "you are broke". Both statuses stay where
 * they are: this endpoint is the only one that speaks the payment protocol, and
 * nothing under `/v1` changed to add it.
 *
 * ## The order of operations is the money question
 *
 * verify (nothing moves) -> settle (money moves) -> account -> grant.
 *
 * Granting before settling would hand out credits for a payment that might
 * fail. Settling before granting means a database failure in between takes
 * money without recording what it bought, so that case is logged at error with
 * the settlement id and answers 500 rather than returning a key it did not
 * create. The grant is idempotent on that same id, so the pack can be issued by
 * hand from the log line without any risk of issuing it twice.
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  getResourceServer,
  payToAddress,
  settlementIdFor,
  payerFrom,
  BASE_MAINNET,
} from '@/lib/x402';
import { X402_PACKS } from '@/lib/packs';
import { grantPackBySettlement, getBalance } from '@/lib/credits';
import { getOrCreateWalletAccount } from '@/lib/x402-account';
import { createApiKey } from '@/lib/api-keys';
import { CREDIT_API_PLAN } from '@/lib/api-plans';

export const runtime = 'nodejs';

const PACK = X402_PACKS.agent;

function b64(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}

function unb64(value: string): unknown {
  return JSON.parse(Buffer.from(value, 'base64').toString('utf8'));
}

export async function POST(request: NextRequest) {
  const payTo = payToAddress();
  if (!payTo) {
    // Unset by design. A payment rail with a default address is a rail that
    // pays somebody else.
    return NextResponse.json(
      { error: 'The onchain rail is not configured.', code: 'RAIL_DISABLED' },
      { status: 503 }
    );
  }

  const server = await getResourceServer();

  const resourceInfo = {
    url: 'https://walletlink.social/api/x402/buy',
    description: `${PACK.name} pack: ${PACK.matches} match credits for wallet identity lookups.`,
    mimeType: 'application/json',
    serviceName: 'walletlink.social',
  };

  const requirements = await server.buildPaymentRequirements({
    scheme: 'exact',
    network: BASE_MAINNET,
    payTo,
    /**
     * A money string, deliberately, rather than `{ asset, amount }`.
     *
     * The `exact` scheme signs an EIP-712 `transferWithAuthorization`, and the
     * domain separator needs the token contract's own `name` and `version` in
     * `extra`. Passing the asset explicitly leaves `extra` empty and the SDK
     * has nothing to fill it from; every signature then fails to recover to the
     * payer, and every payment is rejected for no visible reason. Passing the
     * price as money makes the SDK resolve the asset from its own table for
     * this network, which carries the domain with it.
     *
     * Base mainnet USDC is "USD Coin" version "2". It is "USDC" on Base
     * Sepolia, so this is also the detail that makes a testnet-verified rail
     * fail on mainnet.
     */
    price: `$${(PACK.priceCents / 100).toFixed(2)}`,
    maxTimeoutSeconds: 120,
  });

  const signature = request.headers.get('PAYMENT-SIGNATURE');

  if (!signature) {
    const required = await server.createPaymentRequiredResponse(
      requirements,
      resourceInfo
    );
    return NextResponse.json(
      {
        error: `Payment required: ${PACK.matches} match credits for $${(PACK.priceCents / 100).toFixed(2)} in USDC on Base.`,
        code: 'PAYMENT_REQUIRED',
      },
      { status: 402, headers: { 'PAYMENT-REQUIRED': b64(required) } }
    );
  }

  let payload: unknown;
  try {
    payload = unb64(signature);
  } catch {
    return NextResponse.json(
      {
        error: 'PAYMENT-SIGNATURE is not base64 JSON.',
        code: 'INVALID_PAYMENT',
      },
      { status: 400 }
    );
  }

  /**
   * Refused rather than settled when the payload carries no EIP-3009
   * authorization. A payment this rail cannot remember having honoured is a
   * payment it can be charged for twice.
   */
  const settlementId = settlementIdFor(payload);
  const payer = payerFrom(payload);
  if (!settlementId || !payer) {
    return NextResponse.json(
      {
        error: 'Payment payload carries no EIP-3009 authorization.',
        code: 'INVALID_PAYMENT',
      },
      { status: 400 }
    );
  }

  const accepted = requirements[0];
  const verification = await server.verifyPayment(
    payload as Parameters<typeof server.verifyPayment>[0],
    accepted
  );
  if (!verification.isValid) {
    return NextResponse.json(
      {
        error: verification.invalidReason ?? 'Payment did not verify.',
        code: 'PAYMENT_INVALID',
      },
      { status: 402 }
    );
  }

  const settlement = await server.settlePayment(
    payload as Parameters<typeof server.settlePayment>[0],
    accepted
  );
  if (!settlement.success) {
    return NextResponse.json(
      {
        error: settlement.errorReason ?? 'Payment did not settle.',
        code: 'SETTLEMENT_FAILED',
      },
      { status: 402 }
    );
  }

  // Money has moved. Everything below is recorded or reported loudly.
  try {
    const { userId } = await getOrCreateWalletAccount(payer);
    const granted = await grantPackBySettlement(
      userId,
      'agent',
      settlementId,
      PACK.priceCents
    );

    const created = await createApiKey(
      userId,
      `x402 ${payer.slice(0, 10)}`,
      CREDIT_API_PLAN
    );
    if (!created) throw new Error('Could not mint an API key.');

    const balance = await getBalance(userId);

    return NextResponse.json(
      {
        api_key: created.rawKey,
        // Said plainly, because this is the only time the key exists in
        // readable form and the buyer has no email to recover it through.
        shown_once: true,
        matches_available: balance.available,
        pack: PACK.name,
        // False means this authorization had already bought a pack. The key is
        // still fresh; the credits are the ones already paid for.
        newly_granted: granted,
        docs: 'https://docs.walletlink.social/mcp-server',
      },
      {
        status: 200,
        headers: { 'PAYMENT-RESPONSE': b64(settlement) },
      }
    );
  } catch (error) {
    /**
     * Settled and not recorded. The one manual path in this endpoint, and it
     * carries everything needed to close it: the grant is idempotent on this
     * settlement id, so issuing the pack by hand cannot issue it twice.
     */
    console.error(
      `[x402] SETTLED BUT NOT GRANTED settlement=${settlementId} payer=${payer} tx=${settlement.transaction}`,
      error
    );
    return NextResponse.json(
      {
        error:
          'Payment settled but the pack could not be recorded. Contact help@walletlink.social with the settlement reference.',
        code: 'GRANT_FAILED',
        settlement: settlementId,
      },
      { status: 500, headers: { 'PAYMENT-RESPONSE': b64(settlement) } }
    );
  }
}
