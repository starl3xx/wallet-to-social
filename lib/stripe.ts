import Stripe from 'stripe';

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

  const priceId =
    tier === 'unlimited'
      ? process.env.STRIPE_PRICE_UNLIMITED
      : process.env.STRIPE_PRICE_PRO;

  if (!priceId) {
    throw new Error(`Price not configured for tier: ${tier}`);
  }

  const baseUrl = process.env.NEXT_PUBLIC_URL || 'http://localhost:3000';

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
 * Construct and verify a webhook event from Stripe
 */
export function constructWebhookEvent(
  body: string,
  signature: string
): Stripe.Event {
  if (!stripe) {
    throw new Error('Stripe not configured');
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new Error('Stripe webhook secret not configured');
  }

  return stripe.webhooks.constructEvent(body, signature, webhookSecret);
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
 * Check if Stripe is configured
 */
export function isStripeConfigured(): boolean {
  return !!(
    process.env.STRIPE_SECRET_KEY &&
    process.env.STRIPE_PRICE_PRO &&
    process.env.STRIPE_PRICE_UNLIMITED
  );
}
