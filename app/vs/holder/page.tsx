import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { Check, X, ArrowRight } from 'lucide-react';

export const metadata: Metadata = {
  title: 'walletlink.social vs Holder: Comparison (2025)',
  description:
    'Compare walletlink.social and Holder.xyz for wallet-to-social lookups. See why crypto teams choose dedicated lookup tools over wallet messaging CRM platforms.',
  keywords: ['Holder alternative', 'Holder.xyz alternative', 'wallet enrichment', 'wallet to social', 'Web3 CRM comparison'],
  openGraph: {
    title: 'walletlink.social vs Holder: Which is Right for You?',
    description:
      'Compare wallet enrichment tools. One-time $149 vs subscription messaging platform. Find the right tool for your needs.',
    type: 'article',
    url: 'https://walletlink.social/vs/holder',
    siteName: 'walletlink.social',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'walletlink.social vs Holder Comparison',
    description: 'One-time payment vs subscription for wallet-to-social lookups.',
  },
  alternates: {
    canonical: 'https://walletlink.social/vs/holder',
  },
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: 'walletlink.social vs Holder: Which is Right for You?',
  description:
    'Detailed comparison of wallet enrichment tools for crypto marketing teams. Compare pricing, features, and use cases.',
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
    '@id': 'https://walletlink.social/vs/holder',
  },
  datePublished: '2025-01-01',
  dateModified: new Date().toISOString().split('T')[0],
  keywords: 'Holder alternative, Holder.xyz, wallet enrichment, wallet messaging',
};

export default function HolderComparison() {
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
              walletlink.social vs Holder
            </h1>
            <p className="text-xl text-muted-foreground">
              Holder.xyz focuses on wallet messaging and community management.
              We focus purely on wallet-to-social lookups.
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
                    <th className="text-left py-4 pl-4">Holder</th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Focus</td>
                    <td className="py-4 px-4 bg-emerald-50/50 dark:bg-emerald-950/20">
                      Wallet → Social lookups
                    </td>
                    <td className="py-4 pl-4">Wallet messaging & CRM</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Pricing</td>
                    <td className="py-4 px-4 bg-emerald-50/50 dark:bg-emerald-950/20">
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                        $149 - $420
                      </span>{' '}
                      one-time
                    </td>
                    <td className="py-4 pl-4">Subscription model</td>
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
                      <Check className="h-4 w-4 text-emerald-500" />
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">ENS</td>
                    <td className="py-4 px-4 bg-emerald-50/50 dark:bg-emerald-950/20">
                      <Check className="h-4 w-4 text-emerald-500" />
                    </td>
                    <td className="py-4 pl-4">
                      <Check className="h-4 w-4 text-emerald-500" />
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Lens</td>
                    <td className="py-4 px-4 bg-emerald-50/50 dark:bg-emerald-950/20">
                      <Check className="h-4 w-4 text-emerald-500" />
                    </td>
                    <td className="py-4 pl-4">
                      <Check className="h-4 w-4 text-emerald-500" />
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Farcaster Followers</td>
                    <td className="py-4 px-4 bg-emerald-50/50 dark:bg-emerald-950/20">
                      <Check className="h-4 w-4 text-emerald-500" />
                    </td>
                    <td className="py-4 pl-4 text-muted-foreground">
                      Limited
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
                    <td className="py-4 pl-4">
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
                    <td className="py-4 pr-4 font-medium">Wallet Messaging</td>
                    <td className="py-4 px-4 bg-emerald-50/50 dark:bg-emerald-950/20">
                      <X className="h-4 w-4 text-muted-foreground" />
                    </td>
                    <td className="py-4 pl-4">
                      <Check className="h-4 w-4 text-emerald-500" />
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
                </tbody>
              </table>
            </div>
          </section>

          {/* What is Holder */}
          <section className="mb-12">
            <h2 className="text-2xl font-semibold mb-4">What is Holder?</h2>
            <p className="text-muted-foreground mb-4">
              Holder.xyz is a Web3 CRM platform focused on wallet messaging and
              community management. While it includes wallet enrichment
              (Farcaster, Lens, ENS), its primary use case is different:
            </p>
            <ul className="list-disc list-inside text-muted-foreground space-y-2 mb-4">
              <li>Direct messaging to wallet holders</li>
              <li>Community engagement and management</li>
              <li>Audience segmentation for campaigns</li>
              <li>Token-gated experiences</li>
            </ul>
            <p className="text-muted-foreground">
              If you need to message wallet holders directly or manage ongoing
              community engagement, Holder&apos;s platform approach makes sense.
              But if you just need to export social handles for outreach, you&apos;re
              paying for features you won&apos;t use.
            </p>
          </section>

          {/* What is walletlink.social */}
          <section className="mb-12">
            <h2 className="text-2xl font-semibold mb-4">
              What is walletlink.social?
            </h2>
            <p className="text-muted-foreground mb-4">
              We do one thing: turn wallet addresses into social profiles. No
              messaging, no community tools, no ongoing platform. Just:
            </p>
            <ol className="list-decimal list-inside text-muted-foreground space-y-2 mb-4">
              <li>Upload your CSV of wallet addresses</li>
              <li>We aggregate multiple data sources for accuracy</li>
              <li>Export Twitter handles and Farcaster profiles</li>
              <li>Save lookups and add addresses over time (Pro+)</li>
            </ol>
            <p className="text-muted-foreground">
              Our priority score ranks wallets by holdings × social reach, so you
              can focus outreach on the most influential holders first.
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
                    <span>You&apos;ll do outreach on Twitter/Farcaster directly</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-emerald-500 flex-shrink-0" />
                    <span>You want to pay once, not subscribe</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-emerald-500 flex-shrink-0" />
                    <span>You want to prioritize wallets by influence</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-emerald-500 flex-shrink-0" />
                    <span>You don&apos;t need wallet messaging</span>
                  </li>
                </ul>
              </div>

              {/* Holder */}
              <div className="border rounded-lg p-6">
                <h3 className="font-semibold mb-4">Choose Holder if:</h3>
                <ul className="space-y-3 text-sm text-muted-foreground">
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                    <span>You need to message wallets directly</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                    <span>You&apos;re building ongoing community engagement</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                    <span>You want token-gated experiences</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                    <span>You need audience segmentation tools</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                    <span>You prefer a full CRM platform</span>
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
              <h3 className="font-semibold mb-4">Holder</h3>
              <p className="text-muted-foreground text-sm mb-2">
                Subscription-based pricing:
              </p>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>- Free tier with limited features</li>
                <li>- Paid plans for messaging and advanced features</li>
                <li>- Contact for enterprise pricing</li>
              </ul>
            </div>

            <div className="mt-6 p-4 border rounded-lg bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800">
              <p className="text-sm">
                <span className="font-medium">Key Difference:</span> walletlink.social
                is a one-time purchase for lookup capability. Holder is a subscription
                platform for ongoing messaging. If you just need social handles to
                export, one payment vs recurring makes a big difference.
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
              <li>
                <Link
                  href="/vs/blaze"
                  className="text-muted-foreground hover:text-foreground underline"
                >
                  walletlink.social vs Blaze
                </Link>
              </li>
            </ul>
          </nav>
        </article>

        {/* Footer */}
        <footer className="container mx-auto max-w-4xl px-4 py-6 border-t text-center text-sm text-muted-foreground">
          <p>
            made with 🌠 by{' '}
            <a
              href="https://x.com/starl3xx"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground"
            >
              @starl3xx
            </a>
          </p>
        </footer>
      </div>
    </>
  );
}
