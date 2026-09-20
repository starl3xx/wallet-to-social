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
import { Eyebrow } from '@/components/ui/eyebrow';
import { ClaimFlow } from '@/components/ClaimFlow';
import { ClaimOutcome } from '@/components/ClaimOutcome';
import { CURRENT_CONSENT } from '@/lib/attestation-consent';
import { ATTESTATION_GRANT_MATCHES } from '@/lib/attestation';

export const metadata: Metadata = {
  title: 'Claim your address',
  description:
    'Confirm the account attached to an address you control, and correct the record we hold for it.',
  alternates: { canonical: 'https://walletlink.social/claim' },
};

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

        <section className="mt-10">
          <h2 className="text-2xl font-light tracking-[var(--tracking-title)]">
            What this writes
          </h2>
          <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground">
            <p>
              Your address next to your X account, in an index we sell.
              Customers can see it, and the record will say the owner published
              it rather than that we matched it.
            </p>
            <p>
              If we hold nothing for that address, your claim fills it. If we
              hold the same account, your claim confirms it and adds the account
              id, which is the part that survives a rename.
            </p>
            <p>
              If we hold a <em>different</em> account, we record that you
              disagree and keep serving what we have until the handle we hold
              stops reaching anyone. That is deliberate and it is not about
              doubting you: a signature proves control of a key, and keys are
              lost and sold. Letting one rewrite an identity outright would make
              a stolen key enough to put anybody&rsquo;s name on anybody
              else&rsquo;s address.
            </p>
          </div>
        </section>

        <section className="mt-10">
          <h2 className="text-2xl font-light tracking-[var(--tracking-title)]">
            What you get
          </h2>
          <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground">
            <p>
              Control of your own row. You can correct it, and you can withdraw
              it later from this same page with the same wallet, which removes
              the pair and stops us collecting it again.
            </p>
            <p>
              If the claim adds something we did not already hold, we credit
              your account with {ATTESTATION_GRANT_MATCHES} matches. Confirming
              something we have right is still worth doing, and it earns
              nothing: we would rather say that than pretend otherwise.
            </p>
          </div>
        </section>

        <section className="mt-10">
          <h2 className="text-2xl font-light tracking-[var(--tracking-title)]">
            What we keep
          </h2>
          <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground">
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
          </div>
        </section>

        <div className="mt-12">
          <ClaimFlow consentVersion={CURRENT_CONSENT.id} />
        </div>
      </div>
    </PageShell>
  );
}
