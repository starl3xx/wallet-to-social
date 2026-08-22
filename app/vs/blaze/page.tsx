import type { Metadata } from 'next';
import Link from 'next/link';
import { PageShell } from '@/components/ui/page-shell';
import { PackPricing } from '@/components/PackPricing';
import { PACKS, FREE_MATCHES_PER_WINDOW, FREE_WINDOW_DAYS } from '@/lib/packs';
import { Button } from '@/components/ui/button';
import { Figure } from '@/components/ui/figure';
import {
  ArrowRight,
  BookOpenText,
  Check,
  MagnifyingGlass,
  X,
} from '@phosphor-icons/react/dist/ssr';
import { INDEXED_WALLETS } from '@/lib/public-figures';
import { ReachabilityClaim } from '@/components/ReachabilityClaim';

export const metadata: Metadata = {
  title: 'Blaze alternative for wallet-to-X lookups (Blaze left web3)',
  description:
    'Blaze has pivoted out of web3 and withblaze.app no longer resolves. If you used Blaze’s Wallet CRM to match wallets to X, here’s where to migrate.',
  keywords: [
    'Blaze alternative',
    'withblaze shut down',
    'Blaze web3 CRM',
    'wallet to Twitter',
    'wallet lookup tool',
  ],
  openGraph: {
    title: 'Blaze alternative for wallet-to-X lookups (Blaze left web3)',
    description:
      'Blaze has pivoted out of web3. Migrate your wallet-to-X workflow to walletlink.social: one-time pricing, X and Farcaster coverage.',
    type: 'article',
    url: 'https://walletlink.social/vs/blaze',
    siteName: 'walletlink.social',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Blaze alternative for wallet-to-X lookups',
    description:
      'Blaze left web3. Here’s where to migrate your wallet-to-X lookups.',
  },
  alternates: {
    canonical: 'https://walletlink.social/vs/blaze',
  },
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: 'Blaze alternative for wallet-to-X lookups (Blaze left web3)',
  description:
    'Blaze pivoted out of web3 and withblaze.app no longer resolves. A migration guide for former Blaze Wallet CRM users moving to walletlink.social.',
  author: {
    '@type': 'Organization',
    name: 'walletlink.social',
    url: 'https://walletlink.social',
  },
  publisher: {
    '@type': 'Organization',
    name: 'walletlink.social',
    url: 'https://walletlink.social',
  },
  mainEntityOfPage: {
    '@type': 'WebPage',
    '@id': 'https://walletlink.social/vs/blaze',
  },
  datePublished: '2025-01-01',
  dateModified: new Date().toISOString().split('T')[0],
  keywords:
    'Blaze alternative, withblaze shut down, wallet to Twitter, wallet lookup',
};

