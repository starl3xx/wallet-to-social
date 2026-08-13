import { NextRequest, NextResponse } from 'next/server';
import { getCheckoutSession } from '@/lib/stripe';
import { getUserAccess } from '@/lib/access';

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
 * the Stripe webhook has landed and upgraded the account.
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

  const email =
    session.customer_details?.email ||
    session.customer_email ||
    session.metadata?.email ||
    null;

  if (!email) {
    // Paid, but we can't tie it to an account yet. The client keeps polling.
    return NextResponse.json({ paid: true, tier: 'free', email: null });
  }

  const access = await getUserAccess(email);

  // Returning the email is safe here in a way it never was on the old endpoint:
  // it comes from the verified session, so we are only telling the buyer
  // something they already know. It lets /success stop trusting localStorage,
  // which is empty if the buyer completes payment in a different browser.
  return NextResponse.json({ paid: true, tier: access.tier, email });
}
