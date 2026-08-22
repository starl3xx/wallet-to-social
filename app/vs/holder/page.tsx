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
  title: 'Holder alternative for wallet-based CRM (Holder shut down)',
  description:
    'Holder (holder.xyz) sunset in June 2024. If you used Holder’s web3 CRM to know and reach your token holders, here’s where to migrate.',
  keywords: [
    'holder.xyz alternative',
    'holder xyz shut down',
    'web3 CRM alternative',
    'wallet to social',
    'wallet lookup tool',
  ],
  openGraph: {
    title: 'Holder alternative for wallet-based CRM (Holder shut down)',
    description:
      'Holder sunset in June 2024. Migrate your holder outreach to walletlink.social: one-time pricing, Twitter and Farcaster coverage.',
    type: 'article',
    url: 'https://walletlink.social/vs/holder',
    siteName: 'walletlink.social',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Holder alternative for wallet-based CRM',
    description:
      'Holder shut down in June 2024. Here’s where to migrate your holder outreach.',
  },
  alternates: {
    canonical: 'https://walletlink.social/vs/holder',
  },
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: 'Holder alternative for wallet-based CRM (Holder shut down)',
  description:
    'Holder (holder.xyz) sunset in June 2024. A migration guide for former Holder users moving their token holder outreach to walletlink.social.',
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
  datePublished: '2026-08-12',
  dateModified: new Date().toISOString().split('T')[0],
  keywords:
    'holder.xyz alternative, holder xyz shut down, web3 CRM, wallet lookup',
};

