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
import {
  grantPackBySettlement,
  getBalance,
  lotForSettlement,
} from '@/lib/credits';
import { getOrCreateWalletAccount } from '@/lib/x402-account';
import { createApiKeyIfUnderCap } from '@/lib/api-keys';
import { CREDIT_API_PLAN } from '@/lib/api-plans';

export const runtime = 'nodejs';

const PACK = X402_PACKS.agent;

/**
 * Active keys one wallet account may hold.
 *
 * Low on purpose. Its only job is to bound key minting from a replayed
 * payload; a buyer needs one key, and a second is a rotation.
 */
const X402_MAX_KEYS = 3;

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
    // Free-text, and the only thing a discovery index can filter on. There is
    // no category field: a scan of the live index found 14,344 resources with
    // freeform tags and no taxonomy at all.
    tags: ['wallet', 'identity', 'social', 'farcaster', 'ens', 'base'],
  };

  /**
   * What a discovery index reads before an agent decides whether to pay.
   *
   * A discovery index lists only what declares itself. Coinbase's Bazaar
   * indexes resources whose 402 carries an `extensions.bazaar` block, and this
   * route carried none, so walletlink was absent from all 14,344 indexed
   * resources when this shipped. It was absent from the payai index too, so
   * the rail was invisible to both.
   *
   * The shape is not in the SDK: `extensions` is typed `Record<string,
   * unknown>` and the contract belongs to the index. It was read off live
   * indexed resources rather than from a docs page, which is also where the
   * `schema` sibling came from; a description of the block that mentions only
   * `info` is incomplete.
   *
   * The input matters more here than on a typical resource. This endpoint
   * takes no request body: the signed payment travels in the PAYMENT-SIGNATURE
   * header, and an agent that posts a body gets nothing for it. Saying so here
   * is the difference between a resource an agent can use and one it can only
   * find.
   */
  const BAZAAR_EXTENSIONS = {
    bazaar: {
      info: {
        input: {
          type: 'http',
          method: 'POST',
          bodyType: 'json',
          // Deliberately empty. The payment is a header, not a payload.
          body: {},
        },
        output: {
          type: 'json',
          example: {
            api_key: 'wts_live_…',
            shown_once: true,
            matches_available: PACK.matches,
            pack: PACK.name,
            newly_granted: true,
            docs: 'https://docs.walletlink.social/agent-pack',
          },
        },
      },
      /**
       * The schema describes `info` itself, not the endpoint's payload, and
       * `input` sets `additionalProperties: false`. So every key present in
       * `info.input` above must be listed here or a validating facilitator
       * drops the resource, which is the exact outcome this block exists to
       * prevent. Read off a live indexed POST resource: same four keys, all
       * four required, and only `input` is closed.
       */
      schema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        required: ['input'],
        properties: {
          input: {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'method', 'bodyType', 'body'],
            properties: {
              type: { type: 'string', const: 'http' },
              method: { type: 'string', enum: ['POST'] },
              bodyType: { type: 'string', enum: ['json'] },
              body: {
                type: 'object',
                additionalProperties: false,
                properties: {},
                description:
                  'Empty. The signed payment travels in the PAYMENT-SIGNATURE header, not in the body, so an agent that posts a payload gets nothing for it.',
              },
            },
          },
          output: {
            type: 'object',
            required: ['type', 'example'],
            properties: {
              type: { type: 'string', const: 'json' },
              example: {
                type: 'object',
                required: ['matches_available', 'pack', 'newly_granted'],
                properties: {
                  api_key: {
                    type: ['string', 'null'],
                    description:
                      'Shown once and never reissued, because every field of a settled payment is public.',
                  },
                  shown_once: { type: 'boolean' },
                  matches_available: { type: 'integer' },
                  pack: { type: 'string' },
                  newly_granted: { type: 'boolean' },
                  docs: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
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
      resourceInfo,
      // `error` is the third parameter and there is none to report: this is the
      // ordinary unpaid response, not a failure. Skipping it to reach
      // `extensions` in fourth position.
      undefined,
      BAZAAR_EXTENSIONS
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

  /**
   * Has this payment already been honoured?
   *
   * Asked before anything is verified or settled, because settlement is the
   * one step that cannot be repeated: the authorization is spent onchain the
   * first time, so a second `settlePayment` for the same payload fails. The
   * first version went straight to settle, which meant a caller who lost the
   * response retried into a settlement error and could never reach the
   * idempotent grant that exists to serve exactly them. They had paid, and the
   * only route to their key was a support thread.
   *
   * A fresh key rather than the old one, because only the hash of that was
   * ever stored. The cap is what bounds a replay: the credits are the ones
   * already bought either way, so an extra key buys nothing, but unbounded key
   * minting from a replayed payload is still not a thing to leave open.
   */
  const accepted = requirements[0];
  /**
   * Has this payment already been honoured?
   *
   * Asked before anything is verified or settled, because settlement is the one
   * step that cannot be repeated: the authorization is spent onchain the first
   * time, so a second `settlePayment` for the same payload fails. Without this,
   * a caller who lost the response retried into a settlement error rather than
   * being told what they already own.
   *
   * ## No key is issued here, and no version of this check could safely issue
   * one
   *
   * Two earlier attempts tried. The first matched on `from` and `nonce`, which
   * are both in USDC's public `AuthorizationUsed` event. The second verified
   * the EIP-3009 signature, which the facilitator submits as
   * `transferWithAuthorization` calldata, so it is public too. Once a payment
   * settles, every field of it is on a public chain: there is nothing in a
   * payment payload that can prove who is holding the wallet now.
   *
   * Proving that needs a challenge the server issued and the wallet signed,
   * which is a recovery endpoint and not this one. So this branch reports what
   * the payment bought and mints nothing. It is idempotent, it cannot be
   * charged twice, and there is no key here for a stranger to take.
   */
  const already = await lotForSettlement(settlementId);
  if (already) {
    const balance = await getBalance(already.userId);
    return NextResponse.json({
      api_key: null,
      // Already paid for. Nothing was charged this time.
      newly_granted: false,
      matches_available: balance.available,
      pack: PACK.name,
      error:
        'This payment has already been honoured. Its key was shown once and cannot be reissued from the payment, because every field of a settled payment is public. Contact help@walletlink.social with the settlement reference.',
      code: 'ALREADY_HONOURED',
      settlement: settlementId,
      docs: 'https://docs.walletlink.social/agent-pack',
    });
  }

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

    const created = await createApiKeyIfUnderCap(
      userId,
      `x402 ${payer.slice(0, 10)}`,
      CREDIT_API_PLAN,
      X402_MAX_KEYS
    );
    if (!created)
      throw new Error('Could not reach the database to mint a key.');

    /**
     * Being at the key cap is not a failed purchase.
     *
     * The pack is recorded by this point and the money moved before that, so
     * throwing here would answer `GRANT_FAILED` for a payment that succeeded
     * and credits that exist. The account already holds three working keys;
     * the honest answer is the balance and why there is no fourth.
     */
    const balance = await getBalance(userId);
    if ('capReached' in created) {
      return NextResponse.json(
        {
          api_key: null,
          key_cap_reached: true,
          error: `The pack was added. This wallet already holds ${X402_MAX_KEYS} active keys, so no new one was issued; use an existing key, or revoke one and replay this payment.`,
          matches_available: balance.available,
          pack: PACK.name,
          newly_granted: granted,
          docs: 'https://docs.walletlink.social/agent-pack',
        },
        { status: 200, headers: { 'PAYMENT-RESPONSE': b64(settlement) } }
      );
    }

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
        docs: 'https://docs.walletlink.social/agent-pack',
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
