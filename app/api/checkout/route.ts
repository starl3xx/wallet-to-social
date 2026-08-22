import { NextRequest, NextResponse } from 'next/server';
import {
  createCheckoutSession,
  createPackCheckoutSession,
  isStripeConfigured,
  type CheckoutTier,
} from '@/lib/stripe';
import { isPackId } from '@/lib/packs';

export const runtime = 'nodejs';

interface CheckoutRequest {
  email: string;
  /** A credit pack. The current product. */
  pack?: string;
  /**
   * A legacy one-time tier.
   *
   * Kept working rather than removed. The upgrade modal is cached in browsers,
   * the two paying accounts were provisioned through this shape, and a checkout
   * that 400s because the caller is a version behind is a lost sale for no
   * reason. New callers send `pack`.
   */
  tier?: CheckoutTier;
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
    const { email, pack, tier } = body;

    if (!email || !email.includes('@')) {
      return NextResponse.json(
        { error: 'Valid email required' },
        { status: 400 }
      );
    }

    if (pack) {
      if (!isPackId(pack)) {
        return NextResponse.json({ error: 'Unknown pack' }, { status: 400 });
      }
      const packSession = await createPackCheckoutSession(email, pack);
      return NextResponse.json(packSession);
    }

    if (tier !== 'pro' && tier !== 'unlimited') {
      return NextResponse.json(
        { error: 'Invalid tier. Must be "pro" or "unlimited"' },
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
