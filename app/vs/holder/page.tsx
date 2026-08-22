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
      'Holder sunset in June 2024. Migrate your holder outreach to walletlink.social: one-time pricing, X and Farcaster coverage.',
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
        {/* The reading column constrains measure, not position: 68ch, on the
            shell's left edge like /check and the blog index. It was centred
            with `mx-auto`, which put the text on a different horizontal line
            from the pages a reader visits before and after it. */}
        <article className="max-w-[68ch]">
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
            {/* The lede: 300 at 18px with the lead tracking, in the muted token.
                `text-foreground/80` was an opacity wash standing in for the
                token that already means "secondary text". */}
            <p className="max-w-[46ch] text-lg font-light leading-snug tracking-[var(--tracking-lead)] text-muted-foreground">
              Holder messages wallets. We resolve wallets to the accounts their
              owners actually read, so you can reach them anywhere.
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
            <ReachabilityClaim competitor="Holder" />
          </div>

          {/* What happened */}
          <section className="mb-12">
            <h2 className="text-2xl font-light tracking-[var(--tracking-title)] mb-4">
              What happened to Holder?
            </h2>
            <p className="text-muted-foreground mb-4">
              Holder was a web3 CRM built around wallets instead of email
              addresses. It let teams segment their token holders, enrich wallet
              records with identity data, and message holders through
              wallet-native channels. Its suite included:
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2 mb-4">
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

          {/* Migration table. A Check in a capability cell is green, whichever
              column it sits in: "has this" is a measured fact, and green is the
              colour of one. A cross is muted. Captioned cells put the glyph and
              its caption in one flex row; Tailwind's preflight makes svg
              `display: block`, so an icon followed by a span stacked on two
              lines with the caption indented 4px under the glyph. The cards further
              down are lists, not capability claims, and their check marks take
              the card's own text colour. */}
          <section className="mb-16">
            <h2 className="text-2xl font-light tracking-[var(--tracking-title)] mb-6">
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
                      Wallet → social only
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
                      <span className="flex items-start gap-2">
                        <Check
                          alt="Yes"
                          role="img"
                          aria-label="Yes"
                          className="mt-0.5 h-4 w-4 flex-none text-attested"
                        />
                        <span className="text-xs text-muted-foreground">
                          (X + Farcaster)
                        </span>
                      </span>
                    </td>
                    <td className="py-4 pl-4 text-muted-foreground">
                      Offered, no longer available
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Farcaster</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <span className="flex items-start gap-2">
                        <Check
                          alt="Yes"
                          role="img"
                          aria-label="Yes"
                          className="mt-0.5 h-4 w-4 flex-none text-attested"
                        />
                        <span className="text-xs text-muted-foreground">
                          (complete protocol coverage)
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
                    <td className="py-4 pr-4 font-medium">Holder messaging</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <span className="flex items-start gap-2">
                        <X
                          alt="No"
                          role="img"
                          aria-label="No"
                          className="mt-0.5 h-4 w-4 flex-none text-muted-foreground"
                        />
                        <span className="text-xs text-muted-foreground">
                          (export an X list and reach them there)
                        </span>
                      </span>
                    </td>
                    <td className="py-4 pl-4 text-muted-foreground">
                      Was wallet messaging
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
                    <td className="py-4 pl-4 text-muted-foreground">
                      Was custom segments
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">CRM workflows</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <span className="flex items-start gap-2">
                        <X
                          alt="No"
                          role="img"
                          aria-label="No"
                          className="mt-0.5 h-4 w-4 flex-none text-muted-foreground"
                        />
                        <span className="text-xs text-muted-foreground">
                          (export to your own CRM)
                        </span>
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
            <h2 className="text-2xl font-light tracking-[var(--tracking-title)] mb-4">
              What is walletlink.social?
            </h2>
            <p className="text-muted-foreground mb-4">
              We do one thing: turn wallet addresses into social profiles. No
              CRM, no campaign builder. Just:
            </p>
            <ol className="list-decimal pl-6 text-muted-foreground space-y-2 mb-4">
              <li>Upload your CSV of wallet addresses</li>
              <li>We match them against our identity index</li>
              <li>Export X handles and Farcaster profiles</li>
              <li>Save lookups, and grow them with new addresses</li>
            </ol>
            <p className="text-muted-foreground">
              Lookups are backed by an index of {INDEXED_WALLETS} wallets with
              complete Farcaster protocol coverage, refreshed daily. Over 99.9%
              of X matches are user-attested (links the wallet owner created
              themselves, such as a verified Farcaster account or an onchain ENS
              record), and every match carries the evidence behind it. Export
              the results into any CRM you already use.
            </p>
          </section>

          {/* Migrating from Holder */}
          <section className="mb-16">
            <h2 className="text-2xl font-light tracking-[var(--tracking-title)] mb-6">
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
            <h2 className="text-2xl font-light tracking-[var(--tracking-title)]">
              Pricing after Holder
            </h2>

            <PackPricing />

            <div className="p-6 border rounded-lg bg-accent-brand-tint border-accent-brand">
              <p className="text-sm">
                <span className="font-medium">No subscription to replace:</span>{' '}
                every pack is a one-time payment, and every one includes API
                access. Pay once, keep your holder data workflow forever.
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
                  <Link href="/vs/addressable">vs Addressable</Link>
                </Button>
              </li>
              <li>
                <Button asChild variant="link" size="inline">
                  <Link href="/vs/cookie3">vs Cookie3</Link>
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
