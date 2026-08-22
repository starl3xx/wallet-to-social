import Link from 'next/link';
import { SealCheck } from '@phosphor-icons/react/dist/ssr';
import { Button } from '@/components/ui/button';
import { X_HANDLES_RESOLVED } from '@/lib/public-figures';

/**
 * The claim that no competitor on any of these pages can make.
 *
 * Every product in this category resells Farcaster verifications, and Farcaster
 * records a verified X account as a **name**, captured once, with no account id
 * and no recheck. Nothing in the protocol notices a rename or a suspension, so
 * everyone carrying that data carries the same dead third without knowing which
 * third. We resolved all of it and report the answer per record.
 *
 * ## Why this is a component and not five paragraphs
 *
 * It belongs on all five comparison pages and it contains numbers. Five copies
 * would be five places to update and four places to forget, which is the exact
 * failure that had the homepage saying 4.8M while the docs said 4.9M. The
 * figures come from `lib/public-figures.ts` for the same reason.
 *
 * ## Why it is framed as a strength
 *
 * Because it is one. Checking does not weaken an attestation, it completes it:
 * "the owner attested this, and it still works" is a stronger claim than either
 * half, and it is one only a source that actually looked can make.
 */
export function ReachabilityClaim({ competitor }: { competitor: string }) {
  return (
    <section className="rounded-lg border border-border bg-muted/40 p-6">
      <div className="flex items-start gap-3">
        <SealCheck
          weight="fill"
          className="mt-0.5 h-5 w-5 flex-none text-attested"
          aria-hidden
        />
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">
            We check whether the X account still exists. {competitor} does not.
          </h2>

          <p className="text-sm text-muted-foreground">
            Farcaster stores a verified X account as a name, written once, with
            no account number and no later check. So when somebody renames or
            gets suspended, nothing in the protocol notices. Every tool built on
            those verifications carries the same dead handles, and none of them
            can tell you which.
          </p>

          <p className="text-sm text-muted-foreground">
            We resolved every X handle in the index against X itself. Of{' '}
            {X_HANDLES_RESOLVED} checked:{' '}
            {/* `font-semibold` on each, because the browser's own stylesheet
                makes <strong> `bolder`, which resolves to 700 on a 400 parent,
                and the 700 cut is loaded. The emphasis weight is 600. */}
            <strong className="font-semibold text-foreground">
              69.6% live
            </strong>
            ,{' '}
            <strong className="font-semibold text-foreground">
              20.7% suspended
            </strong>
            , and{' '}
            <strong className="font-semibold text-foreground">
              9.7% names nobody holds any more
            </strong>
            . Roughly a third reach no person at all.
          </p>

          <p className="text-sm text-muted-foreground">
            Every match now carries that answer. The handle export leaves out
            the ones we checked and found dead, so a campaign is not sending
            into accounts that cannot receive it. A freed name matters most:
            somebody else may hold it now, and a message would reach a stranger.
          </p>

          {/* The claim above is large and about other people's data. Handing over
              the means to test it is the only honest way to make it. The link is
              the `link` variant at `inline` size, the one treatment for a text
              link inside a sentence; it was violet and always underlined, a
              second look for the same meaning. */}
          <p className="text-sm">
            <Button asChild variant="link" size="inline">
              <Link href="/check">Check any handle yourself</Link>
            </Button>
            <span className="text-muted-foreground">
              , free and without an account.
            </span>
          </p>
        </div>
      </div>
    </section>
  );
}
