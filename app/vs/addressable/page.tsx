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
        {/* The reading column constrains measure, not position: 68ch, on the
            shell's left edge like /check and the blog index. It was centred
            with `mx-auto`, which put the text on a different horizontal line
            from the pages a reader visits before and after it. */}
        <article className="max-w-[68ch]">
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
            {/* The lede: 300 at 18px with the lead tracking, in the muted token.
                `text-foreground/80` was an opacity wash standing in for the
                token that already means "secondary text". */}
            <p className="max-w-[46ch] text-lg font-light leading-snug tracking-[var(--tracking-lead)] text-muted-foreground">
              Addressable infers who owns a wallet. We report only what the
              owner published. Fewer matches, and every one of them real.
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
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
            {/* Two-by-two on a phone, four across from `sm`. As a wrapping flex
                row the four figures broke 2/1/1 at 375px, and its 40/20/20px
                gaps were off the nine-step scale; these are 32, 24 and 24.
                `items-start` because Figure is a `flex-col-reverse` column:
                in a stretched grid cell it packs to the bottom, so a figure
                whose caption wraps sat a line above its neighbours. */}
            <dl className="mt-8 grid grid-cols-2 items-start gap-x-8 gap-y-6 border-t border-border pt-6 sm:grid-cols-4">
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
            <ReachabilityClaim competitor="Addressable" />
          </div>

          {/* Quick comparison. A Check in a capability cell is green, whichever
              column it sits in: "has this" is a measured fact, and green is the
              colour of one. A cross is muted. Captioned cells put the glyph and
              its caption in one flex row; Tailwind's preflight makes svg
              `display: block`, so an icon followed by a span stacked on two
              lines with the caption indented 4px under the glyph. The cards further
              down are lists, not capability claims, and their check marks take
              the card's own text colour. */}
          <section className="mb-16">
            <h2 className="text-2xl font-light tracking-[var(--tracking-title)] mb-6">
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
                      Wallet → social only
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
                    <td className="py-4 pr-4 font-medium">Setup time</td>
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
                    <td className="py-4 pr-4 font-medium">X export</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <Check
                        alt="Yes"
                        role="img"
                        aria-label="Yes"
                        className="h-4 w-4 text-attested"
                      />
                    </td>
                    <td className="py-4 pl-4">
                      <Check
                        alt="Yes"
                        role="img"
                        aria-label="Yes"
                        className="h-4 w-4 text-attested"
                      />
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Farcaster</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <Check
                        alt="Yes"
                        role="img"
                        aria-label="Yes"
                        className="h-4 w-4 text-attested"
                      />
                    </td>
                    <td className="py-4 pl-4 text-muted-foreground">Limited</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">
                      Farcaster followers
                    </td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <Check
                        alt="Yes"
                        role="img"
                        aria-label="Yes"
                        className="h-4 w-4 text-attested"
                      />
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
                    <td className="py-4 pr-4 font-medium">Priority score</td>
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
                    <td className="py-4 pr-4 font-medium">Lookup history</td>
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
                    <td className="py-4 pl-4">
                      <Check
                        alt="Yes"
                        role="img"
                        aria-label="Yes"
                        className="h-4 w-4 text-attested"
                      />
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Add to lookups</td>
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
                      <X
                        alt="No"
                        role="img"
                        aria-label="No"
                        className="h-4 w-4 text-muted-foreground"
                      />
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Contract import</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <span className="flex items-start gap-2">
                        <Check
                          alt="Yes"
                          role="img"
                          aria-label="Yes"
                          className="mt-0.5 h-4 w-4 flex-none text-attested"
                        />
                        <span className="text-xs text-muted-foreground">
                          (every pack, on all seven supported chains)
                        </span>
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
                    <td className="py-4 pr-4 font-medium">Ad attribution</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <X
                        alt="No"
                        role="img"
                        aria-label="No"
                        className="h-4 w-4 text-muted-foreground"
                      />
                    </td>
                    <td className="py-4 pl-4">
                      <Check
                        alt="Yes"
                        role="img"
                        aria-label="Yes"
                        className="h-4 w-4 text-attested"
                      />
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">CRM integration</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <X
                        alt="No"
                        role="img"
                        aria-label="No"
                        className="h-4 w-4 text-muted-foreground"
                      />
                    </td>
                    <td className="py-4 pl-4">
                      <Check
                        alt="Yes"
                        role="img"
                        aria-label="Yes"
                        className="h-4 w-4 text-attested"
                      />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* What is Addressable */}
          <section className="mb-12">
            <h2 className="text-2xl font-light tracking-[var(--tracking-title)] mb-4">
              What is Addressable?
            </h2>
            <p className="text-muted-foreground mb-4">
              Addressable is a comprehensive web3 marketing platform built for
              enterprise teams. It offers wallet-to-social resolution as one
              feature within a larger suite that includes:
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2 mb-4">
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
            <h2 className="text-2xl font-light tracking-[var(--tracking-title)] mb-4">
              What is walletlink.social?
            </h2>
            <p className="text-muted-foreground mb-4">
              We do one thing: turn wallet addresses into social profiles. No
              attribution, no CRM, no ads platform. Just:
            </p>
            <ol className="list-decimal pl-6 text-muted-foreground space-y-2 mb-4">
              <li>Upload your CSV of wallet addresses</li>
              <li>We aggregate multiple data sources for accuracy</li>
              <li>Export X handles and Farcaster profiles</li>
              <li>Save lookups, and grow them with new addresses</li>
            </ol>
            <p className="text-muted-foreground">
              Matches are deterministic and user-attested (Farcaster verified
              accounts and onchain ENS records), backed by a {INDEXED_WALLETS}
              -wallet index covering the complete Farcaster protocol.
              Addressable advertises 23M matched owners built with probabilistic
              &ldquo;fingerprinting&rdquo;; we never fingerprint. Over 99.9% of
              our X matches are links the wallet owner created themselves, and
              every match is labelled with the evidence behind it.
            </p>
          </section>

          {/* When to choose each */}
          <section className="mb-16">
            <h2 className="text-2xl font-light tracking-[var(--tracking-title)] mb-6">
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

          {/* Pricing comparison. The section owns the rhythm: space-y-6 separates
              the heading, the pack grid and the callouts, so the h2 carries no
              margin of its own and the callouts carry no mt. Gap and margin must
              not both own the same space. */}
          <section className="mb-16 space-y-6">
            <h2 className="text-2xl font-light tracking-[var(--tracking-title)]">
              Pricing breakdown
            </h2>

            <PackPricing />

            {/* The competitor's tier block takes the same inset surface as
                PackPricing above it: `bg-muted` at full opacity behind the one
                hairline, one panel for one meaning. Its tiers are a real list
                with outside markers and the 24px hanging indent the prose
                plugin uses; they were typed "- " inside unstyled `li`s, a
                third list treatment beside the two on this page. */}
            <div className="rounded-lg border border-border bg-muted p-6">
              <h3 className="font-semibold mb-4">Addressable</h3>
              <p className="text-muted-foreground text-sm mb-2">
                Custom enterprise pricing. Based on public information and user
                reports:
              </p>
              <ul className="list-disc pl-6 text-sm text-muted-foreground space-y-2">
                <li>Typically starts at $1,000+/month</li>
                <li>Annual contracts common</li>
                <li>Requires sales call for exact pricing</li>
              </ul>
            </div>

            <div className="p-6 border rounded-lg bg-accent-brand-tint border-accent-brand">
              <p className="text-sm">
                <span className="font-medium">ROI example:</span> If you pay $
                {PACKS.index.priceCents / 100} once for the walletlink.social{' '}
                {PACKS.index.name} pack instead of $1,000/month for Addressable,
                you save{' '}
                <span className="font-semibold text-accent-brand">
                  ${(12 * 1000 - PACKS.index.priceCents / 100).toLocaleString()}{' '}
                  in year one
                </span>
                , assuming you only need wallet-to-social lookups.
              </p>
            </div>
          </section>

          {/* Closing CTA. The Button primitive on a Link, the same as the hero:
              this used to paste Button's class string onto the Link, which drifted
              the moment Button changed (it had already lost the focus ring). The
              label is the one the product uses for this action everywhere, so the
              hero and the close name the same destination the same way. */}
          <section className="text-center py-12 border-t">
            <h2 className="text-2xl font-light tracking-[var(--tracking-title)] mb-4">
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
              destination has one name wherever it is linked. Only live
              competitors are listed here, as in the footer: /vs/blaze and
              /vs/airstack stay published for the searches that land on them,
              but neither service takes customers any more (2026-08-22), and
              a live page should send readers to live comparisons. */}
          <nav className="py-8 border-t" aria-label="Related comparisons">
            <h2 className="text-lg font-semibold mb-4">Related comparisons</h2>
            <ul className="flex flex-wrap gap-4 text-sm">
              <li>
                <Button asChild variant="link" size="inline">
                  <Link href="/vs/cookie3">vs Cookie3</Link>
                </Button>
              </li>
              <li>
                <Button asChild variant="link" size="inline">
                  <Link href="/vs/holder">vs Holder</Link>
                </Button>
              </li>
              <li>
                <Button asChild variant="link" size="inline">
                  <Link href="/vs/formo">vs Formo</Link>
                </Button>
              </li>
            </ul>
          </nav>
        </article>
      </PageShell>
    </>
  );
}
