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

/**
 * This page used to live at `/vs/cookie` and compare against **Cookie.fun**,
 * which is not a competitor: it indexes AI agents and gates premium analytics
 * behind staking $COOKIE. The competitor is **Cookie3** (cookie3.com), a
 * separate fiat SaaS from the same orbit that sells wallet-to-Twitter matching
 * as a line item on a published price sheet. `/vs/cookie` now 308s here.
 *
 * ## Where these numbers come from
 *
 * Cookie3 publishes prices but does not make them easy to find: the nav
 * "Pricing" link is inert and /pricing 404s, so the table sits partway down
 * cookie3.com/business. Everything attributed to them below was read from that
 * table on 2026-08-20 and is dated in the copy, because a competitor's price
 * sheet is the one fact on a comparison page that goes stale without warning.
 *
 * ## The one claim this page is built on
 *
 * "Advertise: Twitter<>Wallet Matching" carries the same cap, up to 10,000
 * accounts, on Website, Basic and Growth alike. Paying more buys wallet volume
 * and export headroom, not more social matches. Only Enterprise, which is
 * unpriced, lifts it. That cap is the whole reason this page exists, so it is
 * stated once in the hero and once in the table and nowhere else.
 */
export const metadata: Metadata = {
  title: 'walletlink.social vs Cookie3: Comparison (2026)',
  description:
    'Cookie3 caps Twitter to wallet matching at 10,000 accounts on every tier you can buy. Compare it with a dedicated wallet-to-social lookup priced once.',
  keywords: [
    'Cookie3 alternative',
    'Twitter wallet matching',
    'wallet to social',
    'web3 analytics',
    'crypto marketing',
  ],
  openGraph: {
    title: 'walletlink.social vs Cookie3: Which is Right for You?',
    description:
      'A marketing analytics suite that matches your first 10,000 accounts, or a wallet-to-social lookup that matches the whole list.',
    type: 'article',
    url: 'https://walletlink.social/vs/cookie3',
    siteName: 'walletlink.social',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'walletlink.social vs Cookie3 Comparison',
    description:
      'Wallet-to-social lookups priced once, by the match, against a subscription analytics suite.',
  },
  alternates: {
    canonical: 'https://walletlink.social/vs/cookie3',
  },
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: 'walletlink.social vs Cookie3: Which is Right for You?',
  description:
    'Detailed comparison of a dedicated wallet-to-social lookup with Cookie3, a web3 marketing analytics suite. Compare the matching cap, pricing model and export limits.',
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
    '@id': 'https://walletlink.social/vs/cookie3',
  },
  datePublished: '2026-08-20',
  dateModified: new Date().toISOString().split('T')[0],
  keywords:
    'Cookie3 alternative, Twitter wallet matching, wallet to social, web3 analytics',
};

