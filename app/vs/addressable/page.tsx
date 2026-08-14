import type { Metadata } from 'next';
import Link from 'next/link';
import { PageShell } from '@/components/ui/page-shell';
import { Check, X, ArrowRight } from 'lucide-react';

export const metadata: Metadata = {
  title: 'walletlink.social vs Addressable: Comparison (2026)',
  description:
    'Compare walletlink.social and Addressable for wallet-to-social lookups. See why teams choose dedicated tools over enterprise marketing suites.',
  keywords: ['Addressable alternative', 'wallet to social', 'Web3 marketing', 'wallet lookup tool', 'crypto marketing'],
  openGraph: {
    title: 'walletlink.social vs Addressable: Which is Right for You?',
    description:
      'Compare wallet-to-social lookup tools. One-time $99 vs enterprise subscription. See which is right for your crypto marketing needs.',
    type: 'article',
    url: 'https://walletlink.social/vs/addressable',
    siteName: 'walletlink.social',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'walletlink.social vs Addressable Comparison',
    description: 'One-time payment vs enterprise subscription for wallet-to-social lookups.',
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
    '@id': 'https://walletlink.social/vs/addressable',
  },
  datePublished: '2025-01-01',
  dateModified: new Date().toISOString().split('T')[0],
  keywords: 'Addressable alternative, wallet to social, Web3 marketing, crypto marketing',
};

