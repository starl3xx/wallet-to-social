import { NextRequest, NextResponse } from 'next/server';
import { constructWebhookEvent } from '@/lib/stripe';
import { upgradeUser } from '@/lib/access';
import { trackEvent } from '@/lib/analytics';
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
        // Backup handler in case checkout.session.completed doesn't fire
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
  const email = session.customer_email || session.metadata?.email;
  const tier = session.metadata?.tier as 'starter' | 'pro' | 'unlimited' | undefined;

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
    await upgradeUser(email, tier, customerId, paymentIntentId);
    console.log(`Upgraded user ${email} to ${tier}`);

    // Track payment completed event
    const amountCents = tier === 'starter' ? 4900 : tier === 'pro' ? 14900 : tier === 'unlimited' ? 42000 : 0;
    trackEvent('payment_completed', {
      userId: email,
      metadata: {
        tier,
        amountCents,
        stripeSessionId: session.id,
        stripeCustomerId: customerId,
      },
    });
  } catch (error) {
    console.error('Failed to upgrade user:', error);
    throw error;
  }
}

async function handlePaymentSucceeded(paymentIntent: Stripe.PaymentIntent) {
  const email = paymentIntent.metadata?.email;
  const tier = paymentIntent.metadata?.tier as 'starter' | 'pro' | 'unlimited' | undefined;

  if (!email || !tier) {
    // This is expected for non-upgrade payments
    return;
  }

  const customerId =
    typeof paymentIntent.customer === 'string'
      ? paymentIntent.customer
      : paymentIntent.customer?.id || '';

  try {
    await upgradeUser(email, tier, customerId, paymentIntent.id);
    console.log(`Upgraded user ${email} to ${tier} (via payment_intent)`);
  } catch (error) {
    console.error('Failed to upgrade user:', error);
    throw error;
  }
}
