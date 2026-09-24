import type { Metadata } from 'next';
import Link from 'next/link';
import { WalletLookupTool } from '@/components/WalletLookupTool';
import { SiteFooter } from '@/components/ui/site-footer';
import { Button, FOCUS_RING } from '@/components/ui/button';
import {
  INDEXED_WALLETS,
  WALLETS_WITH_X,
  X_HANDLES_RESOLVED,
  X_LIVE_PCT,
  X_SUSPENDED_PCT,
  X_UNCLAIMED_PCT,
  CHAIN_COUNT_WORD,
} from '@/lib/public-figures';
import { FREE_MATCHES_PER_WINDOW, FREE_WINDOW_DAYS } from '@/lib/packs';

/**
 * The free tool page, at the exact-match URL.
 *
 * ## Why this exists beside the blog post rather than replacing it
 *
 * `/blog/find-twitter-account-from-wallet` does not rank for its own
 * near-verbatim title. The instinct is to 301 it into this page, and that is
 * wrong twice: there is no equity to consolidate (that was the premise), and
 * the post is the site's only published statement of the identity rate and the
 * reach rate, which the figures checker declares in five places. So both stay,
 * cross-linked, and the post keeps its own canonical.
 *
 * ## The shape is copied, not invented
 *
 * Five ranking free-tool pages were read first. All five put one input, one
 * button, and a clickable example in the first screen, with the answer
 * rendering in place underneath. None pre-fills the field; all offer an example
 * chip, because most visitors arrive without a value to hand. The long-tail
 * phrase lives in the title tag, not the H1.
 */

const TITLE = 'Find a Twitter (X) account from a wallet address';
const CANONICAL =
  'https://walletlink.social/find-twitter-account-from-wallet-address';

export const metadata: Metadata = {
  title: TITLE,
  description:
    'Free, no account. Paste an Ethereum or EVM wallet address and see the X handle and Farcaster account its owner published onchain. Never guessed from a bio.',
  keywords: [
    'find twitter account from ethereum wallet address',
    'wallet to twitter lookup',
    'ethereum address to twitter handle',
    'wallet address social profiles',
    'find farcaster account by wallet address',
  ],
  alternates: { canonical: CANONICAL },
  openGraph: {
    title: TITLE,
    description:
      'Paste a wallet address, see the X and Farcaster accounts its owner published. Free, no account, no guessing.',
    url: CANONICAL,
    // Declaring an openGraph block costs the root segment's opengraph-image
    // file, so the image is named here. Relative, resolved against the apex
    // metadataBase, never a redirecting host. Same trap /check hit.
    images: ['/opengraph-image'],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description:
      'Paste a wallet address, see the X and Farcaster accounts its owner published. Free, no account, no guessing.',
    images: ['/opengraph-image'],
  },
};

const FAQ: Array<{ q: string; a: string }> = [
  {
    q: 'Does every wallet have a Twitter account?',
    a: 'No, and most do not. This returns an identity only when the wallet owner published one, so a wallet whose owner never did returns nothing. That is a fact about the wallet rather than a failure of the lookup.',
  },
  {
    q: 'Is this scraped from Twitter or X posts?',
    a: 'No. Nothing here is read from a post, a display name or a bio. A match comes from a Farcaster verification, an onchain record the owner wrote, an attested social sign-in, or a manually verified record, and every result says which.',
  },
  {
    q: 'What does attested mean?',
    a: 'That the link was published by the wallet owner rather than correlated by us. A result that is not attested is labeled correlated, so you can set your own confidence bar instead of trusting a score somebody else assigned.',
  },
  {
    q: 'Why does it say a handle is suspended or reassigned?',
    a: `Having an account and reaching a person are different claims. Of ${X_HANDLES_RESOLVED} distinct X handles resolved against X itself, ${X_LIVE_PCT}% are live, ${X_SUSPENDED_PCT}% are suspended and ${X_UNCLAIMED_PCT}% were never claimed. A handle can be attested by its owner and reach nobody today, or be held by somebody else entirely.`,
  },
  {
    q: 'Is it really free?',
    a: 'Yes, with a daily cap per network so it stays a lookup rather than a data feed. No account and no card. For a list rather than one address, a free account covers 100 matches every 30 days.',
  },
  {
    q: 'Can I check a whole list of addresses?',
    a: 'Yes. Upload a CSV on the homepage and it resolves the list, charging only for the wallets that resolve to an X handle or a Farcaster account. Wallets that resolve to nothing cost nothing.',
  },
  {
    q: 'How do I have my wallet removed?',
    a: 'Email the address on the privacy page and it is removed by hand, permanently. A removed wallet returns the same answer as one that was never indexed.',
  },
];

