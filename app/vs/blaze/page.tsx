import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { Check, X, ArrowRight } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Blaze alternative for wallet-to-Twitter lookups (Blaze left web3)',
  description:
    'Blaze has pivoted out of web3 and withblaze.app no longer resolves. If you used Blaze’s Wallet CRM to match wallets to Twitter, here’s where to migrate.',
  keywords: [
    'Blaze alternative',
    'withblaze shut down',
    'Blaze web3 CRM',
    'wallet to Twitter',
    'wallet lookup tool',
  ],
  openGraph: {
    title: 'Blaze alternative for wallet-to-Twitter lookups (Blaze left web3)',
    description:
      'Blaze has pivoted out of web3. Migrate your wallet-to-Twitter workflow to walletlink.social: one-time pricing, Twitter and Farcaster coverage.',
    type: 'article',
    url: 'https://walletlink.social/vs/blaze',
    siteName: 'walletlink.social',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Blaze alternative for wallet-to-Twitter lookups',
    description:
      'Blaze left web3. Here’s where to migrate your wallet-to-Twitter lookups.',
  },
  alternates: {
    canonical: 'https://walletlink.social/vs/blaze',
  },
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: 'Blaze alternative for wallet-to-Twitter lookups (Blaze left web3)',
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
  keywords: 'Blaze alternative, withblaze shut down, wallet to Twitter, wallet lookup',
};

