/**
 * Buy Agent packs with USDC on Base. No account, no card, no email.
 *
 * POST with no payment answers 402 and a `PAYMENT-REQUIRED` header describing
 * what to pay. POST again with a `PAYMENT-SIGNATURE` header and the response
 * carries a fresh API key and the balance behind it.
 *
 * ## Three growth affordances, decided 2026-09-01 (docs/AGENT-SYSTEM.md, 18)
 *
 * **Quantity.** The body may carry `{"quantity": N}`, 1 to X402_MAX_QUANTITY.
 * One settlement buys N packs at linear price: the payment requirements demand
 * N times the pack price, and the grant is N times the matches. The quantity
 * is read from the same body on the unpaid 402 and on the paid retry, so the
 * amount the buyer signs is the amount the grant is computed from; a payload
 * signed for a different quantity fails verification against the requirements.
 *
 * **Top-up.** A buy that arrives with a valid `wts_live_` key in the
 * Authorization header credits THAT key's account instead of the wallet's, and
 * mints no key: a 402 mid-session becomes recoverable without a second
 * credential to manage. The credited account is proven by the key alone; the
 * body cannot name one. An OAuth token (`wts_mcp_`) is refused before any
 * money moves, because the docs promise an OAuth connection cannot buy or
 * spend on a person's behalf. An Authorization header that is neither is also
 * refused before settlement: guessing at intent after money moved would credit
 * someone the caller did not choose.
 *
 * **Loyalty.** Every X402_LOYALTY_EVERY_N-th settled purchase from the same
 * wallet grants one bonus Agent pack of matches, to whichever account that
 * settlement credited. The count is the wallet's settlement history in
 * `credit_lots` (see countSettledPurchases): bonus lots carry no settlement id
 * so they never count, and a replayed authorization cannot add a row, so the
 * bonus is not reachable by replay.
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
  quantityFrom,
  BASE_MAINNET,
} from '@/lib/x402';
import {
  X402_PACKS,
  X402_MAX_QUANTITY,
  X402_LOYALTY_EVERY_N,
} from '@/lib/packs';
import {
  grantPackBySettlement,
  grantCredits,
  getBalance,
  lotForSettlement,
} from '@/lib/credits';
import {
  getOrCreateWalletAccount,
  countSettledPurchases,
} from '@/lib/x402-account';
import { createApiKeyIfUnderCap, validateApiKey } from '@/lib/api-keys';
import { readBodyCapped } from '@/lib/api-auth';
import { looksLikeAccessToken } from '@/lib/oauth/grants';
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

/**
 * The body is one optional integer; a kilobyte holds it a hundred times over.
 * The endpoint took no body at all before quantity, so anything large here is
 * not a buyer.
 */
