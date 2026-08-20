import type { Metadata } from 'next';
import Link from 'next/link';
import { PageShell } from '@/components/ui/page-shell';
import { Button } from '@/components/ui/button';
import { Figure } from '@/components/ui/figure';
import { TIER_PRICES } from '@/lib/access';
import { ArrowRight, BookOpenText, Check, MagnifyingGlass, X } from '@phosphor-icons/react/dist/ssr';
import { INDEXED_WALLETS } from '@/lib/public-figures';
import { ReachabilityClaim } from '@/components/ReachabilityClaim';

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
      <PageShell>
        <article className="mx-auto max-w-[68ch]">
          <header className="mb-12">
            {/* The emphasis span is the type system's one device: a 600-weight
                word inside a 200-weight line. Both cuts are already loaded. */}
            <h1 className="mb-4 max-w-[17ch] text-4xl font-extralight leading-[1.02] tracking-[var(--tracking-display)] sm:text-5xl">
              A lookup, not a{' '}
              <em className="font-semibold not-italic text-accent-brand">CRM</em>.
            </h1>
            <p className="max-w-[46ch] text-lg font-light leading-snug text-foreground/80">
              Blaze wants to be where you manage the relationship. We just tell you who the wallet belongs to, and hand it back.
            </p>

            <div className="mt-6 flex flex-wrap gap-2.5">
              <Button asChild>
                <Link href="/">
                  <MagnifyingGlass className="h-4 w-4" aria-hidden />
                  Run a lookup
                </Link>
              </Button>
              <Button asChild variant="outline">
                <a href="https://docs.walletlink.social" target="_blank" rel="noopener noreferrer">
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
              <Figure value="16-46%" label="have an X or Farcaster account" brand />
              <Figure value={`$${TIER_PRICES.pro}`} label="once, no subscription" />
            </dl>
          </header>

          <div className="mb-16">
            <ReachabilityClaim competitor="Blaze" />
          </div>

          {/* What happened */}
          <section className="mb-12">
            <h2 className="text-2xl font-light tracking-[-0.028em] mb-4">What happened to Blaze?</h2>
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
            <h2 className="text-2xl font-light tracking-[-0.028em] mb-6">
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
                      Wallet → Social only
                    </td>
                    <td className="py-4 pl-4">
                      Full Web3 CRM platform (discontinued)
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Pricing</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <span className="font-semibold text-accent-brand">
                        ${TIER_PRICES.pro} - ${TIER_PRICES.unlimited}
                      </span>{' '}
                      one-time
                    </td>
                    <td className="py-4 pl-4">Was $79+/month ($948+/year)</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Twitter/X</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <Check className="h-4 w-4 text-accent-brand" />
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
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <Check className="h-4 w-4 text-accent-brand" />
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
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <Check className="h-4 w-4 text-accent-brand" />
                    </td>
                    <td className="py-4 pl-4">
                      <X className="h-4 w-4 text-muted-foreground" />
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Priority Score</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <Check className="h-4 w-4 text-accent-brand" />
                      <span className="text-xs text-muted-foreground ml-1">(Pro+)</span>
                    </td>
                    <td className="py-4 pl-4">
                      <X className="h-4 w-4 text-muted-foreground" />
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Lookup History</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <Check className="h-4 w-4 text-accent-brand" />
                      <span className="text-xs text-muted-foreground ml-1">(Pro+)</span>
                    </td>
                    <td className="py-4 pl-4 text-muted-foreground">
                      Was part of the CRM
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Contract Import</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
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
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <Check className="h-4 w-4 text-accent-brand" />
                      <span className="text-xs text-muted-foreground ml-1">(Unlimited)</span>
                    </td>
                    <td className="py-4 pl-4 text-muted-foreground">
                      <X className="h-4 w-4 text-muted-foreground" />
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Community Tools</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
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
            <h2 className="text-2xl font-light tracking-[-0.028em] mb-4">
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
              <li>Save lookups (Pro+), and grow them with new addresses (Unlimited)</li>
            </ol>
            <p className="text-muted-foreground">
              Lookups are backed by an index of {INDEXED_WALLETS} wallets with complete
              Farcaster protocol coverage, refreshed daily. Over 99.9% of
              Twitter matches are user-attested (links the wallet owner created
              themselves, such as a verified Farcaster account or an onchain ENS
              record), and every match carries the evidence behind it, so there
              is no guesswork in your outreach list.
            </p>
          </section>

          {/* Migrating from Blaze */}
          <section className="mb-16">
            <h2 className="text-2xl font-light tracking-[-0.028em] mb-6">Migrating from Blaze</h2>
            <div className="border rounded-lg p-6 bg-accent-brand-tint border-accent-brand">
              <h3 className="font-semibold mb-4 text-accent-brand">
                Three steps to rebuild your wallet-to-Twitter workflow:
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
                    Upload the CSV to walletlink.social: the free tier covers
                    500 wallets with no credit card
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <Check className="h-4 w-4 mt-0.5 text-accent-brand flex-shrink-0" />
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
            <h2 className="text-2xl font-light tracking-[-0.028em] mb-6">Pricing after Blaze</h2>

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

            <div className="p-4 border rounded-lg bg-accent-brand-tint border-accent-brand">
              <p className="text-sm">
                <span className="font-medium">No subscription to replace:</span>{' '}
                Blaze started at $79/month, $948+ per year. walletlink.social
                Pro is{' '}
                <span className="font-semibold text-accent-brand">
                  $99 once
                </span>,{' '}
                less than two months of the old Blaze subscription, and it
                never renews.
              </p>
            </div>
          </section>

          {/* CTA */}
          <section className="text-center py-12 border-t">
            <h2 className="text-2xl font-light tracking-[-0.028em] mb-4">
              Ready to find your wallet holders?
            </h2>
            <p className="text-muted-foreground mb-6">
              Try walletlink.social free - 500 wallets, no credit card
              required.
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
