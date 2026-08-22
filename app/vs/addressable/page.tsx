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
  title: 'walletlink.social vs Addressable: Comparison (2026)',
  description:
    'Compare walletlink.social and Addressable for wallet-to-social lookups. See why teams choose dedicated tools over enterprise marketing suites.',
  keywords: [
    'Addressable alternative',
    'wallet to social',
    'Web3 marketing',
    'wallet lookup tool',
    'crypto marketing',
  ],
  openGraph: {
    title: 'walletlink.social vs Addressable: Which is Right for You?',
    description:
      'Compare wallet-to-social lookup tools. Credit packs from $29, no subscription, against an $18,000/yr enterprise floor. See which is right for your crypto marketing needs.',
    type: 'article',
    url: 'https://walletlink.social/vs/addressable',
    siteName: 'walletlink.social',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'walletlink.social vs Addressable Comparison',
    description:
      'One-time payment vs enterprise subscription for wallet-to-social lookups.',
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
  keywords:
    'Addressable alternative, wallet to social, Web3 marketing, crypto marketing',
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
            {/* The emphasis span is the type system's one device: a 600-weight
                word inside a 200-weight line. Both cuts are already loaded. */}
            <h1 className="mb-4 max-w-[17ch] text-4xl font-extralight leading-[1.02] tracking-[var(--tracking-display)] sm:text-5xl">
              Deterministic, not{' '}
              <em className="font-semibold not-italic text-accent-brand">
                probabilistic
              </em>
              .
            </h1>
            <p className="max-w-[46ch] text-lg font-light leading-snug text-foreground/80">
              Addressable infers who owns a wallet. We report only what the
              owner published. Fewer matches, and every one of them real.
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
                with the contactable one in brand because it is the number to act on.
                It is a range, not an average: Base measures 46.2% and Ethereum
                16.6%, and an average would hide the thing that decides a campaign
                and coverage carrying a green mark because it is the measured one. */}
            <dl className="mt-8 flex flex-wrap gap-x-10 gap-y-5 border-t border-border pt-5">
              <Figure value={INDEXED_WALLETS} label="wallets indexed" />
              <Figure value="100%" label="Farcaster coverage" attested />
              <Figure
                value="16-46%"
                label="have an X or Farcaster account"
                brand
              />
              <Figure
                value={`$${PACKS.trial.priceCents / 100}`}
                label="to start, no subscription"
              />
            </dl>
          </header>

          <div className="mb-16">
            <ReachabilityClaim competitor="Addressable" />
          </div>

          {/* Quick Summary */}
          <section className="mb-16">
            <h2 className="text-2xl font-light tracking-[-0.028em] mb-6">
              Quick comparison
            </h2>
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
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      Wallet → Social only
                    </td>
                    <td className="py-4 pl-4">Full marketing platform</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Match method</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      Deterministic, user-attested (Farcaster verifications,
                      onchain ENS records)
                    </td>
                    <td className="py-4 pl-4">
                      Probabilistic &ldquo;fingerprinting&rdquo;
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Index size</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      {INDEXED_WALLETS} wallets, complete Farcaster coverage
                    </td>
                    <td className="py-4 pl-4">
                      23M claimed (methodology undisclosed)
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
                    <td className="py-4 pl-4">$1,000s/month subscription</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Access</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      Instant, self-serve
                    </td>
                    <td className="py-4 pl-4">Sales call required</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Setup Time</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      2 minutes
                    </td>
                    <td className="py-4 pl-4">Days/weeks onboarding</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Contract</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">None</td>
                    <td className="py-4 pl-4">Enterprise agreement</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Twitter Export</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <Check className="h-4 w-4 text-accent-brand" />
                    </td>
                    <td className="py-4 pl-4">
                      <Check className="h-4 w-4 text-accent-brand" />
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Farcaster</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <Check className="h-4 w-4 text-accent-brand" />
                    </td>
                    <td className="py-4 pl-4 text-muted-foreground">Limited</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">
                      Farcaster Followers
                    </td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <Check className="h-4 w-4 text-accent-brand" />
                    </td>
                    <td className="py-4 pl-4 text-muted-foreground">
                      <X className="h-4 w-4 text-muted-foreground" />
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Priority Score</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <Check className="h-4 w-4 text-accent-brand" />
                      <span className="text-xs text-muted-foreground ml-1">
                        (every pack)
                      </span>
                    </td>
                    <td className="py-4 pl-4">
                      <X className="h-4 w-4 text-muted-foreground" />
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Lookup History</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <Check className="h-4 w-4 text-accent-brand" />
                      <span className="text-xs text-muted-foreground ml-1">
                        (every pack)
                      </span>
                    </td>
                    <td className="py-4 pl-4">
                      <Check className="h-4 w-4 text-accent-brand" />
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Add to Lookups</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <Check className="h-4 w-4 text-accent-brand" />
                      <span className="text-xs text-muted-foreground ml-1">
                        (every pack)
                      </span>
                    </td>
                    <td className="py-4 pl-4 text-muted-foreground">
                      <X className="h-4 w-4 text-muted-foreground" />
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Contract Import</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <Check className="h-4 w-4 text-accent-brand" />
                      <span className="text-xs text-muted-foreground ml-1">
                        (every pack, on all seven supported chains)
                      </span>
                    </td>
                    <td className="py-4 pl-4 text-muted-foreground">
                      <X className="h-4 w-4 text-muted-foreground" />
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Ad Attribution</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <X className="h-4 w-4 text-muted-foreground" />
                    </td>
                    <td className="py-4 pl-4">
                      <Check className="h-4 w-4 text-accent-brand" />
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">CRM Integration</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
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
            <h2 className="text-2xl font-light tracking-[-0.028em] mb-4">
              What is Addressable?
            </h2>
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
            <h2 className="text-2xl font-light tracking-[-0.028em] mb-4">
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
              <li>Save lookups, and grow them with new addresses</li>
            </ol>
            <p className="text-muted-foreground">
              Matches are deterministic and user-attested (Farcaster verified
              accounts and onchain ENS records), backed by a {INDEXED_WALLETS}
              -wallet index covering the complete Farcaster protocol.
              Addressable advertises 23M matched owners built with probabilistic
              &ldquo;fingerprinting&rdquo;; we never fingerprint. Over 99.9% of
              our Twitter matches are links the wallet owner created themselves,
              and every match is labelled with the evidence behind it.
            </p>
          </section>

          {/* When to choose each */}
          <section className="mb-16">
            <h2 className="text-2xl font-light tracking-[-0.028em] mb-6">
              When to choose each
            </h2>

            <div className="grid md:grid-cols-2 gap-6">
              {/* walletlink.social */}
              <div className="border rounded-lg p-6 bg-accent-brand-tint border-accent-brand">
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
            <h2 className="text-2xl font-light tracking-[-0.028em] mb-6">
              Pricing breakdown
            </h2>

            <PackPricing />

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

            <div className="mt-6 p-4 border rounded-lg bg-accent-brand-tint border-accent-brand">
              <p className="text-sm">
                <span className="font-medium">ROI Example:</span> If you pay $
                {PACKS.index.priceCents / 100} once for the walletlink.social{' '}
                {PACKS.index.name} pack instead of $1,000/month for Addressable,
                you save{' '}
                <span className="font-semibold text-accent-brand">
                  ${(12 * 1000 - PACKS.index.priceCents / 100).toLocaleString()}{' '}
                  in year one
                </span>{' '}
                - assuming you only need wallet-to-social lookups.
              </p>
            </div>
          </section>

          {/* CTA */}
          <section className="text-center py-12 border-t">
            <h2 className="text-2xl font-light tracking-[-0.028em] mb-4">
              Ready to find your wallet holders?
            </h2>
            <p className="text-muted-foreground mb-6">
              Try walletlink.social free: {FREE_MATCHES_PER_WINDOW} matches
              every {FREE_WINDOW_DAYS} days, no credit card required.
            </p>
            <Link
              href="/"
              className="transition-control inline-flex h-control items-center justify-center gap-2 whitespace-nowrap rounded-full bg-accent-brand px-5 text-sm font-medium text-accent-brand-foreground hover:bg-accent-brand-hover active:scale-[0.97]"
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
                  href="/vs/cookie3"
                  className="text-muted-foreground hover:text-foreground underline"
                >
                  walletlink.social vs Cookie3
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
