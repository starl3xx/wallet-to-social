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
  title: 'Airstack alternative for Farcaster lookups (API deprecated)',
  description:
    'Airstack deprecated its API and pivoted to Senpi. If you built wallet or Farcaster identity lookups on Airstack, here’s where to migrate.',
  keywords: [
    'airstack alternative',
    'airstack api deprecated',
    'farcaster api alternative',
    'farcaster wallet index',
    'reverse farcaster lookup',
  ],
  openGraph: {
    title: 'Airstack alternative for Farcaster lookups (API deprecated)',
    description:
      'Airstack deprecated its API. walletlink.social’s API covers the complete Farcaster protocol, including reverse handle-to-wallet lookups.',
    type: 'article',
    url: 'https://walletlink.social/vs/airstack',
    siteName: 'walletlink.social',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Airstack alternative for Farcaster lookups',
    description:
      'Airstack deprecated its API. Here’s where to migrate your Farcaster identity lookups.',
  },
  alternates: {
    canonical: 'https://walletlink.social/vs/airstack',
  },
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: 'Airstack alternative for Farcaster lookups (API deprecated)',
  description:
    'Airstack deprecated its API and pivoted to Senpi. A migration guide for teams moving their wallet and Farcaster identity lookups to walletlink.social.',
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
    '@id': 'https://walletlink.social/vs/airstack',
  },
  datePublished: '2026-08-12',
  dateModified: new Date().toISOString().split('T')[0],
  keywords:
    'airstack alternative, airstack api deprecated, farcaster wallet index, reverse farcaster lookup',
};

