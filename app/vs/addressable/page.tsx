import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { Check, X, ArrowRight } from 'lucide-react';

export const metadata: Metadata = {
  title: 'walletlink.social vs Addressable: Which is Right for You? (2025)',
  description:
    'Detailed comparison of walletlink.social and Addressable. If you only need wallet-to-social lookups without the full marketing suite, see why teams choose us.',
  openGraph: {
    title: 'walletlink.social vs Addressable Comparison',
    description:
      'Compare wallet-to-social lookup tools. One-time payment vs enterprise subscription. See which is right for your crypto marketing needs.',
    type: 'article',
  },
  alternates: {
    canonical: 'https://walletlink.social/vs/addressable',
  },
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: 'walletlink.social vs Addressable: Which is Right for You?',
  description:
    'Detailed comparison of wallet-to-social lookup tools for crypto marketing teams.',
  author: {
    '@type': 'Organization',
    name: 'walletlink.social',
  },
  datePublished: '2025-01-01',
  dateModified: new Date().toISOString().split('T')[0],
};

export default function AddressableComparison() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="min-h-screen bg-background">
        <div className="container mx-auto py-12 px-4 max-w-4xl">
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
              walletlink.social vs Addressable
            </h1>
            <p className="text-xl text-muted-foreground">
              Both help crypto teams reach wallet holders. But they solve
              different problems at different price points.
            </p>
          </header>

          {/* Quick Summary */}
          <section className="mb-16">
            <h2 className="text-2xl font-semibold mb-6">Quick Comparison</h2>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-4 pr-4"></th>
                    <th className="text-left py-4 px-4 bg-emerald-50 dark:bg-emerald-950/30 rounded-tl-lg">
                      <span className="font-semibold">walletlink.social</span>
                    </th>
                    <th className="text-left py-4 pl-4">Addressable</th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Focus</td>
                    <td className="py-4 px-4 bg-emerald-50/50 dark:bg-emerald-950/20">
                      Wallet → Social only
                    </td>
                    <td className="py-4 pl-4">Full marketing platform</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Pricing</td>
                    <td className="py-4 px-4 bg-emerald-50/50 dark:bg-emerald-950/20">
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                        $149 - $420
                      </span>{' '}
                      one-time
                    </td>
                    <td className="py-4 pl-4">$1,000s/month subscription</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Access</td>
                    <td className="py-4 px-4 bg-emerald-50/50 dark:bg-emerald-950/20">
                      Instant, self-serve
                    </td>
                    <td className="py-4 pl-4">Sales call required</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Setup Time</td>
                    <td className="py-4 px-4 bg-emerald-50/50 dark:bg-emerald-950/20">
                      2 minutes
                    </td>
                    <td className="py-4 pl-4">Days/weeks onboarding</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Contract</td>
                    <td className="py-4 px-4 bg-emerald-50/50 dark:bg-emerald-950/20">
                      None
                    </td>
                    <td className="py-4 pl-4">Enterprise agreement</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Twitter Export</td>
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
                    <td className="py-4 pl-4 text-muted-foreground">
                      Limited
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Lookup History</td>
                    <td className="py-4 px-4 bg-emerald-50/50 dark:bg-emerald-950/20">
                      <Check className="h-4 w-4 text-emerald-500" />
                      <span className="text-xs text-muted-foreground ml-1">(Pro+)</span>
                    </td>
                    <td className="py-4 pl-4">
                      <Check className="h-4 w-4 text-emerald-500" />
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
                    <td className="py-4 pr-4 font-medium">Ad Attribution</td>
                    <td className="py-4 px-4 bg-emerald-50/50 dark:bg-emerald-950/20">
                      <X className="h-4 w-4 text-muted-foreground" />
                    </td>
                    <td className="py-4 pl-4">
                      <Check className="h-4 w-4 text-emerald-500" />
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">CRM Integration</td>
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

          {/* What is Addressable */}
          <section className="mb-12">
            <h2 className="text-2xl font-semibold mb-4">What is Addressable?</h2>
            <p className="text-muted-foreground mb-4">
              Addressable is a comprehensive web3 marketing platform built for
              enterprise teams. It offers wallet-to-social resolution as one
              feature within a larger suite that includes:
            </p>
            <ul className="list-disc list-inside text-muted-foreground space-y-2 mb-4">
              <li>Ad attribution and conversion tracking</li>
              <li>Audience segmentation and targeting</li>
              <li>CRM and marketing automation integrations</li>
              <li>Cross-chain wallet analytics</li>
            </ul>
            <p className="text-muted-foreground">
              If you&apos;re running ongoing paid campaigns and need to measure
              ROI across the full marketing funnel, Addressable&apos;s
              enterprise approach makes sense.
            </p>
          </section>

          {/* What is walletlink.social */}
          <section className="mb-12">
            <h2 className="text-2xl font-semibold mb-4">
              What is walletlink.social?
            </h2>
            <p className="text-muted-foreground mb-4">
              We do one thing: turn wallet addresses into social profiles. No
              attribution, no CRM, no ads platform. Just:
            </p>
            <ol className="list-decimal list-inside text-muted-foreground space-y-2 mb-4">
              <li>Upload your CSV of wallet addresses</li>
              <li>We check ENS, Web3.bio, and Neynar</li>
              <li>Export Twitter handles and Farcaster profiles</li>
              <li>Save lookups and add addresses over time (Pro+)</li>
            </ol>
            <p className="text-muted-foreground">
              Match rates average 15-25% (6-10x industry average) because we
              aggregate multiple data sources and prioritize accuracy over
              coverage.
            </p>
          </section>

          {/* When to choose each */}
          <section className="mb-16">
            <h2 className="text-2xl font-semibold mb-6">When to Choose Each</h2>

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
                    <span>You want to start today, not next month</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-emerald-500 flex-shrink-0" />
                    <span>You have a specific campaign or project</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-emerald-500 flex-shrink-0" />
                    <span>You want to grow lookups over time</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-emerald-500 flex-shrink-0" />
                    <span>Budget is a consideration</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-emerald-500 flex-shrink-0" />
                    <span>You don&apos;t want another subscription</span>
                  </li>
                </ul>
              </div>

              {/* Addressable */}
              <div className="border rounded-lg p-6">
                <h3 className="font-semibold mb-4">Choose Addressable if:</h3>
                <ul className="space-y-3 text-sm text-muted-foreground">
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                    <span>You need full marketing attribution</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                    <span>You want CRM and automation integrations</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                    <span>You&apos;re running ongoing paid campaigns</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                    <span>Budget isn&apos;t a primary constraint</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                    <span>You have time for enterprise onboarding</span>
                  </li>
                </ul>
              </div>
            </div>
          </section>

          {/* Pricing Comparison */}
          <section className="mb-16">
            <h2 className="text-2xl font-semibold mb-6">Pricing Breakdown</h2>

            <div className="bg-muted/30 rounded-lg p-6 mb-6">
              <h3 className="font-semibold mb-4">walletlink.social</h3>
              <div className="grid sm:grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Free</p>
                  <p className="text-2xl font-bold">$0</p>
                  <p className="text-muted-foreground">Up to 1,000 wallets/lookup</p>
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
              <h3 className="font-semibold mb-4">Addressable</h3>
              <p className="text-muted-foreground text-sm mb-2">
                Custom enterprise pricing. Based on public information and user
                reports:
              </p>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>- Typically starts at $1,000+/month</li>
                <li>- Annual contracts common</li>
                <li>- Requires sales call for exact pricing</li>
              </ul>
            </div>

            <div className="mt-6 p-4 border rounded-lg bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800">
              <p className="text-sm">
                <span className="font-medium">ROI Example:</span> If you pay
                $420 once for walletlink.social instead of $1,000/month for
                Addressable, you save{' '}
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                  $11,580 in year one
                </span>{' '}
                - assuming you only need wallet-to-social lookups.
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

          {/* Footer */}
          <footer className="mt-12 pt-6 border-t text-center text-sm text-muted-foreground">
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
      </div>
    </>
  );
}
