import type { Metadata } from 'next';
import Link from 'next/link';
import { PageShell } from '@/components/ui/page-shell';
import { Check, X, ArrowRight } from 'lucide-react';

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
  keywords: 'airstack alternative, airstack api deprecated, farcaster wallet index, reverse farcaster lookup',
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
            <h1 className="mb-4 text-4xl font-extralight tracking-[-0.04em] sm:text-5xl">
              Airstack alternative for Farcaster lookups
            </h1>
            <p className="text-xl text-muted-foreground">
              Airstack deprecated its API and pivoted to Senpi. If you built
              wallet or Farcaster identity lookups on Airstack, here’s where
              to migrate.
            </p>
          </header>

          {/* What happened */}
          <section className="mb-12">
            <h2 className="text-2xl font-semibold mb-4">What happened to Airstack?</h2>
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
              agent product. Apps and scripts built on the old endpoints
              stopped working; if your product depended on Airstack for
              Farcaster identity data, that dependency needs a new home.
            </p>
          </section>

          {/* Migration table */}
          <section className="mb-16">
            <h2 className="text-2xl font-semibold mb-6">
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
                    <th className="text-left py-4 pl-4">What Airstack offered</th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Status</td>
                    <td className="py-4 px-4 bg-accent-brand-tint/60">
                      Live, refreshed daily
                    </td>
                    <td className="py-4 pl-4">API deprecated (pivoted to Senpi)</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Farcaster coverage</td>
                    <td className="py-4 px-4 bg-accent-brand-tint/60">
                      Complete protocol: every FID’s verified and custody
                      addresses
                    </td>
                    <td className="py-4 pl-4 text-muted-foreground">
                      Was full social graph APIs
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Wallet → socials API</td>
                    <td className="py-4 px-4 bg-accent-brand-tint/60">
                      <Check className="h-4 w-4 text-accent-brand" />
                      <span className="text-xs text-muted-foreground ml-1">(Pro+)</span>
                    </td>
                    <td className="py-4 pl-4 text-muted-foreground">
                      Offered, no longer available
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">
                      Reverse lookup (handle → wallets)
                    </td>
                    <td className="py-4 px-4 bg-accent-brand-tint/60">
                      <Check className="h-4 w-4 text-accent-brand" />
                      <span className="text-xs text-muted-foreground ml-1">
                        (any Farcaster handle)
                      </span>
                    </td>
                    <td className="py-4 pl-4 text-muted-foreground">
                      Offered, no longer available
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Bulk CSV lookups</td>
                    <td className="py-4 px-4 bg-accent-brand-tint/60">
                      <Check className="h-4 w-4 text-accent-brand" />
                      <span className="text-xs text-muted-foreground ml-1">
                        (no code required)
                      </span>
                    </td>
                    <td className="py-4 pl-4">
                      <X className="h-4 w-4 text-muted-foreground" />
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Pricing</td>
                    <td className="py-4 px-4 bg-accent-brand-tint/60">
                      <span className="font-semibold text-accent-brand">
                        $99 - $249
                      </span>{' '}
                      one-time, API included
                    </td>
                    <td className="py-4 pl-4">Was usage-based subscription</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Onchain data queries</td>
                    <td className="py-4 px-4 bg-accent-brand-tint/60">
                      <X className="h-4 w-4 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground ml-1">
                        (identity only)
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
            <h2 className="text-2xl font-semibold mb-4">
              What is walletlink.social?
            </h2>
            <p className="text-muted-foreground mb-4">
              We turn wallet addresses into social profiles, in the browser
              or over a simple REST API. Our index covers 4.7M wallets with
              complete Farcaster protocol coverage: every account’s verified
              and custody addresses, usernames, and follower counts, refreshed
              daily. Twitter matches are user-attested via onchain records.
            </p>
            <p className="text-muted-foreground">
              If you used Airstack for Farcaster identity resolution, the API
              (included with Pro and Unlimited) covers the same core jobs:
              wallet → socials, and reverse lookup from any Farcaster handle
              to its wallets. If you only need a one-off enrichment, skip the
              API entirely and upload a CSV.
            </p>
          </section>

          {/* Migrating from Airstack */}
          <section className="mb-16">
            <h2 className="text-2xl font-semibold mb-6">Migrating from Airstack</h2>
            <div className="border rounded-lg p-6 bg-accent-brand-tint/60 border-accent-brand/30">
              <h3 className="font-semibold mb-4 text-accent-brand">
                Three steps to replace your Airstack integration:
              </h3>
              <ul className="space-y-3 text-sm">
                <li className="flex items-start gap-2">
                  <Check className="h-4 w-4 mt-0.5 text-accent-brand flex-shrink-0" />
                  <span>
                    Map your queries: wallet-to-identity and
                    handle-to-wallets calls both have direct equivalents in
                    our REST API
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="h-4 w-4 mt-0.5 text-accent-brand flex-shrink-0" />
                  <span>
                    Grab an API key, included with Pro ($99) and Unlimited
                    ($249), both one-time payments
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

          {/* Pricing */}
          <section className="mb-16">
            <h2 className="text-2xl font-semibold mb-6">Pricing after Airstack</h2>

            <div className="bg-muted/30 rounded-lg p-6 mb-6">
              <h3 className="font-semibold mb-4">walletlink.social</h3>
              <div className="grid sm:grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Free</p>
                  <p className="text-2xl font-bold">$0</p>
                  <p className="text-muted-foreground">Up to 500 wallets/lookup</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Pro</p>
                  <p className="text-2xl font-bold">$99</p>
                  <p className="text-muted-foreground">
                    Up to 5,000 wallets/lookup + API (one-time)
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Unlimited</p>
                  <p className="text-2xl font-bold">$249</p>
                  <p className="text-muted-foreground">
                    Unlimited wallets + API forever
                  </p>
                </div>
              </div>
            </div>

            <div className="p-4 border rounded-lg bg-accent-brand-tint/60 border-accent-brand/30">
              <p className="text-sm">
                <span className="font-medium">No metered billing:</span> both
                paid tiers are one-time payments with API access included, so there are no
                usage-based invoices to forecast, and no deprecation risk
                priced into a subscription.
              </p>
            </div>
          </section>

          {/* CTA */}
          <section className="text-center py-12 border-t">
            <h2 className="text-2xl font-semibold mb-4">
              Ready to find your wallet holders?
            </h2>
            <p className="text-muted-foreground mb-6">
              Try walletlink.social free - 500 wallets, no credit card
              required.
            </p>
            <Link
              href="/"
              className="inline-flex items-center gap-2 bg-foreground text-background px-6 py-3 rounded-lg font-medium hover:opacity-90 transition-opacity"
            >
              Start your first lookup
              <ArrowRight className="h-4 w-4" />
            </Link>
          </section>

          {/* Related Comparisons */}
          <nav className="py-8 border-t" aria-label="Related comparisons">
            <h2 className="text-lg font-semibold mb-4">Related comparisons</h2>
            <ul className="flex flex-wrap gap-4 text-sm">
              <li>
                <Link
                  href="/vs/addressable"
                  className="text-muted-foreground hover:text-foreground underline"
                >
                  walletlink.social vs Addressable
                </Link>
              </li>
              <li>
                <Link
                  href="/vs/cookie"
                  className="text-muted-foreground hover:text-foreground underline"
                >
                  walletlink.social vs Cookie.fun
                </Link>
              </li>
              <li>
                <Link
                  href="/vs/blaze"
                  className="text-muted-foreground hover:text-foreground underline"
                >
                  Blaze alternative
                </Link>
              </li>
              <li>
                <Link
                  href="/vs/holder"
                  className="text-muted-foreground hover:text-foreground underline"
                >
                  Holder alternative
                </Link>
              </li>
            </ul>
          </nav>
        </article>

      </PageShell>
    </>
  );
}
