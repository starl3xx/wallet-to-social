import { getOrCreateUser } from '@/lib/access';
import { grantPack } from '@/lib/credits';
import { generateMagicLinkToken } from '@/lib/auth';
import { sendMagicLink, isEmailConfigured } from '@/lib/email';
import { PACKS, type PackId } from '@/lib/packs';

/**
 * Everything that happens when someone pays for a pack.
 *
 * ## Why one function rather than two call sites
 *
 * A purchase is fulfilled from two places, deliberately: the Stripe webhook,
 * and the success page's poll as a fallback for when a payment outruns its
 * webhook. Whichever arrives first does the work. If they each carried their
 * own copy of the steps, the fallback would drift from the real path, and the
 * fallback is exactly the one nobody exercises in normal use.
 *
 * ## The sign-in email, and why it is keyed on the grant
 *
 * Checkout collects an email and does not require an account, because asking
 * someone to sign in before they will pay is friction in front of the only
 * step that matters. The consequence was that a buyer came back from Stripe
 * still signed out, with credits attached to an account they had no way into.
 *
 * So a purchase now sends a sign-in link. It is keyed on `grantPack` returning
 * true, which happens exactly once per Stripe payment because the lot table
 * holds a unique index on the payment id. That matters more than it looks: the
 * success page polls this path every second for up to thirty seconds, and
 * anything keyed on "is the buyer signed in" instead would send thirty emails.
 *
 * It goes to everyone, including buyers who were already signed in. A message
 * saying a purchase completed and here is a way in is useful to them too, and
 * suppressing it would mean deciding sign-in state inside a webhook that has no
 * session to inspect.
 */
export async function fulfilPackPurchase(
  email: string,
  pack: PackId,
  stripePaymentId: string,
  amountCents: number
): Promise<{ granted: boolean; userId: string }> {
  const user = await getOrCreateUser(email);

  const granted = await grantPack(
    user.id,
    pack,
    stripePaymentId,
    amountCents || PACKS[pack].priceCents
  );

  if (granted) {
    await sendSignInLink(email);
  }

  return { granted, userId: user.id };
}

/**
 * Never throws, and never fails a purchase.
 *
 * The credits are already granted by the time this runs. An email that does not
 * arrive is a support conversation; a fulfilment that rolls back because an
 * email failed is a customer who paid and got nothing.
 */
async function sendSignInLink(email: string): Promise<void> {
  if (!isEmailConfigured()) {
    console.warn(`No email service, so no sign-in link sent to ${email}`);
    return;
  }

  try {
    const tokenResult = await generateMagicLinkToken(email);
    if ('error' in tokenResult) {
      // Rate limiting lives in generateMagicLinkToken. A buyer who just
      // requested a link and then bought something hits it, and already has a
      // usable link in their inbox.
      console.warn(`No sign-in link for ${email}: ${tokenResult.error}`);
      return;
    }
    const sent = await sendMagicLink(email, tokenResult.token);
    if (!sent.success) {
      console.error(`Sign-in link failed for ${email}: ${sent.error}`);
    }
  } catch (error) {
    console.error('Sign-in link after purchase failed:', error);
  }
}
