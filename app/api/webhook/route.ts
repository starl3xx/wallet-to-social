import { NextRequest, NextResponse } from 'next/server';
import {
  constructWebhookEvent,
  resolveCheckoutEmail,
  StripeConfigError,
} from '@/lib/stripe';
import {
  provisionPaidCheckout,
  type PaidTier,
} from '@/lib/access';
import { fulfilPackPurchase } from '@/lib/pack-fulfilment';
import { PACKS, isPackId, type PackId } from '@/lib/packs';
import type Stripe from 'stripe';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const signature = request.headers.get('stripe-signature');

    if (!signature) {
      return NextResponse.json(
        { error: 'Missing stripe-signature header' },
        { status: 400 }
      );
    }

    let event: Stripe.Event;
    try {
      event = constructWebhookEvent(body, signature);
    } catch (err) {
      // A misconfigured server is our fault, not the sender's, and it must not
      // be reported as a 400. Stripe retries 5xx and gives up on 4xx, so
      // answering 400 here would discard real payment events while the env var
      // was being fixed.
      if (err instanceof StripeConfigError) {
        console.error('Stripe webhook misconfigured:', err.message);
        return NextResponse.json(
          { error: 'Webhook not configured' },
          { status: 500 }
        );
      }
      console.error('Webhook signature verification failed:', err);
      return NextResponse.json(
        { error: 'Webhook signature verification failed' },
        { status: 400 }
      );
    }

    // Handle the event
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleCheckoutCompleted(session);
        break;
      }
      case 'payment_intent.succeeded': {
        // Backup handler in case checkout.session.completed doesn't fire.
        // Note this only ever runs if `payment_intent.succeeded` is actually
        // enabled on the endpoint in the Stripe dashboard; for most of this
        // project's life the endpoint subscribed to checkout.session.completed
        // alone, which made this "backup" unreachable.
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        await handlePaymentSucceeded(paymentIntent);
        break;
      }
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json(
      { error: 'Webhook handler failed' },
      { status: 500 }
    );
  }
}

/**
 * Grant a credit pack, from either provisioning path.
 *
 * Idempotent on `stripePaymentId` through a partial unique index, which is what
 * makes it safe to call from both `checkout.session.completed` and
 * `payment_intent.succeeded`. Whichever arrives second inserts nothing.
 *
 * `fulfilPackPurchase` creates the account if it does not exist, because a pack
 * can be the first thing someone ever buys. The tier path has the same
 * property, through `provisionPaidCheckout`.
 *
 * A pack never changes `users.tier`. Tier is the legacy one-time entitlement
 * and packs are credits; conflating them would either hand a pack buyer the old
 * unmetered Pro limits or retroactively meter someone who bought Unlimited.
 */
async function grantPackFromWebhook(
  email: string,
  pack: PackId,
  stripePaymentId: string,
  amountCents: number,
  via: string
) {
  const { granted } = await fulfilPackPurchase(
    email,
    pack,
    stripePaymentId,
    amountCents
  );
  console.log(
    granted
      ? `Granted ${PACKS[pack].matches} matches (${pack}) to ${email} via ${via}`
      : `Pack ${pack} for ${email} already granted for payment ${stripePaymentId}`
  );
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const email = resolveCheckoutEmail(session);
  const pack = session.metadata?.pack;

  // Packs first: a session carries either a pack or a tier, never both.
  if (email && pack && isPackId(pack)) {
    const paymentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id || session.id;
    await grantPackFromWebhook(
      email,
      pack,
      paymentId,
      // What Stripe actually charged, not what the pack table says. A price can
      // change between a checkout opening and completing, and this row is the
      // record of the payment rather than of the price list.
      session.amount_total ?? PACKS[pack].priceCents,
      'checkout.session'
    );
    return;
  }

  const tier = session.metadata?.tier as PaidTier | undefined;

  if (!email || !tier) {
    console.error('Missing email or tier in checkout session:', session.id);
    return;
  }

  const customerId =
    typeof session.customer === 'string'
      ? session.customer
      : session.customer?.id || '';

  const paymentIntentId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id || session.id;

  try {
    const result = await provisionPaidCheckout(
      email,
      tier,
      customerId,
      paymentIntentId,
      { sessionId: session.id, via: 'checkout.session' }
    );

    console.log(
      result.provisioned
        ? `Upgraded user ${email} to ${tier}`
        : `No upgrade for ${email}: ${result.reason}`
    );
  } catch (error) {
    console.error('Failed to upgrade user:', error);
    throw error;
  }
}

async function handlePaymentSucceeded(paymentIntent: Stripe.PaymentIntent) {
  const email = paymentIntent.metadata?.email;
  const pack = paymentIntent.metadata?.pack;

  if (email && pack && isPackId(pack)) {
    await grantPackFromWebhook(
      email,
      pack,
      paymentIntent.id,
      paymentIntent.amount_received || PACKS[pack].priceCents,
      'payment_intent'
    );
    return;
  }

  const tier = paymentIntent.metadata?.tier as PaidTier | undefined;

  if (!email || !tier) {
    // This is expected for non-upgrade payments
    return;
  }

  const customerId =
    typeof paymentIntent.customer === 'string'
      ? paymentIntent.customer
      : paymentIntent.customer?.id || '';

  try {
    // This path recorded no sale at all before, so a payment arriving here
    // rather than via checkout.session was invisible to revenue reporting.
    const result = await provisionPaidCheckout(
      email,
      tier,
      customerId,
      paymentIntent.id,
      { sessionId: paymentIntent.id, via: 'payment_intent' }
    );

    console.log(
      result.provisioned
        ? `Upgraded user ${email} to ${tier} (via payment_intent)`
        : `No upgrade for ${email}: ${result.reason}`
    );
  } catch (error) {
    console.error('Failed to upgrade user:', error);
    throw error;
  }
}
