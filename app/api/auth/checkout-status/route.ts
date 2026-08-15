import { NextRequest, NextResponse } from 'next/server';
import { getCheckoutSession, resolveCheckoutEmail } from '@/lib/stripe';
import { getUserAccess, provisionPaidCheckout, type PaidTier } from '@/lib/access';

export const runtime = 'nodejs';

/**
 * Post-checkout polling endpoint for /success.
 *
 * This replaces `/api/auth/check-access?email=...`, which accepted an arbitrary
 * email from an unauthenticated caller and answered with that account's tier,
 * whitelist status and quota usage — a customer-enumeration oracle. Anyone who
 * could guess an address could learn whether it belonged to a paying customer.
 *
 * A Stripe checkout session id is unguessable and is only ever handed to the
 * buyer, via Stripe's own redirect. So possessing one is proof the caller
 * completed *this* checkout, and the email is read FROM the verified session
 * rather than accepted from the caller. There is no longer any input that lets
 * a caller ask about someone else's account.
 *
 * The response is deliberately narrow: the success page only needs to know when
 * the account has been upgraded.
 *
 * This endpoint also *performs* the upgrade rather than only waiting for the
 * webhook to do it. That is not belt-and-braces, it is the lesson from
 * 2026-08-15: the webhook endpoint was registered against a URL that redirects,
 * Stripe does not follow redirects, and so every payment ever taken succeeded in
 * Stripe and provisioned nothing. This route was already talking to Stripe, and
 * already knew `payment_status === 'paid'`, and threw that away to go and ask
 * the database whether some other system had noticed yet.
 *
 * Possessing the session id is proof of purchase, and the payment status comes
 * from Stripe rather than from the caller, so granting here is exactly as
 * trustworthy as granting from the webhook. Provisioning is idempotent on the
 * payment intent, so whichever arrives first wins and the other is a no-op.
 */
export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get('session_id');

  // Stripe checkout session ids look like `cs_live_...` / `cs_test_...`. Reject
  // anything else before spending a Stripe API call on it.
  if (!sessionId || !/^cs_[A-Za-z0-9_]{10,}$/.test(sessionId)) {
    return NextResponse.json(
      { error: 'A valid session_id is required' },
      { status: 400 }
    );
  }

  const session = await getCheckoutSession(sessionId);
  if (!session) {
    // Covers both "no such session" and Stripe being unreachable. The caller
    // can't distinguish them, which is fine — it just keeps polling.
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  // Only a completed payment says anything about entitlement.
  if (session.payment_status !== 'paid') {
    return NextResponse.json({ paid: false, tier: 'free' });
  }

  // Resolved through the same helper the webhook uses. If this poll looked up a
  // different address than the webhook upgraded — which happens the moment a
  // buyer edits the prefilled email on Stripe Checkout — the payment would
  // succeed while /success spun until it timed out.
  const email = resolveCheckoutEmail(session);

  if (!email) {
    // Paid, but we can't tie it to an account yet. The client keeps polling.
    return NextResponse.json({ paid: true, tier: 'free', email: null });
  }

  // Grant it here rather than waiting on the webhook. `tier` is our own metadata
  // from session creation, so an absent value means this session did not come
  // from our checkout route and nothing should be granted for it.
  const tier = session.metadata?.tier as PaidTier | undefined;

  if (tier) {
    const customerId =
      typeof session.customer === 'string'
        ? session.customer
        : session.customer?.id || '';

    const paymentIntentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id || session.id;

    try {
      await provisionPaidCheckout(email, tier, customerId, paymentIntentId, {
        sessionId: session.id,
        via: 'success-page',
      });
    } catch (error) {
      // A provisioning failure must not break the poll. The webhook may still
      // land, and the next poll retries this anyway.
      console.error('Provisioning from success page failed:', error);
    }
  }

  const access = await getUserAccess(email);

  // Returning the email is safe here in a way it never was on the old endpoint:
  // it comes from the verified session, so we are only telling the buyer
  // something they already know. It lets /success stop trusting localStorage,
  // which is empty if the buyer completes payment in a different browser.
  return NextResponse.json({ paid: true, tier: access.tier, email });
}
