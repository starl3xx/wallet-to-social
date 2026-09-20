/**
 * Claim the record we hold for an address you control.
 *
 * ## Readable without signing in, deliberately
 *
 * The page explains what we would write before it asks for anything. Somebody
 * arriving from a search result or a link in a row modal should be able to
 * read what this does, decide it is not for them, and leave without having
 * created an account. Putting the explanation behind a sign-in would make the
 * first thing we ask of a stranger an account, for a page whose whole subject
 * is what we already hold about them.
 *
 * ## The control comes first, and the explanation still comes before the ask
 *
 * The first version put three sections and about six hundred words above the
 * claim card, so the one thing the page is for sat below the fold on every
 * laptop. The honest-explanation goal survives compression: two sentences
 * above the control say what gets written and what we do not take, which is
 * the pair that changes somebody's mind, and everything else is one click
 * away underneath.
 *
 * Underneath, not elsewhere. The detail stays on this URL rather than moving
 * to a separate FAQ page, because a disclosure a person has to navigate away
 * to find is weaker ground if anybody ever disputes what they agreed to, and
 * two copies of the same copy drift apart.
 *
 * ## The order of the three things it says
 *
 * What we will WRITE, then what you GET, then what we KEEP. That order is the
 * honest one: the write is the thing being asked for, and leading with the
 * reward would be selling rather than explaining. The index is a commercial
 * product and the page says so in those words, because a person deciding
 * whether to attest deserves to know it is not a directory.
 */
import type { Metadata } from 'next';
import { PageShell } from '@/components/ui/page-shell';
import { FOCUS_RING } from '@/components/ui/button';
import { Eyebrow } from '@/components/ui/eyebrow';
import { ClaimFlow } from '@/components/ClaimFlow';
import { ClaimOutcome } from '@/components/ClaimOutcome';
import { CURRENT_CONSENT } from '@/lib/attestation-consent';
import {
  ATTESTATION_GRANT_MATCHES,
  ATTESTATION_CUTOFF_HUMAN,
} from '@/lib/attestation';

export const metadata: Metadata = {
  title: 'Claim your address',
  description:
    'Confirm the account attached to an address you control, and correct the record we hold for it.',
  alternates: { canonical: 'https://walletlink.social/claim' },
};

/**
 * One disclosure, closed by default.
 *
 * Native `details`, not a state hook: this page is a server component and the
 * browser has done open-and-close for years. It also means every answer is in
 * the HTML rather than behind a click for a crawler, which matters because
 * `/claim` is in the sitemap and these answers are the page's actual subject.
 */
function Detail({
  question,
  children,
}: {
  question: string;
  children: React.ReactNode;
}) {
  return (
    <details className="group border-b border-border py-4">
      {/* `list-none` plus the webkit marker rule removes the platform
          triangle, which is drawn differently in every browser and is the one
          element here that cannot be made to match the type scale. */}
      {/* `FOCUS_RING`, the shared one, because a keyboard lands here as
          readily as a pointer and every other disclosure on the site uses
          it. Without it this fell back to the base outline, which is the
          one the offset ring exists to replace.

          Not `components/HomeFaq.tsx` reused wholesale: that takes no
          props, carries the homepage entries and emits its own FAQPage
          structured data, so using it here would publish this page's
          disclosures as the homepage's questions. The shape is shared;
          the content and the schema are not. */}
      <summary
        className={`flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium transition-control [&::-webkit-details-marker]:hidden ${FOCUS_RING}`}
      >
        {question}
        {/* Rotates rather than swapping glyphs, so open and closed read as one
            control in two states rather than two controls. */}
        <span
          aria-hidden
          className="transition-control flex-none text-muted-foreground group-open:rotate-45"
        >
          +
        </span>
      </summary>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground">
        {children}
      </div>
    </details>
  );
}

export default function ClaimPage() {
  return (
    <PageShell>
      <div className="mx-auto max-w-[68ch] py-12">
        {/* Above everything, because somebody arriving from x.com is here
            for one answer and should not have to find it. */}
        <ClaimOutcome />

        <Eyebrow className="text-muted-foreground">Your record</Eyebrow>
        <h1 className="mt-3 text-4xl font-extralight leading-[1.02] tracking-[var(--tracking-display)]">
          Claim your address
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          We hold a record for millions of addresses, built from what their
          owners published. If one of them is yours, you can confirm it, or
          correct it, and the record will say the owner said so.
        </p>
        {/* The two facts that change a decision, kept beside the control.
            Everything else is in the disclosures below: these are the ones a
            person wants before they press anything, so hiding these two
            behind a click would be choosing the wrong pair to hide. */}
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Your address next to your account goes into an index we sell.{' '}
          <strong className="font-medium text-foreground">
            We take no access to your X account:
          </strong>{' '}
          we read your account name once and discard the token in the same
          request.
        </p>

        <div className="mt-8">
          <ClaimFlow consentVersion={CURRENT_CONSENT.id} />
        </div>

        <section className="mt-12">
          <h2 className="text-2xl font-light tracking-[var(--tracking-title)]">
            Before you do
          </h2>
          <div className="mt-4 border-t border-border">
            <Detail question="What exactly does this write?">
              <p>
                Your address next to your X account, in an index we sell.
                Customers can see it, and the record will say the owner
                published it rather than that we matched it.
              </p>
              <p>
                If we hold nothing for that address, your claim fills it. If we
                hold the same account, your claim confirms it and adds the
                account id, which is the part that survives a rename.
              </p>
            </Detail>

            <Detail question="What if you already hold a different account for it?">
              <p>
                We record that you disagree and keep serving what we have until
                the handle we hold stops reaching anyone. That is deliberate and
                it is not about doubting you: a signature proves control of a
                key, and keys are lost and sold. Letting one rewrite an identity
                outright would make a stolen key enough to put anybody&rsquo;s
                name on anybody else&rsquo;s address.
              </p>
            </Detail>

            <Detail question="What do I get?">
              <p>
                Control of your own row. You can correct it, and you can
                withdraw it later from this same page with the same wallet,
                which removes the pair and stops us collecting it again.
              </p>
              <p>
                If we already knew about your address before{' '}
                {ATTESTATION_CUTOFF_HUMAN}, we credit your account with{' '}
                {ATTESTATION_GRANT_MATCHES} matches, once per X account. That is
                the whole condition, and it is about us rather than about you:
                an address we had indexed before we asked anyone to claim one
                was recorded for reasons that had nothing to do with earning
                credits, which is what makes it evidence we cannot be sold.
              </p>
              <p>
                A newer address earns nothing, and the claim is still written,
                because a correction from the owner is worth having whether or
                not we pay for it. Which of the two yours is appears as soon as
                you connect the wallet, before there is anything to approve.
              </p>
            </Detail>

            <Detail question="What do you keep?">
              <p>
                The address, the account name and its numeric id, the signature
                you make, and the fact that you agreed to this.
              </p>
              <p>
                <strong className="font-medium text-foreground">
                  Not any access to your X account.
                </strong>{' '}
                We read your account name once and discard the token in the same
                request. Nothing here can post, follow, or read your messages.
              </p>
            </Detail>
          </div>
        </section>
      </div>
    </PageShell>
  );
}