export default function HolderComparison() {
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
              Find them, then{' '}
              <em className="font-semibold not-italic text-accent-brand">
                reach them
              </em>
              .
            </h1>
            <p className="max-w-[46ch] text-lg font-light leading-snug text-foreground/80">
              Holder messages wallets. We resolve wallets to the accounts their
              owners actually read, so you can reach them anywhere.
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
            <ReachabilityClaim competitor="Holder" />
          </div>

          {/* What happened */}
          <section className="mb-12">
            <h2 className="text-2xl font-light tracking-[-0.028em] mb-4">
              What happened to Holder?
            </h2>
            <p className="text-muted-foreground mb-4">
              Holder was a web3 CRM built around wallets instead of email
              addresses. It let teams segment their token holders, enrich wallet
              records with identity data, and message holders through
              wallet-native channels. Its suite included:
            </p>
            <ul className="list-disc list-inside text-muted-foreground space-y-2 mb-4">
              <li>Wallet-based contact records and segmentation</li>
              <li>Holder identity enrichment</li>
              <li>Wallet messaging and campaign tools</li>
              <li>Token-gated audience workflows</li>
            </ul>
            <p className="text-muted-foreground">
              The product sunset in June 2024, and the platform (along with its
              holder records and messaging campaigns) is no longer available. If
              you relied on Holder to know who your token holders are, that
              workflow needs a new home.
            </p>
          </section>

          {/* Migration table */}
          <section className="mb-16">
            <h2 className="text-2xl font-light tracking-[-0.028em] mb-6">
              What Holder offered vs what walletlink.social offers
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-4 pr-4"></th>
                    <th className="text-left py-4 px-4 bg-accent-brand-tint rounded-tl-lg">
                      <span className="font-semibold">walletlink.social</span>
                    </th>
                    <th className="text-left py-4 pl-4">What Holder offered</th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Focus</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      Wallet → Social only
                    </td>
                    <td className="py-4 pl-4">
                      Full web3 CRM platform (shut down)
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
                    <td className="py-4 pl-4">Was a monthly subscription</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">
                      Holder identity enrichment
                    </td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <Check
                        alt="Yes"
                        role="img"
                        aria-label="Yes"
                        className="h-4 w-4 text-accent-brand"
                      />
                      <span className="text-xs text-muted-foreground ml-1">
                        (Twitter + Farcaster)
                      </span>
                    </td>
                    <td className="py-4 pl-4 text-muted-foreground">
                      Offered, no longer available
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Farcaster</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <Check
                        alt="Yes"
                        role="img"
                        aria-label="Yes"
                        className="h-4 w-4 text-accent-brand"
                      />
                      <span className="text-xs text-muted-foreground ml-1">
                        (complete protocol coverage)
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
                    <td className="py-4 pr-4 font-medium">Holder messaging</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <X
                        alt="No"
                        role="img"
                        aria-label="No"
                        className="h-4 w-4 text-muted-foreground"
                      />
                      <span className="text-xs text-muted-foreground ml-1">
                        (export an X list and reach them there)
                      </span>
                    </td>
                    <td className="py-4 pl-4 text-muted-foreground">
                      Was wallet messaging
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Contract Import</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <Check
                        alt="Yes"
                        role="img"
                        aria-label="Yes"
                        className="h-4 w-4 text-accent-brand"
                      />
                      <span className="text-xs text-muted-foreground ml-1">
                        (every pack, on all seven supported chains)
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
                    <td className="py-4 pr-4 font-medium">Priority Score</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <Check
                        alt="Yes"
                        role="img"
                        aria-label="Yes"
                        className="h-4 w-4 text-accent-brand"
                      />
                      <span className="text-xs text-muted-foreground ml-1">
                        (every pack)
                      </span>
                    </td>
                    <td className="py-4 pl-4 text-muted-foreground">
                      Was custom segments
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">CRM workflows</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <X
                        alt="No"
                        role="img"
                        aria-label="No"
                        className="h-4 w-4 text-muted-foreground"
                      />
                      <span className="text-xs text-muted-foreground ml-1">
                        (export to your own CRM)
                      </span>
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
            <h2 className="text-2xl font-light tracking-[-0.028em] mb-4">
              What is walletlink.social?
            </h2>
            <p className="text-muted-foreground mb-4">
              We do one thing: turn wallet addresses into social profiles. No
              CRM, no campaign builder. Just:
            </p>
            <ol className="list-decimal list-inside text-muted-foreground space-y-2 mb-4">
              <li>Upload your CSV of wallet addresses</li>
              <li>We match them against our identity index</li>
              <li>Export Twitter handles and Farcaster profiles</li>
              <li>Save lookups, and grow them with new addresses</li>
            </ol>
            <p className="text-muted-foreground">
              Lookups are backed by an index of {INDEXED_WALLETS} wallets with
              complete Farcaster protocol coverage, refreshed daily. Over 99.9%
              of Twitter matches are user-attested (links the wallet owner
              created themselves, such as a verified Farcaster account or an
              onchain ENS record), and every match carries the evidence behind
              it. Export the results into any CRM you already use.
            </p>
          </section>

          {/* Migrating from Holder */}
          <section className="mb-16">
            <h2 className="text-2xl font-light tracking-[-0.028em] mb-6">
              Migrating from Holder
            </h2>
            <div className="border rounded-lg p-6 bg-accent-brand-tint border-accent-brand">
              <h3 className="font-semibold mb-4 text-accent-brand">
                Three steps to rebuild your holder outreach:
              </h3>
              <ul className="space-y-3 text-sm">
                <li className="flex items-start gap-2">
                  <Check className="h-4 w-4 mt-0.5 text-accent-brand flex-shrink-0" />
                  <span>
                    Rebuild your holder list from the source: pull it straight
                    from the token contract (Etherscan, Basescan, or our
                    contract import)
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
                    Export enriched profiles into your own CRM, or straight to
                    an X list, and reach holders where they already read
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
              Pricing after Holder
            </h2>

            <PackPricing />

            <div className="p-4 border rounded-lg bg-accent-brand-tint border-accent-brand">
              <p className="text-sm">
                <span className="font-medium">No subscription to replace:</span>{' '}
                every pack is a one-time payment, and every one includes API
                access. Pay once, keep your holder data workflow forever.
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
              <ArrowRight className="h-4 w-4" aria-hidden />
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
