import Stripe from 'stripe';
import { getSiteUrl } from '@/lib/site-url';

// Initialize Stripe with secret key
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;

export type CheckoutTier = 'starter' | 'pro' | 'unlimited';

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

  const priceId =
    tier === 'unlimited'
      ? process.env.STRIPE_PRICE_UNLIMITED
      : tier === 'pro'
        ? process.env.STRIPE_PRICE_PRO
        : process.env.STRIPE_PRICE_STARTER;

  if (!priceId) {
    throw new Error(`Price not configured for tier: ${tier}`);
  }

  // Resolved centrally. This line read `process.env.NEXT_PUBLIC_URL ||
  // 'http://localhost:3000'`, and because that variable was never set in
  // production, two live payments were redirected to a dead localhost port.
  const baseUrl = getSiteUrl();

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer_email: email,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${baseUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: baseUrl,
    metadata: {
      tier,
      email,
    },
    payment_intent_data: {
      metadata: {
        tier,
        email,
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
  // Deliberately does NOT require STRIPE_PRICE_STARTER. Starter was retired on
  // 2026-08-12 and the checkout route rejects it outright, so gating on its
  // price id meant deleting a dead env var would take the entire payment system
  // down with a "Payment system not configured" 503 on every purchase, for a
  // product that can no longer be bought.
  return !!(
    process.env.STRIPE_SECRET_KEY &&
    process.env.STRIPE_PRICE_PRO &&
    process.env.STRIPE_PRICE_UNLIMITED
  );
}
