import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { Check, X, ArrowRight } from 'lucide-react';

export const metadata: Metadata = {
  title: 'walletlink.social vs Blaze: Comparison (2025)',
  description:
    'Compare walletlink.social and Blaze for wallet-to-Twitter lookups. See why crypto teams choose dedicated lookup tools over Web3 CRM platforms with buried features.',
  keywords: ['Blaze alternative', 'wallet to Twitter', 'Web3 CRM comparison', 'wallet lookup tool', 'crypto marketing'],
  openGraph: {
    title: 'walletlink.social vs Blaze: Which is Right for You?',
    description:
      'Compare wallet-to-social lookup tools. One-time $149 vs $79/month CRM subscription. See which is right for your crypto marketing needs.',
    type: 'article',
    url: 'https://walletlink.social/vs/blaze',
    siteName: 'walletlink.social',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'walletlink.social vs Blaze Comparison',
    description: 'One-time payment vs monthly CRM subscription for wallet-to-Twitter lookups.',
  },
  alternates: {
    canonical: 'https://walletlink.social/vs/blaze',
  },
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: 'walletlink.social vs Blaze: Which is Right for You?',
  description:
    'Detailed comparison of wallet-to-social lookup tools for crypto marketing teams. Compare pricing, features, and use cases.',
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
  keywords: 'Blaze alternative, wallet to Twitter, Web3 CRM, wallet lookup',
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
              walletlink.social vs Blaze
            </h1>
            <p className="text-xl text-muted-foreground">
              Blaze offers wallet-to-Twitter as part of a broader CRM. We do
              wallet-to-social lookups and nothing else.
            </p>
          </header>

          {/* Quick Summary */}
          <section className="mb-16">
            <h2 className="text-2xl font-semibold mb-6">Quick comparison</h2>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-4 pr-4"></th>
                    <th className="text-left py-4 px-4 bg-emerald-50 dark:bg-emerald-950/30 rounded-tl-lg">
                      <span className="font-semibold">walletlink.social</span>
                    </th>
                    <th className="text-left py-4 pl-4">Blaze</th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Focus</td>
                    <td className="py-4 px-4 bg-emerald-50/50 dark:bg-emerald-950/20">
                      Wallet → Social only
                    </td>
                    <td className="py-4 pl-4">Full Web3 CRM platform</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Pricing</td>
                    <td className="py-4 px-4 bg-emerald-50/50 dark:bg-emerald-950/20">
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                        $149 - $420
                      </span>{' '}
                      one-time
                    </td>
                    <td className="py-4 pl-4">Starting at $79/month</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Annual Cost</td>
                    <td className="py-4 px-4 bg-emerald-50/50 dark:bg-emerald-950/20">
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                        $149 - $420
                      </span>{' '}
                      (same forever)
                    </td>
                    <td className="py-4 pl-4">$948+/year</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Twitter/X</td>
                    <td className="py-4 px-4 bg-emerald-50/50 dark:bg-emerald-950/20">
                      <Check className="h-4 w-4 text-emerald-500" />
                    </td>
                    <td className="py-4 pl-4">
                      <Check className="h-4 w-4 text-emerald-500" />
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Farcaster</td>
                    <td className="py-4 px-4 bg-emerald-50/50 dark:bg-emerald-950/20">
                      <Check className="h-4 w-4 text-emerald-500" />
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
                      Part of CRM
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Add to Lookups</td>
                    <td className="py-4 px-4 bg-emerald-50/50 dark:bg-emerald-950/20">
                      <Check className="h-4 w-4 text-emerald-500" />
                      <span className="text-xs text-muted-foreground ml-1">(Pro+)</span>
                    </td>
                    <td className="py-4 pl-4 text-muted-foreground">
                      <X className="h-4 w-4 text-muted-foreground" />
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Contract Import</td>
                    <td className="py-4 px-4 bg-emerald-50/50 dark:bg-emerald-950/20">
                      <Check className="h-4 w-4 text-emerald-500" />
                      <span className="text-xs text-muted-foreground ml-1">(Unlimited)</span>
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
                    <td className="py-4 pl-4">
                      <Check className="h-4 w-4 text-emerald-500" />
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Lead Generation</td>
                    <td className="py-4 px-4 bg-emerald-50/50 dark:bg-emerald-950/20">
                      <X className="h-4 w-4 text-muted-foreground" />
                    </td>
                    <td className="py-4 pl-4">
                      <Check className="h-4 w-4 text-emerald-500" />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* What is Blaze */}
          <section className="mb-12">
            <h2 className="text-2xl font-semibold mb-4">What is Blaze?</h2>
            <p className="text-muted-foreground mb-4">
              Blaze is a Web3 CRM platform designed for community management and
              lead generation. Their &ldquo;Wallet CRM&rdquo; feature includes
              wallet-to-Twitter matching, but it&apos;s one feature among many:
            </p>
            <ul className="list-disc list-inside text-muted-foreground space-y-2 mb-4">
              <li>Community management and engagement tools</li>
              <li>Lead generation and nurturing workflows</li>
              <li>Twitter and Discord integrations</li>
              <li>Campaign management</li>
            </ul>
            <p className="text-muted-foreground">
              If you&apos;re building a full community operation and need
              ongoing CRM capabilities, Blaze&apos;s platform approach may fit.
              But if you just need wallet-to-social lookups, you&apos;re paying
              for features you won&apos;t use.
            </p>
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
              <li>We aggregate multiple data sources for accuracy</li>
              <li>Export Twitter handles and Farcaster profiles</li>
              <li>Save lookups and add addresses over time (Pro+)</li>
            </ol>
            <p className="text-muted-foreground">
              Unlike Blaze, we include Farcaster lookups with follower counts -
              useful if your community is active on both Twitter and Farcaster.
            </p>
          </section>

          {/* When to choose each */}
          <section className="mb-16">
            <h2 className="text-2xl font-semibold mb-6">When to choose each</h2>

            <div className="grid md:grid-cols-2 gap-6">
              {/* walletlink.social */}
              <div className="border rounded-lg p-6 bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900">
                <h3 className="font-semibold mb-4 text-emerald-700 dark:text-emerald-300">
                  Choose walletlink.social if:
                </h3>
                <ul className="space-y-3 text-sm">
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-emerald-500 flex-shrink-0" />
                    <span>You just need wallet → social lookups</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-emerald-500 flex-shrink-0" />
                    <span>You need Farcaster support, not just Twitter</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-emerald-500 flex-shrink-0" />
                    <span>You want to pay once, not monthly</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-emerald-500 flex-shrink-0" />
                    <span>You want to prioritize wallets by influence</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-emerald-500 flex-shrink-0" />
                    <span>You don&apos;t need a full CRM</span>
                  </li>
                </ul>
              </div>

              {/* Blaze */}
              <div className="border rounded-lg p-6">
                <h3 className="font-semibold mb-4">Choose Blaze if:</h3>
                <ul className="space-y-3 text-sm text-muted-foreground">
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                    <span>You need ongoing community management</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                    <span>You want lead gen and nurturing tools</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                    <span>You&apos;re building a full CRM operation</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                    <span>Twitter-only social matching is sufficient</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                    <span>You prefer monthly subscriptions</span>
                  </li>
                </ul>
              </div>
            </div>
          </section>

          {/* Pricing Comparison */}
          <section className="mb-16">
            <h2 className="text-2xl font-semibold mb-6">Pricing breakdown</h2>

            <div className="bg-muted/30 rounded-lg p-6 mb-6">
              <h3 className="font-semibold mb-4">walletlink.social</h3>
              <div className="grid sm:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Free</p>
                  <p className="text-2xl font-bold">$0</p>
                  <p className="text-muted-foreground">Up to 1,000 wallets/lookup</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Starter</p>
                  <p className="text-2xl font-bold">$49</p>
                  <p className="text-muted-foreground">
                    10,000 wallets total (one-time)
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Pro</p>
                  <p className="text-2xl font-bold">$149</p>
                  <p className="text-muted-foreground">
                    Up to 10,000 wallets/lookup (one-time)
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Unlimited</p>
                  <p className="text-2xl font-bold">$420</p>
                  <p className="text-muted-foreground">
                    Unlimited wallets/lookup forever
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-muted/30 rounded-lg p-6">
              <h3 className="font-semibold mb-4">Blaze</h3>
              <p className="text-muted-foreground text-sm mb-2">
                Monthly subscription model:
              </p>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>- Starting at $79/month</li>
                <li>- Higher tiers for more features</li>
                <li>- $948+/year minimum</li>
              </ul>
            </div>

            <div className="mt-6 p-4 border rounded-lg bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800">
              <p className="text-sm">
                <span className="font-medium">ROI Example:</span> If you only
                need wallet-to-social lookups, paying $149 once for
                walletlink.social Pro instead of $79/month for Blaze saves you{' '}
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                  $799 in year one
                </span>{' '}
                - and the savings grow every year after.
              </p>
            </div>
          </section>

          {/* CTA */}
          <section className="text-center py-12 border-t">
            <h2 className="text-2xl font-semibold mb-4">
              Ready to find your wallet holders?
            </h2>
            <p className="text-muted-foreground mb-6">
              Try walletlink.social free - 1,000 wallets, no credit card
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
