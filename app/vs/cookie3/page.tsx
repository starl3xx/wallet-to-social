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
import {
  INDEXED_WALLETS,
  KNOWN_AGENTS,
  KNOWN_AGENTS_SHORT,
} from '@/lib/public-figures';
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
    'Cookie3 caps X to wallet matching at 10,000 accounts on every tier you can buy. Compare it with a dedicated wallet-to-social lookup priced once.',
  keywords: [
    'Cookie3 alternative',
    'Twitter wallet matching',
    'wallet to social',
    'web3 analytics',
    'crypto marketing',
  ],
  openGraph: {
    title: 'walletlink.social vs Cookie3: which is right for you?',
    description:
      'A marketing analytics suite that matches your first 10,000 accounts, or a wallet-to-social lookup that matches the whole list.',
    type: 'article',
    url: 'https://walletlink.social/vs/cookie3',
    siteName: 'walletlink.social',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'walletlink.social vs Cookie3 comparison',
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
  headline: 'walletlink.social vs Cookie3: which is right for you?',
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
        {/* The reading column constrains measure, not position: 68ch, on the
            shell's left edge like /check and the blog index. It was centred
            with `mx-auto`, which put the text on a different horizontal line
            from the pages a reader visits before and after it. */}
        <article className="max-w-[68ch]">
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
            {/* The lede: 300 at 18px with the lead tracking, in the muted token.
                `text-foreground/80` was an opacity wash standing in for the
                token that already means "secondary text". */}
            <p className="max-w-[46ch] text-lg font-light leading-snug tracking-[var(--tracking-lead)] text-muted-foreground">
              Cookie3 includes wallet-to-X matching from $749 a month, and caps
              it at 10,000 accounts on every tier a person can buy.
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
                label="once, no subscription"
              />
            </dl>
          </header>

          <div className="mb-16">
            <ReachabilityClaim competitor="Cookie3" />
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
                      <span className="flex items-start gap-2">
                        <Check
                          alt="Yes"
                          role="img"
                          aria-label="Yes"
                          className="mt-0.5 h-4 w-4 flex-none text-attested"
                        />
                        <span className="text-xs text-muted-foreground">
                          (capped only by the matches you buy)
                        </span>
                      </span>
                    </td>
                    <td className="py-4 pl-4">
                      <span className="flex items-start gap-2">
                        <Check
                          alt="Yes"
                          role="img"
                          aria-label="Yes"
                          className="mt-0.5 h-4 w-4 flex-none text-attested"
                        />
                        <span className="text-xs text-muted-foreground">
                          (up to 10K accounts on Website, Basic and Growth
                          alike; unlimited on Enterprise only)
                        </span>
                      </span>
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Farcaster lookup</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <span className="flex items-start gap-2">
                        <Check
                          alt="Yes"
                          role="img"
                          aria-label="Yes"
                          className="mt-0.5 h-4 w-4 flex-none text-attested"
                        />
                        <span className="text-xs text-muted-foreground">
                          (complete coverage)
                        </span>
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
                      <span className="flex items-start gap-2">
                        <Check
                          alt="Yes"
                          role="img"
                          aria-label="Yes"
                          className="mt-0.5 h-4 w-4 flex-none text-attested"
                        />
                        <span className="text-xs text-muted-foreground">
                          ({FREE_MATCHES_PER_WINDOW} matches free every{' '}
                          {FREE_WINDOW_DAYS} days, no card)
                        </span>
                      </span>
                    </td>
                    <td className="py-4 pl-4">
                      <span className="flex items-start gap-2">
                        <X
                          alt="No"
                          role="img"
                          aria-label="No"
                          className="mt-0.5 h-4 w-4 flex-none text-muted-foreground"
                        />
                        <span className="text-xs text-muted-foreground">
                          (trial granted by a rep, no free tier)
                        </span>
                      </span>
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">
                      X handle still reaches somebody
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
                          (checked per record)
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
                    <td className="py-4 pr-4 font-medium">Agent detection</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <span className="flex items-start gap-2">
                        <Check
                          alt="Yes"
                          role="img"
                          aria-label="Yes"
                          className="mt-0.5 h-4 w-4 flex-none text-attested"
                        />
                        <span className="text-xs text-muted-foreground">
                          ({KNOWN_AGENTS_SHORT} agents)
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
                    <td className="py-4 pr-4 font-medium">
                      Website and campaign analytics
                    </td>
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
                    <td className="py-4 pr-4 font-medium">
                      Conversion tracking and audiences
                    </td>
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
            <p className="mt-4 text-xs text-muted-foreground">
              Cookie3 figures read from their plan table at cookie3.com/business
              on 20 August 2026. It sits partway down that page rather than at
              /pricing. Their prices may have moved since.
            </p>
          </section>

          {/* What is Cookie3 */}
          <section className="mb-12">
            <h2 className="text-2xl font-light tracking-[var(--tracking-title)] mb-4">
              What is Cookie3?
            </h2>
            <p className="text-muted-foreground mb-4">
              Cookie3 is a full web3 marketing analytics platform. It is a
              genuinely broad product, and most of it has no overlap with what
              we do:
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2 mb-4">
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
            <h2 className="text-2xl font-light tracking-[var(--tracking-title)] mb-4">
              What is walletlink.social?
            </h2>
            <p className="text-muted-foreground mb-4">
              One job, with no ceiling that money cannot lift. Upload a holder
              list, or paste a contract address, and get back:
            </p>
            <ol className="list-decimal pl-6 text-muted-foreground space-y-2 mb-4">
              <li>
                X handles and Farcaster profiles, with the class of evidence
                behind each match
              </li>
              <li>
                Whether the X handle still reaches a person, checked against X
                itself
              </li>
              <li>
                Agent detection across {KNOWN_AGENTS}+ known agents (Virtuals,
                ERC-8004, ElizaOS, Olas)
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
            <h2 className="text-2xl font-light tracking-[var(--tracking-title)] mb-4">
              Cookie3 is not Cookie.fun
            </h2>
            <p className="text-muted-foreground mb-4">
              The names cause real confusion, so: they are two products with two
              business models.
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2">
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
              wallet list to anybody. If you arrived looking for wallet-to-X
              matching on a price sheet, that is Cookie3, and this page is the
              comparison.
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
              <h3 className="font-semibold mb-4">Cookie3</h3>
              <p className="text-muted-foreground text-sm mb-3">
                Four subscription tiers. The annual figure in brackets is their
                20% annual discount, quoted as a monthly rate:
              </p>
              <ul className="list-disc pl-6 text-sm text-muted-foreground space-y-2">
                <li>
                  Website: $59 / month ($40 annual). Monthly wallet limit: 0.
                </li>
                <li>
                  Basic: $299 / month ($249 annual). 100K wallets, 5K enriched
                  exports.
                </li>
                <li>
                  Growth: $749 / month ($599 annual). 1M wallets, 100K enriched
                  exports. The cheapest tier where X matching is switched on.
                </li>
                <li>
                  Enterprise: quoted. The only tier without the 10K matching
                  cap.
                </li>
              </ul>
            </div>

            <div className="p-6 border rounded-lg bg-accent-brand-tint border-accent-brand">
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
            <h2 className="text-2xl font-light tracking-[var(--tracking-title)] mb-4">
              Better together
            </h2>
            <p className="text-muted-foreground mb-4">
              A team already paying for Cookie3 is not the team we are arguing
              with. The two fit end to end:
            </p>
            <ol className="list-decimal pl-6 text-muted-foreground space-y-2">
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
              Try walletlink.social free: {FREE_MATCHES_PER_WINDOW} matches in a
              rolling {FREE_WINDOW_DAYS}-day window, no card, no call.
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