export default function Cookie3Comparison() {
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
              The whole list, not the first{' '}
              <em className="font-semibold not-italic text-accent-brand">
                10,000
              </em>
              .
            </h1>
            <p className="max-w-[46ch] text-lg font-light leading-snug text-foreground/80">
              Cookie3 includes wallet-to-Twitter matching from $749 a month, and
              caps it at 10,000 accounts on every tier a person can buy.
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
                label="once, no subscription"
              />
            </dl>
          </header>

          <div className="mb-16">
            <ReachabilityClaim competitor="Cookie3" />
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
                    <th className="text-left py-4 pl-4">Cookie3</th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Focus</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      Wallet → social, and nothing else
                    </td>
                    <td className="py-4 pl-4">
                      Web3 marketing analytics suite
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Input</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      Your wallet list (CSV or a contract address)
                    </td>
                    <td className="py-4 pl-4">
                      Site traffic, campaigns and imported wallets
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">
                      Wallet → X matching
                    </td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <Check className="h-4 w-4 text-accent-brand" />
                      <span className="text-xs text-muted-foreground ml-1">
                        (capped only by the matches you buy)
                      </span>
                    </td>
                    <td className="py-4 pl-4">
                      <Check className="h-4 w-4 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground ml-1">
                        (up to 10K accounts on Website, Basic and Growth alike;
                        unlimited on Enterprise only)
                      </span>
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Farcaster lookup</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <Check className="h-4 w-4 text-accent-brand" />
                      <span className="text-xs text-muted-foreground ml-1">
                        (complete coverage)
                      </span>
                    </td>
                    <td className="py-4 pl-4">
                      <span className="text-xs text-muted-foreground">
                        Not listed on their plan sheet
                      </span>
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">
                      Cheapest option with X matching
                    </td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <span className="font-semibold text-accent-brand">
                        ${PACKS.trial.priceCents / 100}
                      </span>{' '}
                      once
                    </td>
                    <td className="py-4 pl-4">
                      $749 / month (Growth), or $599 / month billed annually
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Pricing model</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      One-time payment, no renewal
                    </td>
                    <td className="py-4 pl-4">
                      Subscription, monthly / quarterly / annual
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">
                      Enriched wallet export
                    </td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      Every match, every pack
                    </td>
                    <td className="py-4 pl-4">
                      5K on Website and Basic, 100K on Growth
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Self-serve signup</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <Check className="h-4 w-4 text-accent-brand" />
                      <span className="text-xs text-muted-foreground ml-1">
                        ({FREE_MATCHES_PER_WINDOW} matches free every{' '}
                        {FREE_WINDOW_DAYS} days, no card)
                      </span>
                    </td>
                    <td className="py-4 pl-4">
                      <X className="h-4 w-4 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground ml-1">
                        (trial granted by a rep, no free tier)
                      </span>
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">
                      X handle still reaches somebody
                    </td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <Check className="h-4 w-4 text-accent-brand" />
                      <span className="text-xs text-muted-foreground ml-1">
                        (checked per record)
                      </span>
                    </td>
                    <td className="py-4 pl-4">
                      <X className="h-4 w-4 text-muted-foreground" />
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Agent detection</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <Check className="h-4 w-4 text-accent-brand" />
                      <span className="text-xs text-muted-foreground ml-1">
                        (13K+ agents)
                      </span>
                    </td>
                    <td className="py-4 pl-4">
                      <X className="h-4 w-4 text-muted-foreground" />
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">
                      Website and campaign analytics
                    </td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <X className="h-4 w-4 text-muted-foreground" />
                    </td>
                    <td className="py-4 pl-4">
                      <Check className="h-4 w-4 text-accent-brand" />
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">
                      Conversion tracking and audiences
                    </td>
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
            <p className="mt-4 text-xs text-muted-foreground">
              Cookie3 figures read from their plan table at cookie3.com/business
              on 20 August 2026. It sits partway down that page rather than at
              /pricing. Their prices may have moved since.
            </p>
          </section>

          {/* What is Cookie3 */}
          <section className="mb-12">
            <h2 className="text-2xl font-light tracking-[-0.028em] mb-4">
              What is Cookie3?
            </h2>
            <p className="text-muted-foreground mb-4">
              Cookie3 is a full web3 marketing analytics platform. It is a
              genuinely broad product, and most of it has no overlap with what
              we do:
            </p>
            <ul className="list-disc list-inside text-muted-foreground space-y-2 mb-4">
              <li>Website analytics and campaign tracking</li>
              <li>Onchain and offchain conversion events</li>
              <li>An onchain explorer, audiences and filters</li>
              <li>Token analytics, and wallet import up to 1M addresses</li>
              <li>
                One row, near the bottom of the sheet, called “Advertise:
                Twitter&lt;&gt;Wallet Matching”
              </li>
            </ul>
            <p className="text-muted-foreground">
              That last row is the only place the two products meet, and it is
              the row with a ceiling on it. Their own plan table marks it as “up
              to 10K accounts” on Website, Basic and Growth. Moving from $59 a
              month to $749 a month buys more wallet volume and a larger export,
              and leaves the matching cap exactly where it was. Lifting it means
              an Enterprise quote, which they do not publish.
            </p>
          </section>

          {/* What is walletlink.social */}
          <section className="mb-12">
            <h2 className="text-2xl font-light tracking-[-0.028em] mb-4">
              What is walletlink.social?
            </h2>
            <p className="text-muted-foreground mb-4">
              One job, with no ceiling that money cannot lift. Upload a holder
              list, or paste a contract address, and get back:
            </p>
            <ol className="list-decimal list-inside text-muted-foreground space-y-2 mb-4">
              <li>
                X handles and Farcaster profiles, with the class of evidence
                behind each match
              </li>
              <li>
                Whether the X handle still reaches a person, checked against X
                itself
              </li>
              <li>
                Agent detection across 13,000+ known agents (Virtuals, ERC-8004,
                ElizaOS, Olas)
              </li>
              <li>A CSV of the whole thing, on every pack</li>
            </ol>
            <p className="text-muted-foreground">
              Nothing is inferred or guessed, which means coverage is lower than
              a vendor willing to guess and every match can be defended. We
              return identity, not a way to message anybody.
            </p>
          </section>

          {/* Cookie3 is not Cookie.fun */}
          <section className="mb-12">
            <h2 className="text-2xl font-light tracking-[-0.028em] mb-4">
              Cookie3 is not Cookie.fun
            </h2>
            <p className="text-muted-foreground mb-4">
              The names cause real confusion, so: they are two products with two
              business models.
            </p>
            <ul className="list-disc list-inside text-muted-foreground space-y-2">
              <li>
                <strong className="text-foreground">Cookie3</strong>, at
                cookie3.com, is the subscription analytics suite compared above.
                It bills in dollars, and accepts crypto on quarterly and annual
                terms.
              </li>
              <li>
                <strong className="text-foreground">Cookie.fun</strong>, from
                Cookie DAO, is an AI agent index and attention layer. Its
                premium analytics are gated by staking 10,000 $COOKIE rather
                than by a subscription, so the cost moves with the token price
                and the tokens come back when you unstake.
              </li>
            </ul>
            <p className="text-muted-foreground mt-4">
              If you arrived looking for agent mindshare rankings and agent
              token data, that is Cookie.fun, and it does not resolve your
              wallet list to anybody. If you arrived looking for
              wallet-to-Twitter matching on a price sheet, that is Cookie3, and
              this page is the comparison.
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
                    <span>Your list is bigger than 10,000 wallets</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-accent-brand flex-shrink-0" />
                    <span>
                      You want the identity layer and not the analytics suite
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-accent-brand flex-shrink-0" />
                    <span>
                      You need to know which handles still reach a person
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-accent-brand flex-shrink-0" />
                    <span>
                      The work comes in bursts: a snapshot, a vote, an airdrop
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-accent-brand flex-shrink-0" />
                    <span>
                      You would rather pay once than carry a subscription
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-accent-brand flex-shrink-0" />
                    <span>
                      You want to start now, without talking to anybody
                    </span>
                  </li>
                </ul>
              </div>

              {/* Cookie3 */}
              <div className="border rounded-lg p-6">
                <h3 className="font-semibold mb-4">Choose Cookie3 if:</h3>
                <ul className="space-y-3 text-sm text-muted-foreground">
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                    <span>
                      You want website and campaign analytics in one place
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                    <span>
                      You are attributing onchain conversions to campaigns
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                    <span>
                      You want audiences and filters you can act on repeatedly
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                    <span>
                      A four-figure monthly line item is already approved
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                    <span>10,000 matched accounts is enough for your list</span>
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
              <h3 className="font-semibold mb-4">Cookie3</h3>
              <p className="text-muted-foreground text-sm mb-3">
                Four subscription tiers. The annual figure in brackets is their
                20% annual discount, quoted as a monthly rate:
              </p>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>
                  - Website: $59 / month ($40 annual). Monthly wallet limit: 0.
                </li>
                <li>
                  - Basic: $299 / month ($249 annual). 100K wallets, 5K enriched
                  exports.
                </li>
                <li>
                  - Growth: $749 / month ($599 annual). 1M wallets, 100K
                  enriched exports. The cheapest tier where Twitter matching is
                  switched on.
                </li>
                <li>
                  - Enterprise: quoted. The only tier without the 10K matching
                  cap.
                </li>
              </ul>
            </div>

            <div className="mt-6 p-4 border rounded-lg bg-accent-brand-tint border-accent-brand">
              <p className="text-sm">
                <span className="font-medium">What the money buys:</span> a year
                on Cookie3 Growth is $8,988, or $7,188 paid annually, for a
                suite whose matching stops at 10,000 accounts. Our largest pack
                is {`$${PACKS.index.priceCents / 100}`} once, for{' '}
                {PACKS.index.matches.toLocaleString()} matches, the matching
                alone, and nothing to renew; a bigger list is another pack, not
                an Enterprise quote. They are not the same purchase, and if you
                need the analytics suite the arithmetic does not favour us.
              </p>
            </div>
          </section>

          {/* Use them together */}
          <section className="mb-16">
            <h2 className="text-2xl font-light tracking-[-0.028em] mb-4">
              Better together
            </h2>
            <p className="text-muted-foreground mb-4">
              A team already paying for Cookie3 is not the team we are arguing
              with. The two fit end to end:
            </p>
            <ol className="list-decimal list-inside text-muted-foreground space-y-2">
              <li>
                Cookie3 attributes the campaign and tells you which wallets
                converted
              </li>
              <li>Export that wallet list</li>
              <li>
                Run it here for handles on all of it, past the 10,000 mark
              </li>
              <li>
                Drop the handles that no longer reach anybody, then go and talk
                to the rest
              </li>
            </ol>
          </section>

          {/* CTA */}
          <section className="text-center py-12 border-t">
            <h2 className="text-2xl font-light tracking-[-0.028em] mb-4">
              Ready to find your wallet holders?
            </h2>
            <p className="text-muted-foreground mb-6">
              Try walletlink.social free: {FREE_MATCHES_PER_WINDOW} matches
              every {FREE_WINDOW_DAYS} days, no card, no call.
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