export default function BlazeComparison() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <PageShell>
        {/* The reading column constrains measure, not position: 68ch, on the
            shell's left edge like /check and the blog index. It was centred
            with `mx-auto`, which put the text on a different horizontal line
            from the pages a reader visits before and after it. */}
        <article className="max-w-[68ch]">
          <header className="mb-12">
            {/* The emphasis span is the type system's one device: a 600-weight
                word inside a 200-weight line. Both cuts are already loaded. */}
            <h1 className="mb-4 max-w-[17ch] text-4xl font-extralight leading-[1.02] tracking-[var(--tracking-display)] sm:text-5xl">
              A lookup, not a{' '}
              <em className="font-semibold not-italic text-accent-brand">
                CRM
              </em>
              .
            </h1>
            {/* The lede: 300 at 18px with the lead tracking, in the muted token.
                `text-foreground/80` was an opacity wash standing in for the
                token that already means "secondary text". */}
            <p className="max-w-[46ch] text-lg font-light leading-snug tracking-[var(--tracking-lead)] text-muted-foreground">
              Blaze wants to be where you manage the relationship. We just tell
              you who the wallet belongs to, and hand it back.
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <Button asChild>
                <Link href="/">
                  <MagnifyingGlass className="h-4 w-4" aria-hidden />
                  Run a lookup
                </Link>
              </Button>
              <Button asChild variant="outline">
                <a
                  href="https://docs.walletlink.social"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <BookOpenText className="h-4 w-4" aria-hidden />
                  Read the API docs
                </a>
              </Button>
            </div>

            {/* The proof row closes the hero. Four figures, each appearing once,
                and the two measured ones carry the green mark: coverage, because
                it is the claim we can prove, and the reachable rate, because it
                is a range, not an average (Base measures 46.2% and Ethereum
                16.6%, and an average would hide the thing that decides a
                campaign). The rate used to sit in brand as "the number to act
                on", but a rate is nothing the reader can act on, and violet is
                the colour of an affordance. Green is the colour of a measured
                fact, and the hit rate is named as one. */}
            {/* Two-by-two on a phone, four across from `sm`. As a wrapping flex
                row the four figures broke 2/1/1 at 375px, and its 40/20/20px
                gaps were off the nine-step scale; these are 32, 24 and 24.
                `items-start` because Figure is a `flex-col-reverse` column:
                in a stretched grid cell it packs to the bottom, so a figure
                whose caption wraps sat a line above its neighbours. */}
            <dl className="mt-8 grid grid-cols-2 items-start gap-x-8 gap-y-6 border-t border-border pt-6 sm:grid-cols-4">
              <Figure value={INDEXED_WALLETS} label="wallets indexed" />
              <Figure value="100%" label="Farcaster coverage" attested />
              <Figure
                value="16-46%"
                label="have an X or Farcaster account"
                attested
              />
              <Figure
                value={`$${PACKS.trial.priceCents / 100}`}
                label="to start, no subscription"
              />
            </dl>
          </header>

          <div className="mb-16">
            <ReachabilityClaim competitor="Blaze" />
          </div>

          {/* What happened */}
          <section className="mb-12">
            <h2 className="text-2xl font-light tracking-[var(--tracking-title)] mb-4">
              What happened to Blaze?
            </h2>
            <p className="text-muted-foreground mb-4">
              Blaze was a Web3 CRM platform built around community management
              and lead generation. Its &ldquo;Wallet CRM&rdquo; feature matched
              wallet addresses to X handles as one part of a broader
              subscription suite that included:
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2 mb-4">
              <li>Community management and engagement tools</li>
              <li>Lead generation and nurturing workflows</li>
              <li>X and Discord integrations</li>
              <li>Campaign management</li>
            </ul>
            <p className="text-muted-foreground">
              The company has since pivoted out of web3 entirely, and its former
              domain no longer resolves. The Wallet CRM, its wallet-to-X
              matching, and its subscriptions went with it. If you relied on
              Blaze for wallet-to-social data, that workflow needs a new home.
            </p>
          </section>

          {/* Migration table. A Check in a capability cell is green, whichever
              column it sits in: "has this" is a measured fact, and green is the
              colour of one. A cross is muted. Captioned cells put the glyph and
              its caption in one flex row; Tailwind's preflight makes svg
              `display: block`, so an icon followed by a span stacked on two
              lines with the caption indented 4px under the glyph. The cards further
              down are lists, not capability claims, and their check marks take
              the card's own text colour. */}
          <section className="mb-16">
            <h2 className="text-2xl font-light tracking-[var(--tracking-title)] mb-6">
              What Blaze offered vs what walletlink.social offers
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-4 pr-4"></th>
                    <th className="text-left py-4 px-4 bg-accent-brand-tint rounded-tl-lg">
                      <span className="font-semibold">walletlink.social</span>
                    </th>
                    <th className="text-left py-4 pl-4">What Blaze offered</th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Focus</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      Wallet → social only
                    </td>
                    <td className="py-4 pl-4">
                      Full Web3 CRM platform (discontinued)
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Pricing</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <span className="font-semibold text-accent-brand">
                        ${PACKS.trial.priceCents / 100} - $
                        {PACKS.index.priceCents / 100}
                      </span>{' '}
                      one-time
                    </td>
                    <td className="py-4 pl-4">Was $79+/month ($948+/year)</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">X</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <span className="flex items-start gap-2">
                        <Check
                          alt="Yes"
                          role="img"
                          aria-label="Yes"
                          className="mt-0.5 h-4 w-4 flex-none text-attested"
                        />
                        <span className="text-xs text-muted-foreground">
                          (user-attested matches)
                        </span>
                      </span>
                    </td>
                    <td className="py-4 pl-4 text-muted-foreground">
                      Offered, no longer available
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Farcaster</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <span className="flex items-start gap-2">
                        <Check
                          alt="Yes"
                          role="img"
                          aria-label="Yes"
                          className="mt-0.5 h-4 w-4 flex-none text-attested"
                        />
                        <span className="text-xs text-muted-foreground">
                          (complete protocol coverage)
                        </span>
                      </span>
                    </td>
                    <td className="py-4 pl-4">
                      <X
                        alt="No"
                        role="img"
                        aria-label="No"
                        className="h-4 w-4 text-muted-foreground"
                      />
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">
                      Farcaster followers
                    </td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <Check
                        alt="Yes"
                        role="img"
                        aria-label="Yes"
                        className="h-4 w-4 text-attested"
                      />
                    </td>
                    <td className="py-4 pl-4">
                      <X
                        alt="No"
                        role="img"
                        aria-label="No"
                        className="h-4 w-4 text-muted-foreground"
                      />
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Priority score</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <span className="flex items-start gap-2">
                        <Check
                          alt="Yes"
                          role="img"
                          aria-label="Yes"
                          className="mt-0.5 h-4 w-4 flex-none text-attested"
                        />
                        <span className="text-xs text-muted-foreground">
                          (every pack)
                        </span>
                      </span>
                    </td>
                    <td className="py-4 pl-4">
                      <X
                        alt="No"
                        role="img"
                        aria-label="No"
                        className="h-4 w-4 text-muted-foreground"
                      />
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Lookup history</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <span className="flex items-start gap-2">
                        <Check
                          alt="Yes"
                          role="img"
                          aria-label="Yes"
                          className="mt-0.5 h-4 w-4 flex-none text-attested"
                        />
                        <span className="text-xs text-muted-foreground">
                          (every pack)
                        </span>
                      </span>
                    </td>
                    <td className="py-4 pl-4 text-muted-foreground">
                      Was part of the CRM
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Contract import</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <span className="flex items-start gap-2">
                        <Check
                          alt="Yes"
                          role="img"
                          aria-label="Yes"
                          className="mt-0.5 h-4 w-4 flex-none text-attested"
                        />
                        <span className="text-xs text-muted-foreground">
                          (every pack, on all seven supported chains)
                        </span>
                      </span>
                    </td>
                    <td className="py-4 pl-4 text-muted-foreground">
                      <X
                        alt="No"
                        role="img"
                        aria-label="No"
                        className="h-4 w-4 text-muted-foreground"
                      />
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Community tools</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <X
                        alt="No"
                        role="img"
                        aria-label="No"
                        className="h-4 w-4 text-muted-foreground"
                      />
                    </td>
                    <td className="py-4 pl-4 text-muted-foreground">
                      Offered, no longer available
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* What is walletlink.social */}
          <section className="mb-12">
            <h2 className="text-2xl font-light tracking-[var(--tracking-title)] mb-4">
              What is walletlink.social?
            </h2>
            <p className="text-muted-foreground mb-4">
              We do one thing: turn wallet addresses into social profiles. No
              CRM, no community tools, no lead gen. Just:
            </p>
            <ol className="list-decimal pl-6 text-muted-foreground space-y-2 mb-4">
              <li>Upload your CSV of wallet addresses</li>
              <li>We match them against our identity index</li>
              <li>Export X handles and Farcaster profiles</li>
              <li>Save lookups, and grow them with new addresses</li>
            </ol>
            <p className="text-muted-foreground">
              Lookups are backed by an index of {INDEXED_WALLETS} wallets with
              complete Farcaster protocol coverage, refreshed daily. Over 99.9%
              of X matches are user-attested (links the wallet owner created
              themselves, such as a verified Farcaster account or an onchain ENS
              record), and every match carries the evidence behind it, so there
              is no guesswork in your outreach list.
            </p>
          </section>

          {/* Migrating from Blaze */}
          <section className="mb-16">
            <h2 className="text-2xl font-light tracking-[var(--tracking-title)] mb-6">
              Migrating from Blaze
            </h2>
            <div className="border rounded-lg p-6 bg-accent-brand-tint border-accent-brand">
              <h3 className="font-semibold mb-4 text-accent-brand">
                Three steps to rebuild your wallet-to-X workflow:
              </h3>
              <ul className="space-y-3 text-sm">
                <li className="flex items-start gap-2">
                  <Check className="h-4 w-4 mt-0.5 text-accent-brand flex-shrink-0" />
                  <span>
                    Export your holder list, from a past Blaze export if you
                    still have one, or straight from the token contract
                    (Etherscan, Basescan, or our contract import)
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="h-4 w-4 mt-0.5 text-accent-brand flex-shrink-0" />
                  <span>
                    Upload the CSV to walletlink.social: your first{' '}
                    {FREE_MATCHES_PER_WINDOW} matches are free every{' '}
                    {FREE_WINDOW_DAYS} days, with no credit card
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="h-4 w-4 mt-0.5 text-accent-brand flex-shrink-0" />
                  <span>
                    Export X handles and Farcaster profiles, including follower
                    counts Blaze never had
                  </span>
                </li>
              </ul>
            </div>
          </section>

          {/* Pricing. The section owns the rhythm: space-y-6 separates the
              heading, the pack grid and the callouts, so the h2 carries no margin
              of its own and the callouts carry no mt. Gap and margin must not both
              own the same space. */}
          <section className="mb-16 space-y-6">
            <h2 className="text-2xl font-light tracking-[var(--tracking-title)]">
              Pricing after Blaze
            </h2>

            <PackPricing />

            <div className="p-6 border rounded-lg bg-accent-brand-tint border-accent-brand">
              <p className="text-sm">
                <span className="font-medium">No subscription to replace:</span>{' '}
                Blaze started at $79/month, $948+ per year. walletlink.social is{' '}
                <span className="font-semibold text-accent-brand">
                  ${PACKS.trial.priceCents / 100} to start
                </span>
                , less than two months of the old Blaze subscription, and it
                never renews.
              </p>
            </div>
          </section>

          {/* Closing CTA. The Button primitive on a Link, the same as the hero:
              this used to paste Button's class string onto the Link, which drifted
              the moment Button changed (it had already lost the focus ring). The
              label is the one the product uses for this action everywhere, so the
              hero and the close name the same destination the same way. */}
          <section className="text-center py-12 border-t">
            <h2 className="text-2xl font-light tracking-[var(--tracking-title)] mb-4">
              Ready to find your wallet holders?
            </h2>
            <p className="text-muted-foreground mb-6">
              Try walletlink.social free: {FREE_MATCHES_PER_WINDOW} matches
              every {FREE_WINDOW_DAYS} days, no credit card required.
            </p>
            <Button asChild>
              <Link href="/">
                Run a lookup
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </Button>
          </section>

          {/* Related comparisons. Each link is the `link` variant at `inline`
              size, the one treatment for a text link in a list or a sentence;
              these were grey and underlined at rest, a third look for the same
              meaning. The names match the footer's Compare column, so one
              destination has one name wherever it is linked. */}
          <nav className="py-8 border-t" aria-label="Related comparisons">
            <h2 className="text-lg font-semibold mb-4">Related comparisons</h2>
            <ul className="flex flex-wrap gap-4 text-sm">
              <li>
                <Button asChild variant="link" size="inline">
                  <Link href="/vs/addressable">vs Addressable</Link>
                </Button>
              </li>
              <li>
                <Button asChild variant="link" size="inline">
                  <Link href="/vs/cookie3">vs Cookie3</Link>
                </Button>
              </li>
              <li>
                <Button asChild variant="link" size="inline">
                  <Link href="/vs/holder">vs Holder</Link>
                </Button>
              </li>
              <li>
                <Button asChild variant="link" size="inline">
                  <Link href="/vs/airstack">vs Airstack</Link>
                </Button>
              </li>
            </ul>
          </nav>
        </article>
      </PageShell>
    </>
  );
}