export default function AddressableComparison() {
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
              walletlink.social vs Addressable
            </h1>
            <p className="text-xl text-muted-foreground">
              Both help crypto teams reach wallet holders. But they solve
              different problems at different price points.
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
                    <th className="text-left py-4 px-4 bg-accent-brand-tint rounded-tl-lg">
                      <span className="font-semibold">walletlink.social</span>
                    </th>
                    <th className="text-left py-4 pl-4">Addressable</th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Focus</td>
                    <td className="py-4 px-4 bg-accent-brand-tint/60">
                      Wallet → Social only
                    </td>
                    <td className="py-4 pl-4">Full marketing platform</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Match method</td>
                    <td className="py-4 px-4 bg-accent-brand-tint/60">
                      Deterministic, user-attested (Farcaster verifications,
                      onchain ENS records)
                    </td>
                    <td className="py-4 pl-4">
                      Probabilistic &ldquo;fingerprinting&rdquo;
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Index size</td>
                    <td className="py-4 px-4 bg-accent-brand-tint/60">
                      4.7M wallets, complete Farcaster coverage
                    </td>
                    <td className="py-4 pl-4">
                      23M claimed (methodology undisclosed)
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Pricing</td>
                    <td className="py-4 px-4 bg-accent-brand-tint/60">
                      <span className="font-semibold text-accent-brand">
                        $99 - $249
                      </span>{' '}
                      one-time
                    </td>
                    <td className="py-4 pl-4">$1,000s/month subscription</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Access</td>
                    <td className="py-4 px-4 bg-accent-brand-tint/60">
                      Instant, self-serve
                    </td>
                    <td className="py-4 pl-4">Sales call required</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Setup Time</td>
                    <td className="py-4 px-4 bg-accent-brand-tint/60">
                      2 minutes
                    </td>
                    <td className="py-4 pl-4">Days/weeks onboarding</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Contract</td>
                    <td className="py-4 px-4 bg-accent-brand-tint/60">
                      None
                    </td>
                    <td className="py-4 pl-4">Enterprise agreement</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Twitter Export</td>
                    <td className="py-4 px-4 bg-accent-brand-tint/60">
                      <Check className="h-4 w-4 text-accent-brand" />
                    </td>
                    <td className="py-4 pl-4">
                      <Check className="h-4 w-4 text-accent-brand" />
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Farcaster</td>
                    <td className="py-4 px-4 bg-accent-brand-tint/60">
                      <Check className="h-4 w-4 text-accent-brand" />
                    </td>
                    <td className="py-4 pl-4 text-muted-foreground">
                      Limited
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Farcaster Followers</td>
                    <td className="py-4 px-4 bg-accent-brand-tint/60">
                      <Check className="h-4 w-4 text-accent-brand" />
                    </td>
                    <td className="py-4 pl-4 text-muted-foreground">
                      <X className="h-4 w-4 text-muted-foreground" />
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Priority Score</td>
                    <td className="py-4 px-4 bg-accent-brand-tint/60">
                      <Check className="h-4 w-4 text-accent-brand" />
                      <span className="text-xs text-muted-foreground ml-1">(Pro+)</span>
                    </td>
                    <td className="py-4 pl-4">
                      <X className="h-4 w-4 text-muted-foreground" />
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Lookup History</td>
                    <td className="py-4 px-4 bg-accent-brand-tint/60">
                      <Check className="h-4 w-4 text-accent-brand" />
                      <span className="text-xs text-muted-foreground ml-1">(Pro+)</span>
                    </td>
                    <td className="py-4 pl-4">
                      <Check className="h-4 w-4 text-accent-brand" />
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Add to Lookups</td>
                    <td className="py-4 px-4 bg-accent-brand-tint/60">
                      <Check className="h-4 w-4 text-accent-brand" />
                      <span className="text-xs text-muted-foreground ml-1">(Pro+)</span>
                    </td>
                    <td className="py-4 pl-4 text-muted-foreground">
                      <X className="h-4 w-4 text-muted-foreground" />
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Contract Import</td>
                    <td className="py-4 px-4 bg-accent-brand-tint/60">
                      <Check className="h-4 w-4 text-accent-brand" />
                      <span className="text-xs text-muted-foreground ml-1">
                        (Pro and Unlimited, on all seven supported chains)
                      </span>
                    </td>
                    <td className="py-4 pl-4 text-muted-foreground">
                      <X className="h-4 w-4 text-muted-foreground" />
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Farcaster DMs</td>
                    <td className="py-4 px-4 bg-accent-brand-tint/60">
                      <Check className="h-4 w-4 text-accent-brand" />
                      <span className="text-xs text-muted-foreground ml-1">(Unlimited)</span>
                    </td>
                    <td className="py-4 pl-4 text-muted-foreground">
                      <X className="h-4 w-4 text-muted-foreground" />
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Ad Attribution</td>
                    <td className="py-4 px-4 bg-accent-brand-tint/60">
                      <X className="h-4 w-4 text-muted-foreground" />
                    </td>
                    <td className="py-4 pl-4">
                      <Check className="h-4 w-4 text-accent-brand" />
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">CRM Integration</td>
                    <td className="py-4 px-4 bg-accent-brand-tint/60">
                      <X className="h-4 w-4 text-muted-foreground" />
                    </td>
                    <td className="py-4 pl-4">
                      <Check className="h-4 w-4 text-accent-brand" />
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
              <li>We aggregate multiple data sources for accuracy</li>
              <li>Export Twitter handles and Farcaster profiles</li>
              <li>Save lookups and add addresses over time (Pro+)</li>
            </ol>
            <p className="text-muted-foreground">
              Matches are deterministic and user-attested (Farcaster verified
              accounts and onchain ENS records), backed by a 4.7M-wallet
              index covering the complete Farcaster protocol. Addressable
              advertises 23M matched owners built with probabilistic
              &ldquo;fingerprinting&rdquo;; we only return links the wallet
              owner created themselves.
            </p>
          </section>

          {/* When to choose each */}
          <section className="mb-16">
            <h2 className="text-2xl font-semibold mb-6">When to choose each</h2>

            <div className="grid md:grid-cols-2 gap-6">
              {/* walletlink.social */}
              <div className="border rounded-lg p-6 bg-accent-brand-tint/60 border-accent-brand/30">
                <h3 className="font-semibold mb-4 text-accent-brand">
                  Choose walletlink.social if:
                </h3>
                <ul className="space-y-3 text-sm">
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-accent-brand flex-shrink-0" />
                    <span>You just need wallet → social lookups</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-accent-brand flex-shrink-0" />
                    <span>You want to start today, not next month</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-accent-brand flex-shrink-0" />
                    <span>You have a specific campaign or project</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-accent-brand flex-shrink-0" />
                    <span>You want to grow lookups over time</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-accent-brand flex-shrink-0" />
                    <span>Budget is a consideration</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-accent-brand flex-shrink-0" />
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
            <h2 className="text-2xl font-semibold mb-6">Pricing breakdown</h2>

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

            <div className="mt-6 p-4 border rounded-lg bg-accent-brand-tint/60 border-accent-brand/30">
              <p className="text-sm">
                <span className="font-medium">ROI Example:</span> If you pay
                $249 once for walletlink.social instead of $1,000/month for
                Addressable, you save{' '}
                <span className="font-semibold text-accent-brand">
                  $11,751 in year one
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

      </PageShell>
    </>
  );
}
