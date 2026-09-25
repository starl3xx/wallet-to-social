import { NextRequest, NextResponse } from 'next/server';
import { checkoutGeoblock } from '@/lib/geoblock';
import { SESSION_COOKIE_NAME, validateSession } from '@/lib/auth';
import { isAccountFrozen } from '@/lib/account-freeze';
import { sanctionsRefusal } from '@/lib/sanctions';
import { createPackCheckoutSession, isStripeConfigured } from '@/lib/stripe';
import { isPackId, PACK_IDS } from '@/lib/packs';
import { TERMS_URL, TERMS_VERSION } from '@/lib/terms';

export const runtime = 'nodejs';

interface CheckoutRequest {
  email: string;
  /** A credit pack. The only thing this endpoint sells. */
  pack?: string;
  /** The buyer ticked "I agree to the Terms of Service". Must be `true`. */
  acceptTerms?: unknown;
  /** The `TERMS_VERSION` the buyer's page showed next to that box. */
  termsVersion?: unknown;
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
  // Before anything else, Stripe included (lib/geoblock.ts, Linear STA-41).
  const geoblocked = checkoutGeoblock(request.headers);
  if (geoblocked) return geoblocked;

  /**
   * A frozen account takes no new money (lib/account-freeze.ts): a signed-in
   * frozen account gets the buy route's 403 before a Stripe session exists.
   * Only the signed-in account is checked, never the email in the body, so
   * this cannot tell a stranger whether some address's account is frozen.
   */
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await validateSession(token) : { user: null };
  if (session.user && (await isAccountFrozen(session.user.id))) {
    return sanctionsRefusal('listed')!;
  }

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

    /**
     * The buyer's agreement to the terms, refused here rather than trusted to
     * the checkbox. The modal will not post without the box ticked, but this
     * route is public, and an agreement the server never checked is one it
     * cannot claim to have recorded. Refused before Stripe is called, so a
     * refusal costs nothing and opens no session.
     *
     * `=== true`, not truthy: `"false"` and `1` are not an agreement.
     */
    if (body.acceptTerms !== true) {
      return NextResponse.json(
        {
          error: `Agree to the Terms of Service to continue: ${TERMS_URL}`,
          code: 'TERMS_NOT_ACCEPTED',
        },
        { status: 400 }
      );
    }

    /**
     * And to THESE terms. A tab left open across a terms update shows the old
     * version beside its checkbox; recording the new version for that buyer
     * would say they agreed to a page they never saw, and recording the old one
     * would record terms no longer offered. So the page reloads instead.
     */
    if (body.termsVersion !== TERMS_VERSION) {
      return NextResponse.json(
        {
          error:
            'The Terms of Service changed since this page loaded. Reload the page, review them, and agree again.',
          code: 'TERMS_VERSION_STALE',
        },
        { status: 409 }
      );
    }

    // Server time, at the moment the ticked box reached us.
    const packSession = await createPackCheckoutSession(email, pack, {
      version: TERMS_VERSION,
      acceptedAt: new Date(),
    });
    return NextResponse.json(packSession);
  } catch (error) {
    console.error('Checkout error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Checkout failed' },
      { status: 500 }
    );
  }
}