export default function AirstackComparison() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <PageShell>
        <article className="mx-auto max-w-[68ch]">
          <header className="mb-12">
            {/* The emphasis span is the type system's one device: a 600-weight
                word inside a 200-weight line. Both cuts are already loaded. */}
            <h1 className="mb-4 max-w-[17ch] text-4xl font-extralight leading-[1.02] tracking-[var(--tracking-display)] sm:text-5xl">
              One answer, not an{' '}
              <em className="font-semibold not-italic text-accent-brand">
                API surface
              </em>
              .
            </h1>
            <p className="max-w-[46ch] text-lg font-light leading-snug text-foreground/80">
              Airstack gives you a query language. We give you the one join it
              is usually built to perform, as a CSV or an endpoint.
            </p>

            <div className="mt-6 flex flex-wrap gap-2.5">
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
            <dl className="mt-8 flex flex-wrap gap-x-10 gap-y-5 border-t border-border pt-5">
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
            <ReachabilityClaim competitor="Airstack" />
          </div>

          {/* What happened */}
          <section className="mb-12">
            <h2 className="text-2xl font-light tracking-[-0.028em] mb-4">
              What happened to Airstack?
            </h2>
            <p className="text-muted-foreground mb-4">
              Airstack was a web3 data platform best known for its Farcaster
              APIs. Developers used it to query the Farcaster social graph,
              resolve wallets to identities, and pull onchain data through a
              single GraphQL interface:
            </p>
            <ul className="list-disc list-inside text-muted-foreground space-y-2 mb-4">
              <li>Farcaster social graph and profile queries</li>
              <li>Wallet-to-identity resolution across protocols</li>
              <li>Token balance and onchain activity data</li>
              <li>Composable GraphQL APIs and SDKs</li>
            </ul>
            <p className="text-muted-foreground">
              The company deprecated those APIs and pivoted to Senpi, an AI
              agent product. Apps and scripts built on the old endpoints stopped
              working; if your product depended on Airstack for Farcaster
              identity data, that dependency needs a new home.
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
            <h2 className="text-2xl font-light tracking-[-0.028em] mb-6">
              What Airstack offered vs what walletlink.social offers
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-4 pr-4"></th>
                    <th className="text-left py-4 px-4 bg-accent-brand-tint rounded-tl-lg">
                      <span className="font-semibold">walletlink.social</span>
                    </th>
                    <th className="text-left py-4 pl-4">
                      What Airstack offered
                    </th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Status</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      Live, refreshed daily
                    </td>
                    <td className="py-4 pl-4">
                      API deprecated (pivoted to Senpi)
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">
                      Farcaster coverage
                    </td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      Complete protocol: every FID’s verified and custody
                      addresses
                    </td>
                    <td className="py-4 pl-4 text-muted-foreground">
                      Was full social graph APIs
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">
                      Wallet → socials API
                    </td>
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
                      Offered, no longer available
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">
                      Reverse lookup (handle → wallets)
                    </td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <span className="flex items-start gap-2">
                        <Check
                          alt="Yes"
                          role="img"
                          aria-label="Yes"
                          className="mt-0.5 h-4 w-4 flex-none text-attested"
                        />
                        <span className="text-xs text-muted-foreground">
                          (any Farcaster handle)
                        </span>
                      </span>
                    </td>
                    <td className="py-4 pl-4 text-muted-foreground">
                      Offered, no longer available
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Bulk CSV lookups</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <span className="flex items-start gap-2">
                        <Check
                          alt="Yes"
                          role="img"
                          aria-label="Yes"
                          className="mt-0.5 h-4 w-4 flex-none text-attested"
                        />
                        <span className="text-xs text-muted-foreground">
                          (no code required)
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
                    <td className="py-4 pr-4 font-medium">Pricing</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <span className="font-semibold text-accent-brand">
                        ${PACKS.trial.priceCents / 100} - $
                        {PACKS.index.priceCents / 100}
                      </span>{' '}
                      one-time, API included
                    </td>
                    <td className="py-4 pl-4">Was usage-based subscription</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">
                      Onchain data queries
                    </td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <span className="flex items-start gap-2">
                        <X
                          alt="No"
                          role="img"
                          aria-label="No"
                          className="mt-0.5 h-4 w-4 flex-none text-muted-foreground"
                        />
                        <span className="text-xs text-muted-foreground">
                          (identity only)
                        </span>
                      </span>
                    </td>
                    <td className="py-4 pl-4 text-muted-foreground">
                      Was token balances, transfers
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* What is walletlink.social */}
          <section className="mb-12">
            <h2 className="text-2xl font-light tracking-[-0.028em] mb-4">
              What is walletlink.social?
            </h2>
            <p className="text-muted-foreground mb-4">
              We turn wallet addresses into social profiles, in the browser or
              over a simple REST API. Our index covers {INDEXED_WALLETS} wallets
              with complete Farcaster protocol coverage: every account’s
              verified and custody addresses, usernames, and follower counts,
              refreshed daily. Over 99.9% of X matches are user-attested, most
              through an X account verified on Farcaster and the rest through
              onchain ENS records.
            </p>
            <p className="text-muted-foreground">
              If you used Airstack for Farcaster identity resolution, the API
              (included with every pack) covers the same core jobs: wallet →
              socials, and reverse lookup from any Farcaster handle to its
              wallets. If you only need a one-off enrichment, skip the API
              entirely and upload a CSV.
            </p>
          </section>

          {/* Migrating from Airstack */}
          <section className="mb-16">
            <h2 className="text-2xl font-light tracking-[-0.028em] mb-6">
              Migrating from Airstack
            </h2>
            <div className="border rounded-lg p-6 bg-accent-brand-tint border-accent-brand">
              <h3 className="font-semibold mb-4 text-accent-brand">
                Three steps to replace your Airstack integration:
              </h3>
              <ul className="space-y-3 text-sm">
                <li className="flex items-start gap-2">
                  <Check className="h-4 w-4 mt-0.5 text-accent-brand flex-shrink-0" />
                  <span>
                    Map your queries: wallet-to-identity and handle-to-wallets
                    calls both have direct equivalents in our REST API
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="h-4 w-4 mt-0.5 text-accent-brand flex-shrink-0" />
                  <span>
                    Grab an API key, included with every pack from $
                    {PACKS.trial.priceCents / 100}, drawing the same credits as
                    the app
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="h-4 w-4 mt-0.5 text-accent-brand flex-shrink-0" />
                  <span>
                    Point your app at the new endpoints: responses include
                    Farcaster usernames, FIDs, and follower counts
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
            <h2 className="text-2xl font-light tracking-[-0.028em]">
              Pricing after Airstack
            </h2>

            <PackPricing />

            <div className="p-4 border rounded-lg bg-accent-brand-tint border-accent-brand">
              <p className="text-sm">
                <span className="font-medium">No usage invoices:</span> every
                pack is a one-time payment with API access included, so there is
                nothing usage-based to forecast, and no deprecation risk priced
                into a subscription.
              </p>
            </div>
          </section>

          {/* Closing CTA. The Button primitive on a Link, the same as the hero:
              this used to paste Button's class string onto the Link, which drifted
              the moment Button changed (it had already lost the focus ring). The
              label is the one the product uses for this action everywhere, so the
              hero and the close name the same destination the same way. */}
          <section className="text-center py-12 border-t">
            <h2 className="text-2xl font-light tracking-[-0.028em] mb-4">
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
                  <Link href="/vs/blaze">vs Blaze</Link>
                </Button>
              </li>
              <li>
                <Button asChild variant="link" size="inline">
                  <Link href="/vs/holder">vs Holder</Link>
                </Button>
              </li>
            </ul>
          </nav>
        </article>
      </PageShell>
    </>
  );
}
