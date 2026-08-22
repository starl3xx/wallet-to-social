import { NextRequest, NextResponse } from 'next/server';
import { createPackCheckoutSession, isStripeConfigured } from '@/lib/stripe';
import { isPackId, PACK_IDS } from '@/lib/packs';

export const runtime = 'nodejs';

interface CheckoutRequest {
  email: string;
  /** A credit pack. The only thing this endpoint sells. */
  pack?: string;
}

/**
 * The legacy `tier` field is gone from the request shape.
 *
 * It was kept for a while so a browser holding a cached upgrade modal could
 * still complete a purchase. Nothing in the codebase posts a tier any more,
 * `components/UpgradeModal.tsx` sends `pack`, and a request that does arrive
 * with a tier is asking for a product that is not for sale. It now gets the
 * same 400 as any other request without a pack, and the error names what is.
 *
 * The two legacy accounts are unaffected: their entitlement lives in
 * `users.tier` and the webhook still reads `metadata.tier` on their historical
 * payments. Only the path that *creates* a tier checkout is closed.
 */
export async function POST(request: NextRequest) {
  try {
    if (!isStripeConfigured()) {
      return NextResponse.json(
        { error: 'Payment system not configured' },
        { status: 503 }
      );
    }

    const body: CheckoutRequest = await request.json();
    const { email, pack } = body;

    if (!email || !email.includes('@')) {
      return NextResponse.json(
        { error: 'Valid email required' },
        { status: 400 }
      );
    }

    if (!pack || !isPackId(pack)) {
      return NextResponse.json(
        {
          error: `Missing or unknown pack. Must be one of: ${PACK_IDS.join(', ')}.`,
        },
        { status: 400 }
      );
    }

    const packSession = await createPackCheckoutSession(email, pack);
    return NextResponse.json(packSession);
  } catch (error) {
    console.error('Checkout error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Checkout failed' },
      { status: 500 }
    );
  }
}
