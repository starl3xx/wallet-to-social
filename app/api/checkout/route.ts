import { NextRequest, NextResponse } from 'next/server';
import { createCheckoutSession, isStripeConfigured, type CheckoutTier } from '@/lib/stripe';

export const runtime = 'nodejs';

interface CheckoutRequest {
  email: string;
  tier: CheckoutTier;
}

export async function POST(request: NextRequest) {
  try {
    if (!isStripeConfigured()) {
      return NextResponse.json(
        { error: 'Payment system not configured' },
        { status: 503 }
      );
    }

    const body: CheckoutRequest = await request.json();
    const { email, tier } = body;

    if (!email || !email.includes('@')) {
      return NextResponse.json(
        { error: 'Valid email required' },
        { status: 400 }
      );
    }

    if (tier !== 'starter' && tier !== 'pro' && tier !== 'unlimited') {
      return NextResponse.json(
        { error: 'Invalid tier. Must be "starter", "pro", or "unlimited"' },
        { status: 400 }
      );
    }

    const { url, sessionId } = await createCheckoutSession(email, tier);

    return NextResponse.json({
      url,
      sessionId,
    });
  } catch (error) {
    console.error('Checkout error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Checkout failed' },
      { status: 500 }
    );
  }
}
