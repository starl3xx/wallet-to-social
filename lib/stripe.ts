import Stripe from 'stripe';
import { getSiteUrl } from '@/lib/site-url';
import { PACKS, isPackId, type PackId } from '@/lib/packs';

// Initialize Stripe with secret key
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;

export type CheckoutTier = 'pro' | 'unlimited';

interface CheckoutSessionResult {
  url: string;
  sessionId: string;
}

/**
 * Create a checkout session for a credit pack.
 *
 * This replaced `createCheckoutSession(email, tier)`, which sold the legacy
 * tiers and was deleted once nothing called it. The two sold different
 * things: a tier was a permanent grant keyed on the account, a pack is a dated
 * lot keyed on the payment, which is why the webhook reads `metadata.pack` for
 * new payments and `metadata.tier` only off historical ones.
 *
 * Same `mode: 'payment'`. That is the point of packs: no subscription
 * lifecycle, no portal, no dunning, no proration, and no revocation path.
 */
export async function createPackCheckoutSession(
  email: string,
  pack: PackId
): Promise<CheckoutSessionResult> {
  if (!stripe) {
    throw new Error('Stripe not configured');
  }

  // Same normalisation as the tier path, for the same reason: `customers.list`
  // matches case-sensitively while everything downstream lowercases.
  const normalizedEmail = email.trim().toLowerCase();

  const priceId = process.env[PACKS[pack].priceEnvVar];
  if (!priceId) {
    throw new Error(`${PACKS[pack].priceEnvVar} is not configured`);
  }

  const baseUrl = getSiteUrl();

  const found = await stripe.customers.list({
    email: normalizedEmail,
    limit: 1,
  });
  const existingCustomerId = found.data[0]?.id;

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    ...(existingCustomerId
      ? { customer: existingCustomerId }
      : {
          customer_email: normalizedEmail,
          customer_creation: 'always' as const,
        }),
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${baseUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: baseUrl,
    metadata: {
      pack,
      email: normalizedEmail,
    },
    // Mirrored onto the PaymentIntent because the webhook has two provisioning
    // paths and either may be the one that fires. A pack visible on only one of
    // them is a payment taken with no credits granted.
    payment_intent_data: {
      metadata: {
        pack,
        email: normalizedEmail,
      },
    },
  });

  if (!session.url) {
    throw new Error('Failed to create checkout session URL');
  }

  return { url: session.url, sessionId: session.id };
}

/**
 * Thrown when the server is missing Stripe configuration, as distinct from a
 * request that failed verification.
 *
 * These used to be indistinguishable: a missing secret key, a missing webhook
 * secret and a forged signature all surfaced as the same 400 "signature
 * verification failed". That reads as "the sender is wrong" when it can equally
 * mean "this deployment is misconfigured", and it is the difference between
 * blaming Stripe and looking at your own env vars.
 */
export class StripeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StripeConfigError';
  }
}

/**
 * Construct and verify a webhook event from Stripe
 */
export function constructWebhookEvent(
  body: string,
  signature: string
): Stripe.Event {
  if (!stripe) {
    throw new StripeConfigError('STRIPE_SECRET_KEY is not set');
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new StripeConfigError('STRIPE_WEBHOOK_SECRET is not set');
  }

  return stripe.webhooks.constructEvent(body, signature, webhookSecret);
}

/**
 * The email an entitlement is granted to for a checkout session.
 *
 * The webhook (which performs the upgrade) and the /success poll (which waits
 * for it) MUST resolve this identically. `customer_email` is the address we
 * passed when creating the session; `customer_details.email` is whatever the
 * buyer actually typed into Stripe Checkout, and the two diverge the moment a
 * buyer edits the prefilled address. If the two paths disagree, the upgrade
 * lands on one account while the poll asks about the other: the payment
 * succeeds and /success spins until it times out.
 *
 * `customer_details.email` is deliberately NOT consulted: the webhook grants
 * entitlement, so the webhook's notion of the address is the authoritative one.
 * Both callers go through this function so they cannot drift apart again.
 */
export function resolveCheckoutEmail(
  session: Stripe.Checkout.Session
): string | null {
  return session.customer_email || session.metadata?.email || null;
}

/**
 * Retrieve a checkout session by ID
 */