export default function FindTwitterFromWalletPage() {
  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ.map(({ q, a }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  };

  const appJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Wallet to X and Farcaster lookup',
    applicationCategory: 'WebApplication',
    operatingSystem: 'Web',
    url: CANONICAL,
    description:
      'Resolve an EVM wallet address to the X handle and Farcaster account its owner published onchain.',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(appJsonLd) }}
      />

      <main className="mx-auto max-w-3xl px-4 py-12 sm:py-16">
        {/* The H1 is the short tool name. The exact-match phrase is carried by
            the title tag and the subhead, which is what every ranking tool page
            examined actually does. */}
        <h1 className="text-3xl font-extralight tracking-[var(--tracking-display)] sm:text-4xl">
          Wallet to X handle lookup
        </h1>
        <p className="mt-3 max-w-[60ch] text-lg font-light leading-snug text-muted-foreground">
          Paste an Ethereum or EVM wallet address to find the Twitter (X)
          account and Farcaster profile its owner published. Every result comes
          from a link the owner published, or is labeled correlated when it is
          not.
        </p>

        <WalletLookupTool />

        <p className="mt-8 text-sm text-muted-foreground">
          {INDEXED_WALLETS} wallets indexed across {CHAIN_COUNT_WORD} onchain
          networks, {WALLETS_WITH_X} of them carrying a linked X handle.
        </p>

        <section className="mt-12">
          <h2 className="text-xl font-semibold">How to read the answer</h2>
          <div className="mt-3 space-y-3 text-muted-foreground">
            <p>
              <strong className="text-foreground">Attested</strong> means the
              wallet owner published the link themselves: a Farcaster
              verification, an onchain record they wrote, or an attested social
              sign-in. <strong className="text-foreground">Correlated</strong>{' '}
              means an identity index associated the two and the owner did not
              say so. Both are shown, and they are never presented as the same
              thing.
            </p>
            <p>
              An empty answer means the owner published nothing we can see. It
              is not an error, and it is the common case: nothing here is
              inferred from a bio, a display name or a posting pattern.
            </p>
          </div>
        </section>

        <section className="mt-10">
          <h2 className="text-xl font-semibold">
            A handle is not a promise that anyone is behind it
          </h2>
          <p className="mt-3 text-muted-foreground">
            Of {X_HANDLES_RESOLVED} distinct X handles resolved against X
            itself, {X_LIVE_PCT}% are live, {X_SUSPENDED_PCT}% are suspended and{' '}
            {X_UNCLAIMED_PCT}% were never claimed. So a handle can be attested
            by its owner years ago and reach nobody today, or be held by a
            different person now. Where the check has been run, the answer above
            says which.
          </p>
          <p className="mt-3 text-sm">
            <Link
              href="/check"
              className={`underline underline-offset-2 ${FOCUS_RING}`}
            >
              Check any handle on its own
            </Link>
          </p>
        </section>

        <section className="mt-10">
          <h2 className="text-xl font-semibold">If you have a list</h2>
          <p className="mt-3 text-muted-foreground">
            One address at a time is a lookup. For a holder list, an airdrop
            snapshot or a CSV export, upload the whole thing and get a column of
            handles back. You are charged per match, never per wallet submitted,
            and a free account covers {FREE_MATCHES_PER_WINDOW} matches every{' '}
            {FREE_WINDOW_DAYS} days.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button asChild>
              <Link href="/">Upload a list</Link>
            </Button>
            <Button asChild variant="soft">
              <Link href="/blog/find-twitter-account-from-wallet">
                Read the longer guide
              </Link>
            </Button>
          </div>
        </section>

        <section className="mt-10">
          <h2 className="text-xl font-semibold">Frequently asked questions</h2>
          <div className="mt-3">
            {FAQ.map(({ q, a }) => (
              <details
                key={q}
                className="group border-b border-border last:border-0"
              >
                <summary
                  className={`flex cursor-pointer list-none items-start justify-between gap-4 py-4 font-semibold transition-control hover:bg-fill-subtle ${FOCUS_RING}`}
                >
                  <span className="max-w-[65ch]">{q}</span>
                </summary>
                <p className="max-w-[65ch] pb-6 text-muted-foreground">{a}</p>
              </details>
            ))}
          </div>
        </section>

        <p className="mt-10 text-sm text-muted-foreground">
          This page shows identities their owners published. To have a wallet or
          a handle removed, see the{' '}
          <Link
            href="/privacy"
            className={`underline underline-offset-2 ${FOCUS_RING}`}
          >
            privacy page
          </Link>
          . Removal is by hand, and a removed wallet returns the same answer as
          one that was never indexed.
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