export default function BlazeComparison() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="min-h-screen bg-background">
        <article className="container mx-auto py-12 px-4 max-w-4xl">
          {/* Header */}
          <header className="mb-12">
            <Link
              href="/"
              className="inline-flex items-center gap-2 mb-8 text-muted-foreground hover:text-foreground transition-colors"
            >
              <Image
                src="/icon.png"
                alt="walletlink.social"
                width={24}
                height={24}
                className="rounded"
              />
              <span className="text-sm font-medium">walletlink.social</span>
            </Link>

            <h1 className="text-4xl font-bold mb-4">
              Blaze alternative for wallet-to-Twitter lookups
            </h1>
            <p className="text-xl text-muted-foreground">
              Blaze has pivoted out of web3; withblaze.app no longer resolves.
              If you used Blaze’s Wallet CRM to match wallets to Twitter,
              here’s where to migrate.
            </p>
          </header>

          {/* What happened */}
          <section className="mb-12">
            <h2 className="text-2xl font-semibold mb-4">What happened to Blaze?</h2>
            <p className="text-muted-foreground mb-4">
              Blaze was a Web3 CRM platform built around community management
              and lead generation. Its &ldquo;Wallet CRM&rdquo; feature matched
              wallet addresses to Twitter handles as one part of a broader
              subscription suite that included:
            </p>
            <ul className="list-disc list-inside text-muted-foreground space-y-2 mb-4">
              <li>Community management and engagement tools</li>
              <li>Lead generation and nurturing workflows</li>
              <li>Twitter and Discord integrations</li>
              <li>Campaign management</li>
            </ul>
            <p className="text-muted-foreground">
              The company has since pivoted out of web3 entirely, and its
              former domain no longer resolves. The Wallet CRM, its
              wallet-to-Twitter matching, and its subscriptions went with it.
              If you relied on Blaze for wallet-to-social data, that workflow
              needs a new home.
            </p>
          </section>

          {/* Migration table */}
          <section className="mb-16">
            <h2 className="text-2xl font-semibold mb-6">
              What Blaze offered vs what walletlink.social offers
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-4 pr-4"></th>
                    <th className="text-left py-4 px-4 bg-emerald-50 dark:bg-emerald-950/30 rounded-tl-lg">
                      <span className="font-semibold">walletlink.social</span>
                    </th>
                    <th className="text-left py-4 pl-4">What Blaze offered</th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Focus</td>
                    <td className="py-4 px-4 bg-emerald-50/50 dark:bg-emerald-950/20">
                      Wallet → Social only
                    </td>
                    <td className="py-4 pl-4">
                      Full Web3 CRM platform (discontinued)
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Pricing</td>
                    <td className="py-4 px-4 bg-emerald-50/50 dark:bg-emerald-950/20">
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                        $99 - $249
                      </span>{' '}
                      one-time
                    </td>
                    <td className="py-4 pl-4">Was $79+/month ($948+/year)</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Twitter/X</td>
                    <td className="py-4 px-4 bg-emerald-50/50 dark:bg-emerald-950/20">
                      <Check className="h-4 w-4 text-emerald-500" />
                      <span className="text-xs text-muted-foreground ml-1">
                        (user-attested matches)
                      </span>
                    </td>
                    <td className="py-4 pl-4 text-muted-foreground">
                      Offered, no longer available
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Farcaster</td>
                    <td className="py-4 px-4 bg-emerald-50/50 dark:bg-emerald-950/20">
                      <Check className="h-4 w-4 text-emerald-500" />
                      <span className="text-xs text-muted-foreground ml-1">
                        (complete protocol coverage)
                      </span>
                    </td>
                    <td className="py-4 pl-4">
                      <X className="h-4 w-4 text-muted-foreground" />
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Farcaster Followers</td>
                    <td className="py-4 px-4 bg-emerald-50/50 dark:bg-emerald-950/20">
                      <Check className="h-4 w-4 text-emerald-500" />
                    </td>
                    <td className="py-4 pl-4">
                      <X className="h-4 w-4 text-muted-foreground" />
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Priority Score</td>
                    <td className="py-4 px-4 bg-emerald-50/50 dark:bg-emerald-950/20">
                      <Check className="h-4 w-4 text-emerald-500" />
                      <span className="text-xs text-muted-foreground ml-1">(Pro+)</span>
                    </td>
                    <td className="py-4 pl-4">
                      <X className="h-4 w-4 text-muted-foreground" />
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Lookup History</td>
                    <td className="py-4 px-4 bg-emerald-50/50 dark:bg-emerald-950/20">
                      <Check className="h-4 w-4 text-emerald-500" />
                      <span className="text-xs text-muted-foreground ml-1">(Pro+)</span>
                    </td>
                    <td className="py-4 pl-4 text-muted-foreground">
                      Was part of the CRM
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Contract Import</td>
                    <td className="py-4 px-4 bg-emerald-50/50 dark:bg-emerald-950/20">
                      <Check className="h-4 w-4 text-emerald-500" />
                      <span className="text-xs text-muted-foreground ml-1">
                        (Pro and Unlimited: Ethereum, Base, Robinhood Chain)
                      </span>
                    </td>
                    <td className="py-4 pl-4 text-muted-foreground">
                      <X className="h-4 w-4 text-muted-foreground" />
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Farcaster DMs</td>
                    <td className="py-4 px-4 bg-emerald-50/50 dark:bg-emerald-950/20">
                      <Check className="h-4 w-4 text-emerald-500" />
                      <span className="text-xs text-muted-foreground ml-1">(Unlimited)</span>
                    </td>
                    <td className="py-4 pl-4 text-muted-foreground">
                      <X className="h-4 w-4 text-muted-foreground" />
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Community Tools</td>
                    <td className="py-4 px-4 bg-emerald-50/50 dark:bg-emerald-950/20">
                      <X className="h-4 w-4 text-muted-foreground" />
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
            <h2 className="text-2xl font-semibold mb-4">
              What is walletlink.social?
            </h2>
            <p className="text-muted-foreground mb-4">
              We do one thing: turn wallet addresses into social profiles. No
              CRM, no community tools, no lead gen. Just:
            </p>
            <ol className="list-decimal list-inside text-muted-foreground space-y-2 mb-4">
              <li>Upload your CSV of wallet addresses</li>
              <li>We match them against our identity index</li>
              <li>Export Twitter handles and Farcaster profiles</li>
              <li>Save lookups and add addresses over time (Pro+)</li>
            </ol>
            <p className="text-muted-foreground">
              Lookups are backed by an index of 4.7M wallets with complete
              Farcaster protocol coverage, refreshed daily. Twitter matches
              are user-attested (links the wallet owner created themselves, such as
              a verified Farcaster account or an onchain ENS record), so there is
              no guesswork in your
              outreach list.
            </p>
          </section>

          {/* Migrating from Blaze */}
          <section className="mb-16">
            <h2 className="text-2xl font-semibold mb-6">Migrating from Blaze</h2>
            <div className="border rounded-lg p-6 bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900">
              <h3 className="font-semibold mb-4 text-emerald-700 dark:text-emerald-300">
                Three steps to rebuild your wallet-to-Twitter workflow:
              </h3>
              <ul className="space-y-3 text-sm">
                <li className="flex items-start gap-2">
                  <Check className="h-4 w-4 mt-0.5 text-emerald-500 flex-shrink-0" />
                  <span>
                    Export your holder list, from a past Blaze export if you
                    still have one, or straight from the token contract
                    (Etherscan, Basescan, or our contract import)
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="h-4 w-4 mt-0.5 text-emerald-500 flex-shrink-0" />
                  <span>
                    Upload the CSV to walletlink.social: the free tier covers
                    500 wallets with no credit card
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="h-4 w-4 mt-0.5 text-emerald-500 flex-shrink-0" />
                  <span>
                    Export Twitter handles and Farcaster profiles, including
                    follower counts Blaze never had
                  </span>
                </li>
              </ul>
            </div>
          </section>

          {/* Pricing */}
          <section className="mb-16">
            <h2 className="text-2xl font-semibold mb-6">Pricing after Blaze</h2>

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
                    Up to 5,000 wallets/lookup (one-time)
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Unlimited</p>
                  <p className="text-2xl font-bold">$249</p>
                  <p className="text-muted-foreground">
                    Unlimited wallets/lookup forever
                  </p>
                </div>
              </div>
            </div>

            <div className="p-4 border rounded-lg bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800">
              <p className="text-sm">
                <span className="font-medium">No subscription to replace:</span>{' '}
                Blaze started at $79/month, $948+ per year. walletlink.social
                Pro is{' '}
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                  $99 once
                </span>,{' '}
                less than two months of the old Blaze subscription, and it
                never renews.
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
                  href="/vs/holder"
                  className="text-muted-foreground hover:text-foreground underline"
                >
                  Holder alternative
                </Link>
              </li>
              <li>
                <Link
                  href="/vs/airstack"
                  className="text-muted-foreground hover:text-foreground underline"
                >
                  Airstack alternative
                </Link>
              </li>
            </ul>
          </nav>
        </article>

        {/* Footer */}
        <footer className="container mx-auto max-w-4xl px-4 py-6 border-t text-center text-sm text-muted-foreground">
          <p className="flex items-center justify-center gap-2">
            made with 🌠 by @starl3xx
            <a
              href="https://x.com/starl3xx"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors"
              title="@starl3xx on X"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
            </a>
            <a
              href="https://warpcast.com/starl3xx.eth"
              target="_blank"
              rel="noopener noreferrer"
              className="text-purple-500 hover:text-purple-400 transition-colors"
              title="@starl3xx.eth on Farcaster"
            >
              <svg width="14" height="14" viewBox="0 0 200 175" fill="currentColor">
                <path d="M200 0V23.6302H176.288V47.2404H183.553V47.2483H200V175H160.281L160.256 174.883L139.989 79.3143C138.057 70.2043 133 61.9616 125.751 56.0995C118.502 50.2376 109.371 47.0108 100.041 47.0108H99.9613C90.631 47.0108 81.5 50.2376 74.251 56.0995C67.0023 61.9616 61.9453 70.2073 60.013 79.3143L39.7223 175H0V47.2453H16.4475V47.2404H23.7114V23.6302H0V0H200Z" />
              </svg>
            </a>
          </p>
        </footer>
      </div>
    </>
  );
}