export async function getCheckoutSession(
  sessionId: string
): Promise<Stripe.Checkout.Session | null> {
  if (!stripe) {
    return null;
  }

  try {
    return await stripe.checkout.sessions.retrieve(sessionId);
  } catch (error) {
    console.error('Error retrieving checkout session:', error);
    return null;
  }
}

/**
 * One settled payment, normalised for reporting.
 *
 * `netCents` is what actually stayed: gross minus anything refunded. The admin
 * dashboard used to derive revenue from a user's *tier* instead (`unlimited`
 * implied $249), which is wrong in both directions. It invents revenue for a
 * gifted or whitelisted account, and it cannot see a refund at all, so on
 * 2026-08-15 a $99 sale with a $99 duplicate refunded and a complimentary
 * upgrade reported as $249.
 */
export interface PaymentRecord {
  id: string;
  email: string | null;
  /** Set on the two legacy one-time purchases and nothing since. */
  tier: CheckoutTier | null;
  /**
   * The pack bought, from `metadata.pack`, or null for a tier payment.
   *
   * `createPackCheckoutSession` writes `pack` and never `tier`, so before this
   * field existed every pack payment normalised to `tier: null` and the admin
   * revenue breakdown could not see the only thing being sold.
   */
  pack: PackId | null;
  amountCents: number;
  refundedCents: number;
  netCents: number;
  created: string;
  fullyRefunded: boolean;
}

/**
 * Every settled payment, newest first.
 *
 * Stripe is the source of truth for money, not our users table. Payment intents
 * rather than charges, because our tier and email metadata is set at intent
 * creation; `latest_charge` is expanded to get the refunded amount, which lives
 * on the charge.
 */
export async function listPayments(
  maxRecords = 300
): Promise<{ payments: PaymentRecord[]; truncated: boolean }> {
  if (!stripe) return { payments: [], truncated: false };

  const payments: PaymentRecord[] = [];
  let startingAfter: string | undefined;
  let truncated = false;

  while (payments.length < maxRecords) {
    const page = await stripe.paymentIntents.list({
      limit: 100,
      expand: ['data.latest_charge'],
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });

    for (const pi of page.data) {
      if (pi.status !== 'succeeded') continue;

      const charge =
        pi.latest_charge && typeof pi.latest_charge !== 'string'
          ? pi.latest_charge
          : null;

      const amountCents = charge?.amount ?? pi.amount_received ?? 0;
      const refundedCents = charge?.amount_refunded ?? 0;

      payments.push({
        id: pi.id,
        email:
          pi.metadata?.email ||
          charge?.billing_details?.email ||
          charge?.receipt_email ||
          null,
        tier: (pi.metadata?.tier as CheckoutTier | undefined) ?? null,
        // Validated rather than cast: metadata is free text on Stripe's side,
        // and a typo there should read as "no pack", not index PACKS.
        pack:
          pi.metadata?.pack && isPackId(pi.metadata.pack)
            ? pi.metadata.pack
            : null,
        amountCents,
        refundedCents,
        netCents: amountCents - refundedCents,
        created: new Date(pi.created * 1000).toISOString(),
        fullyRefunded: refundedCents > 0 && refundedCents >= amountCents,
      });
    }

    if (!page.has_more) break;
    startingAfter = page.data[page.data.length - 1]?.id;
    if (!startingAfter) break;
    if (payments.length >= maxRecords) {
      truncated = true;
      break;
    }
  }

  return { payments, truncated };
}

/**
 * Check if Stripe is configured
 */
/**
 * Can this deployment take a payment at all?
 *
 * The secret key, and nothing else. Which *price* is needed depends on what is
 * being bought, and both purchase paths already check their own: the tier path
 * throws "Price not configured for tier", the pack path throws
 * "STRIPE_PRICE_PACK_TRIAL is not configured". Both name the missing variable,
 * which a blanket 503 never could.
 *
 * It used to also require STRIPE_PRICE_PRO and STRIPE_PRICE_UNLIMITED, and that
 * was the same mistake this function's previous comment already described: it
 * had required STRIPE_PRICE_STARTER, so deleting a retired variable would have
 * 503'd every purchase for a product nobody could buy. Packs made it live
 * again. Pro and Unlimited are no longer sold, removing their variables is the
 * obvious tidy-up, and doing it would have taken pack checkout down with them.
 *
 * Caught by testing locally with only the pack variables set, which is exactly
 * the configuration a fresh deployment would have.
 */
export function isStripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}