const MAX_BODY_BYTES = 1_000;

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

  /**
   * The quantity, read BEFORE the requirements are built, because it decides
   * the amount the payment must verify against. It is read identically on the
   * unpaid 402 and on the paid retry, so the challenge an agent signs and the
   * verification its payment meets are built from the same number; an x402
   * client resends the same body with its payment, which is what keeps the
   * two in step.
   */
  // No body at all is the pre-quantity shape and stays valid; readBodyCapped
  // returns null for BOTH a missing stream and an over-cap one, so the two
  // are told apart here.
  const rawBody = request.body
    ? await readBodyCapped(request, MAX_BODY_BYTES)
    : '';
  if (rawBody === null) {
    return NextResponse.json(
      { error: 'Request body too large.', code: 'INVALID_REQUEST' },
      { status: 400 }
    );
  }
  let parsedBody: unknown = undefined;
  if (rawBody.trim().length > 0) {
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        { error: 'Request body is not JSON.', code: 'INVALID_REQUEST' },
        { status: 400 }
      );
    }
  }
  const quantity = quantityFrom(parsedBody);
  if (quantity === null) {
    return NextResponse.json(
      {
        error: `quantity must be an integer from 1 to ${X402_MAX_QUANTITY}. Omit it to buy one pack.`,
        code: 'INVALID_QUANTITY',
      },
      { status: 400 }
    );
  }
  const totalCents = PACK.priceCents * quantity;
  const totalMatches = PACK.matches * quantity;

  /**
   * The top-up credential, resolved BEFORE anything verifies or settles.
   *
   * Money must never move down a path this endpoint will then refuse, so
   * every refusal that depends on the Authorization header happens here:
   *
   *  - an OAuth access token is refused outright. The MCP docs promise a
   *    connection cannot buy credits or spend money, and that promise binds
   *    this endpoint, not just the tools.
   *  - a header that does not validate as a `wts_live_` key is refused rather
   *    than ignored. The caller plainly meant to bind this purchase to an
   *    account; crediting the wallet-derived account instead would put paid
   *    credits where the buyer cannot see them.
   *
   * When the key validates, the credited account is the KEY'S account, read
   * from the validated row. Nothing in the body can name an account, so the
   * top-up can only ever credit an account the presented key proves.
   */
  const authHeader = request.headers.get('Authorization');
  let topUp: { userId: string; keyPrefix: string } | null = null;
  if (authHeader) {
    const bearer = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : authHeader;
    if (looksLikeAccessToken(bearer)) {
      return NextResponse.json(
        {
          error:
            'An OAuth connection cannot buy credits. Top-ups bind to a wts_live_ API key; send one in the Authorization header, or send no header to buy wallet-keyed credits.',
          code: 'OAUTH_CANNOT_BUY',
        },
        { status: 403 }
      );
    }
    const keyResult = await validateApiKey(bearer);
    if (!keyResult) {
      return NextResponse.json(
        {
          error:
            'The Authorization header did not validate as an API key, so this purchase was not settled: a top-up must credit the account the key proves. Fix the key, or remove the header to buy wallet-keyed credits.',
          code: 'INVALID_TOPUP_KEY',
        },
        { status: 401 }
      );
    }
    topUp = {
      userId: keyResult.key.userId,
      keyPrefix: keyResult.key.keyPrefix,
    };
  }

  const server = await getResourceServer();

  const resourceInfo = {
    url: 'https://walletlink.social/api/x402/buy',
    description: `${PACK.name} pack: ${PACK.matches} match credits for wallet identity lookups. One settlement buys 1 to ${X402_MAX_QUANTITY} packs at linear price via {"quantity": N}.`,
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
          // One optional field. The payment itself is a header, not a payload.
          body: { quantity: 1 },
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
                properties: {
                  quantity: {
                    type: 'integer',
                    minimum: 1,
                    maximum: X402_MAX_QUANTITY,
                    description:
                      'Packs to buy in this one settlement, at linear price. Omit for one. The 402 challenge scales to it, so send the same body with the payment.',
                  },
                },
                description:
                  'Optionally {"quantity": N}. The signed payment travels in the PAYMENT-SIGNATURE header, not in the body.',
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
     *
     * Scaled by the quantity from the request body, so the amount the buyer
     * is challenged for, the amount the payment verifies against, and the
     * amount the grant is computed from are all the same multiplication.
     */
    price: `$${(totalCents / 100).toFixed(2)}`,
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
        error: `Payment required: ${totalMatches} match credits for $${(totalCents / 100).toFixed(2)} in USDC on Base${quantity > 1 ? ` (${quantity} packs, one settlement)` : ''}.`,
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
    /**
     * A replayed TOP-UP is a success report, not a key-loss condition: no key
     * ever existed for this payment, the credits are on the account the
     * presented key proves, and the retrying client is most likely the same
     * one whose success response was lost in transit. Recognised only when
     * the replay itself carries the key that owns the credited account;
     * without that proof the reply must not name where the credits live.
     */
    if (topUp && topUp.userId === already.userId) {
      return NextResponse.json({
        api_key: null,
        credited_to_key_prefix: topUp.keyPrefix,
        newly_granted: false,
        matches_added: 0,
        matches_available: balance.available,
        pack: PACK.name,
        note: 'This payment was already honoured as a top-up to this account. Nothing was charged this time; the balance above is current.',
        code: 'ALREADY_HONOURED',
        settlement: settlementId,
        docs: 'https://docs.walletlink.social/agent-pack',
      });
    }
    return NextResponse.json({
      api_key: null,
      // Already paid for. Nothing was charged this time.
      newly_granted: false,
      matches_available: balance.available,
      pack: PACK.name,
      error:
        'This payment has already been honoured. If it minted a key, that key was shown once and cannot be reissued from the payment, because every field of a settled payment is public; if it was a top-up, the credits are already on the account of the key presented with the purchase. Contact help@walletlink.social with the settlement reference.',
      code: 'ALREADY_HONOURED',
      settlement: settlementId,
      docs: 'https://docs.walletlink.social/agent-pack',
    });
  }

  /**
   * The signed amount is asserted HERE, not only at the facilitator. The
   * reference facilitator enforces authorization.value === requirements.amount
   * strictly, but with quantity in play a swapped or broken facilitator URL
   * would turn that remote check into the only thing standing between a $1
   * signature and a $25 grant. USDC carries six decimals, so cents scale by
   * 10,000. Refused before verify so money never moves down a mismatch.
   */
  const signedValue = (
    payload as { payload?: { authorization?: { value?: unknown } } }
  )?.payload?.authorization?.value;
  const expectedValue = BigInt(totalCents) * BigInt(10_000);
  let signedMatches = false;
  try {
    signedMatches =
      signedValue !== undefined &&
      BigInt(String(signedValue)) === expectedValue;
  } catch {
    signedMatches = false;
  }
  if (!signedMatches) {
    return NextResponse.json(
      {
        error: `The signed amount does not match the price of this purchase ($${(totalCents / 100).toFixed(2)}). Sign the exact amount the 402 requirements name.`,
        code: 'PAYMENT_INVALID',
      },
      { status: 402 }
    );
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
    /**
     * Who the credits land on. A top-up proves an account with the validated
     * key and touches no wallet account at all; otherwise the wallet's own
     * account is found or created exactly as before.
     */
    const { userId } = topUp ?? (await getOrCreateWalletAccount(payer));
    const granted = await grantPackBySettlement(
      userId,
      'agent',
      settlementId,
      totalCents,
      quantity
    );

    /**
     * The loyalty bonus (gap 18). Only on a grant that actually wrote:
     * `granted` is false exactly when this settlement was already honoured,
     * so a replay can never reach this branch and the bonus is not grantable
     * by replay. The count is the paying WALLET's settled history, whichever
     * account each settlement credited, and the bonus lands on the account
     * this settlement credited. Two genuinely concurrent settlements at the
     * boundary could in principle both read the milestone count; that costs
     * one bonus pack and requires two real paid settlements in the same
     * instant, which is a price list, not a hole.
     */
    let loyalty: { bonus_matches: number; settled_purchases: number } | null =
      null;
    if (granted) {
      /**
       * Its own try, deliberately. The pack lot above is already written, so
       * a failure HERE must not turn the response into GRANT_FAILED: the
       * retry would then read ALREADY_HONOURED and the buyer would count a
       * real purchase as lost. A missed bonus is a support line item, logged
       * with the settlement reference; a misreported purchase is a refund.
       */
      try {
        const settled = await countSettledPurchases(payer);
        if (settled > 0 && settled % X402_LOYALTY_EVERY_N === 0) {
          await grantCredits(
            userId,
            PACK.matches,
            `x402 loyalty bonus: settled purchase ${settled} from ${payer}`
          );
          loyalty = { bonus_matches: PACK.matches, settled_purchases: settled };
        }
      } catch (error) {
        console.error(
          `x402 loyalty bonus failed for settlement ${settlementId}; grant by hand if the milestone stands:`,
          error
        );
      }
    }

    /**
     * A top-up mints nothing. The buyer already holds the credential the
     * credits landed behind; a fresh key would be a second secret to lose,
     * and the account is named only by the prefix the caller already knows.
     */
    if (topUp) {
      const balance = await getBalance(userId);
      return NextResponse.json(
        {
          api_key: null,
          credited_to_key_prefix: topUp.keyPrefix,
          matches_added: granted ? totalMatches : 0,
          quantity,
          matches_available: balance.available,
          pack: PACK.name,
          newly_granted: granted,
          ...(loyalty ? { loyalty_bonus: loyalty } : {}),
          docs: 'https://docs.walletlink.social/agent-pack',
        },
        { status: 200, headers: { 'PAYMENT-RESPONSE': b64(settlement) } }
      );
    }

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
          matches_added: granted ? totalMatches : 0,
          quantity,
          matches_available: balance.available,
          pack: PACK.name,
          newly_granted: granted,
          ...(loyalty ? { loyalty_bonus: loyalty } : {}),
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
        matches_added: granted ? totalMatches : 0,
        quantity,
        matches_available: balance.available,
        pack: PACK.name,
        // False means this authorization had already bought a pack. The key is
        // still fresh; the credits are the ones already paid for.
        newly_granted: granted,
        ...(loyalty ? { loyalty_bonus: loyalty } : {}),
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
