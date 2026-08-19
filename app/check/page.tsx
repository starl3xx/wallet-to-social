import type { Metadata } from 'next';
import Link from 'next/link';
import { PageShell } from '@/components/ui/page-shell';
import { Button } from '@/components/ui/button';
import { ReachabilityChecker } from '@/components/ReachabilityChecker';
import { ArrowRight } from '@phosphor-icons/react/dist/ssr';
import { WALLETS_WITH_X } from '@/lib/public-figures';

export const metadata: Metadata = {
  title: 'Check whether an X handle still reaches anyone',
  description:
    'Free, no account. Farcaster records a verified X account as a name with no recheck, so a third of them reach nobody. Check any handle against what we resolved.',
  keywords: [
    'is this twitter account still active',
    'check x handle suspended',
    'farcaster verified twitter dead',
    'wallet to twitter lookup',
  ],
  alternates: { canonical: 'https://walletlink.social/check' },
  openGraph: {
    title: 'Check whether an X handle still reaches anyone',
    description:
      'A third of X handles verified on Farcaster reach nobody. Check any one of them here, free and without an account.',
    url: 'https://walletlink.social/check',
  },
  /**
   * X reads `twitter:*` in preference to `og:*`, so without this block the card
   * inherited the root layout's title and showed the generic homepage headline
   * on a page about one specific question. Every /vs page and the blog already
   * set their own; this one shipped with only an openGraph block.
   */
  twitter: {
    card: 'summary_large_image',
    title: 'Check whether an X handle still reaches anyone',
    description:
      'A third of X handles verified on Farcaster reach nobody. Free, no account, no key.',
  },
};

/**
 * The page that lets a stranger test the claim the product is sold on.
 *
 * Every other piece of distribution points here. The argument is that Farcaster
 * stores a verified X account as a name, written once, with no account id and
 * no recheck, so a third of them reach nobody and no tool built on those
 * verifications can say which. That is a large claim to make about other
 * people's data, and the only honest way to make it is to hand over the means
 * to check it, for free, with no account, against a handle the reader chooses.
 *
 * It costs one indexed read. Nothing metered, nothing external.
 */
export default function CheckPage() {
  return (
    <PageShell>
      <div className="flex flex-col gap-10">
        <header className="flex flex-col gap-4">
          <h1 className="text-3xl font-medium tracking-tight">
            Does this X handle still reach anyone?
          </h1>
          <p className="max-w-[68ch] text-muted-foreground">
            Farcaster records a verified X account as a <strong>name</strong>, captured once,
            with no account number and no later check. Nothing in the protocol notices a
            rename or a suspension, so every tool built on those verifications carries the
            same dead handles and none of them can tell you which.
          </p>
          <p className="max-w-[68ch] text-muted-foreground">
            We resolved ours against X itself. Check any handle below. No account, no key,
            nothing to install.
          </p>
        </header>

        <ReachabilityChecker />

        <section className="flex flex-col gap-3 border-t border-border pt-8">
          <h2 className="text-lg font-medium">What this does not tell you</h2>
          <p className="max-w-[68ch] text-sm text-muted-foreground">
            It reports how many wallets in our index carry the handle, never which ones.
            Going from a handle to its wallets is the reverse lookup, and that is a paid
            feature. The count is here because it is what makes the answer mean something:
            a dead handle on one wallet is a curiosity, and the same handle on two hundred
            is a campaign sending into nothing.
          </p>
          <p className="max-w-[68ch] text-sm text-muted-foreground">
            A handle we have not resolved yet says so. It is never assumed live, which is
            the whole point: guessing here is the thing this page exists to disprove.
          </p>
        </section>

        <section className="flex flex-col items-start gap-4 rounded-lg border border-border bg-muted/40 p-6">
          <h2 className="text-lg font-medium">Checking one is a demonstration. Checking your list is the product.</h2>
          <p className="max-w-[68ch] text-sm text-muted-foreground">
            Upload a holder list and every match comes back with the same answer attached,
            across {WALLETS_WITH_X} wallets carrying an X handle. The handle export leaves
            out the ones we checked and found dead, so a campaign is not sending into
            accounts that cannot receive it.
          </p>
          <Button asChild>
            <Link href="/">
              Run a list
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </Button>
        </section>
      </div>
    </PageShell>
  );
}
