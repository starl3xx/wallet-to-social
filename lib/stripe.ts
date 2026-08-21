import Stripe from 'stripe';
import { getSiteUrl } from '@/lib/site-url';
import { PACKS, type PackId } from '@/lib/packs';

// Initialize Stripe with secret key
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;

export type CheckoutTier = 'pro' | 'unlimited';

interface CheckoutSessionResult {
  url: string;
  sessionId: string;
}

/**
 * Create a Stripe checkout session for one-time payment
 */
export async function createCheckoutSession(
  email: string,
  tier: CheckoutTier
): Promise<CheckoutSessionResult> {
  if (!stripe) {
    throw new Error('Stripe not configured');
  }

  /**
   * One casing for the whole checkout.
   *
   * `stripe.customers.list({ email })` matches case-sensitively, while
   * `provisionPaidCheckout` and `getUserByEmail` both lowercase before they
   * compare. The upgrade modal also asks the buyer to type their address again,
   * so "Jake@Example.com" on the second purchase would miss the Customer created
   * for "jake@example.com", make a second one, and orphan the first: exactly the
   * duplicate this reuse logic exists to prevent.
   *
   * Normalising here fixes the account lookup too, because the webhook resolves
   * entitlement from `customer_email` and `metadata.email`, which are both set
   * below.
   */
  const normalizedEmail = email.trim().toLowerCase();

  const priceId =
    tier === 'unlimited'
      ? process.env.STRIPE_PRICE_UNLIMITED
      : process.env.STRIPE_PRICE_PRO;

  if (!priceId) {
    throw new Error(`Price not configured for tier: ${tier}`);
  }

  // Resolved centrally. This line read `process.env.NEXT_PUBLIC_URL ||
  // 'http://localhost:3000'`, and because that variable was never set in
  // production, two live payments were redirected to a dead localhost port.
  const baseUrl = getSiteUrl();

  /**
   * Reuse this buyer's Customer if Stripe already has one.
   *
   * Two things are being fixed here at once, and they pull in opposite
   * directions.
   *
   * `customer_creation` defaults to `if_required`, and a one-time card payment
   * never requires a Customer, so Stripe created none at all: the account held
   * zero Customer objects despite real completed sales, every payment stored an
   * empty `stripe_customer_id`, and the admin Users pane showed a dash next to
   * every paying account. `customer_email` only prefills the field.
   *
   * But `customer_creation: 'always'` on its own creates a *new* Customer for
   * every checkout. A buyer upgrading from Pro to Unlimited would get a second
   * Customer, overwrite the stored id with it, and orphan the first, which is
   * the opposite of the single identity this is meant to give.
   *
   * So: look the buyer up by email first. Attach the session to the existing
   * Customer when there is one, and only ask Stripe to create a Customer when
   * there is not. Stripe rejects a session that sets both `customer` and
   * `customer_email`, hence the either/or.
   *
   * The lookup goes to Stripe rather than to our own `stripeCustomerId`, because
   * Stripe is the authority and every account predating this change has no
   * stored id to offer.
   */
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
      tier,
      email: normalizedEmail,
    },
    payment_intent_data: {
      metadata: {
        tier,
        email: normalizedEmail,
      },
    },
  });

  if (!session.url) {
    throw new Error('Failed to create checkout session URL');
  }

  return {
    url: session.url,
    sessionId: session.id,
  };
}

/**
 * Create a checkout session for a credit pack.
 *
 * Deliberately a second function rather than a branch inside
 * `createCheckoutSession`. The two sell different things: a tier is a
 * permanent grant keyed on the account, a pack is a dated lot keyed on the
 * payment. They share the Customer-reuse logic and nothing else, and folding
 * them together would mean a `tier ?? pack` metadata shape that the webhook has
 * to disambiguate on every event.
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
 * lands on one account while the poll asks about the other — the payment
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
  tier: CheckoutTier | null;
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
export function isStripeConfigured(): boolean {
  // Only the tiers that can actually be bought. This used to also require
  // STRIPE_PRICE_STARTER, so deleting that retired variable would have taken the
  // whole payment system down with a "Payment system not configured" 503 on
  // every purchase, for a product nobody could buy.
  return !!(
    process.env.STRIPE_SECRET_KEY &&
    process.env.STRIPE_PRICE_PRO &&
    process.env.STRIPE_PRICE_UNLIMITED
  );
}
