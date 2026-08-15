import { NextRequest, NextResponse } from 'next/server';
import {
  constructWebhookEvent,
  resolveCheckoutEmail,
  StripeConfigError,
} from '@/lib/stripe';
import { provisionPaidCheckout, type PaidTier } from '@/lib/access';
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

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const email = resolveCheckoutEmail(session);
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
