import type { Metadata } from 'next';
import Link from 'next/link';
import { PageShell } from '@/components/ui/page-shell';
import { PackPricing } from '@/components/PackPricing';
import {
  PACKS,
  PACK_IDS,
  MEASURED_MATCH_RATE,
  CREDIT_LIFETIME_DAYS,
  FREE_MATCHES_PER_WINDOW,
  FREE_WINDOW_DAYS,
} from '@/lib/packs';
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
 * Formo (formo.so) is a product-analytics and attribution platform for DeFi
 * apps, not a wallet-to-social lookup. The overlap is one feature inside it:
 * each wallet profile carries social handles, and Import Wallets profiles a
 * list you upload. So this page compares two different purchases, and the
 * copy says so rather than tallying features.
 *
 * Everything attributed to Formo was read from formo.so/pricing and
 * docs.formo.so on 2026-08-22 and is dated in the copy. The yearly prices sit
 * in the server-rendered page; the monthly ones ($249 and $499) come from the
 * billing toggle, which renders client-side, and 20% off each gives the yearly
 * figure, matching the page's "Save 20%" badge. Their pricing page disagrees
 * with itself twice (Ask AI is ticked on Growth in the table and listed as a
 * Scale add-on on the card; the FAQ says events are unlimited on every plan
 * while the table caps Growth at 500,000). No claim here depends on either.
 *
 * The worked example is a 10,000-wallet list, computed from the constants
 * rather than typed, so a pack or rate change moves the page.
 * `MEASURED_MATCH_RATE` is a display estimate and never bills anyone.
 */
export const metadata: Metadata = {
  title: 'walletlink.social vs Formo: Comparison (2026)',
  description:
    'Formo is an analytics and attribution platform for DeFi apps with wallet profiles inside it. Compare it with a dedicated wallet-to-social lookup priced once per match.',
  keywords: [
    'Formo alternative',
    'wallet profiles',
    'wallet to social',
    'DeFi analytics',
    'crypto marketing',
  ],
  openGraph: {
    title: 'walletlink.social vs Formo: which is right for you?',
    description:
      'A system of record for the users of your own app, or a lookup that takes a wallet list and returns the X and Farcaster accounts behind it.',
    type: 'article',
    url: 'https://walletlink.social/vs/formo',
    siteName: 'walletlink.social',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'walletlink.social vs Formo comparison',
    description:
      'Wallet-to-social lookups priced once, by the match, against a DeFi analytics subscription with wallet profiles inside it.',
  },
  alternates: {
    canonical: 'https://walletlink.social/vs/formo',
  },
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: 'walletlink.social vs Formo: which is right for you?',
  description:
    'Detailed comparison of a dedicated wallet-to-social lookup with Formo, a product-analytics and attribution platform for DeFi apps. Compare the wallet import, the pricing model and what each returns for a list.',
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
    '@id': 'https://walletlink.social/vs/formo',
  },
  datePublished: '2026-08-22',
  dateModified: new Date().toISOString().split('T')[0],
  keywords:
    'Formo alternative, wallet profiles, wallet to social, DeFi analytics',
};

/* Formo's prices, read from formo.so/pricing on 2026-08-22. Named once here so
   the worked example below is arithmetic on them rather than a retyped total. */
const FORMO_SCALE_MONTHLY_BILLED_YEARLY = 399;
const FORMO_SCALE_MONTHLY = 499;
const FORMO_X402_USDC_PER_REQUEST = 0.05;

/* The worked example: one list, three ways to pay for it. */
const LIST_SIZE = 10_000;
const EXPECTED_MATCHES = Math.round(LIST_SIZE * MEASURED_MATCH_RATE);
const MATCH_RATE_PERCENT = (MEASURED_MATCH_RATE * 100).toFixed(1);
const COVERING_PACK =
  PACK_IDS.map((id) => PACKS[id]).find((p) => p.matches >= EXPECTED_MATCHES) ??
  PACKS.index;
const FORMO_SCALE_YEAR = FORMO_SCALE_MONTHLY_BILLED_YEARLY * 12;
const FORMO_X402_LIST = LIST_SIZE * FORMO_X402_USDC_PER_REQUEST;

const num = (n: number) => n.toLocaleString('en-US');
const usd = (n: number) => `$${num(n)}`;

export default function FormoComparison() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <PageShell>
        {/* The reading column constrains measure, not position: 68ch, on the
            shell's left edge like /check and the blog index. */}
        <article className="max-w-[68ch]">
          <header className="mb-12">
            {/* The emphasis span is the type system's one device: a 600-weight
                word inside a 200-weight line. Both cuts are already loaded. */}
            <h1 className="mb-4 max-w-[17ch] text-4xl font-extralight leading-[1.02] tracking-[var(--tracking-display)] sm:text-5xl">
              A list in, the{' '}
              <em className="font-semibold not-italic text-accent-brand">
                people
              </em>{' '}
              out.
            </h1>
            {/* The lede: 300 at 18px with the lead tracking, in the muted token. */}
            <p className="max-w-[46ch] text-lg font-light leading-snug tracking-[var(--tracking-lead)] text-muted-foreground">
              Formo is a system of record for the users of your own DeFi app. We
              take a wallet list you already have and return the X and Farcaster
              accounts behind it, paid once per match.
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

            {/* The proof row closes the hero: four figures, the two measured
                ones marked green. `items-start` because Figure is a
                `flex-col-reverse` column and packs to the bottom of a cell. */}
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
            <ReachabilityClaim competitor="Formo" undocumented />
          </div>

          {/* Quick comparison. A Check in a capability cell is green, whichever
              column it sits in: "has this" is a measured fact. A cross is muted.
              Captioned cells put glyph and caption in one flex row, because
              Tailwind's preflight makes svg `display: block`. */}
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
                    <th className="text-left py-4 pl-4">Formo</th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Focus</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      Wallet → social, and nothing else
                    </td>
                    <td className="py-4 pl-4">
                      Analytics and attribution for DeFi apps; a system of
                      record for your own users
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">
                      Wallet list → X and Farcaster
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
                          (a CSV or a contract address, on every pack)
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
                          (Import Wallets: a CSV with one address per row,
                          profiled with X and Farcaster among more than a dozen
                          identity fields; Scale and Enterprise; no per-import
                          cap published)
                        </span>
                      </span>
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">
                      Cheapest paid route to profile {num(LIST_SIZE)} wallets
                    </td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <span className="font-semibold text-accent-brand">
                        {usd(COVERING_PACK.priceCents / 100)}
                      </span>{' '}
                      once, for the matches it returns
                    </td>
                    <td className="py-4 pl-4">
                      {usd(FORMO_SCALE_MONTHLY)} for one month of Scale, or{' '}
                      {usd(FORMO_X402_LIST)} over x402 at{' '}
                      {usd(FORMO_X402_USDC_PER_REQUEST)} per address
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
                      <span className="flex items-start gap-2">
                        <X
                          alt="Not documented"
                          role="img"
                          aria-label="Not documented"
                          className="mt-0.5 h-4 w-4 flex-none text-muted-foreground"
                        />
                        <span className="text-xs text-muted-foreground">
                          (nothing in Formo’s docs says so)
                        </span>
                      </span>
                    </td>
                  </tr>
                  {/* Their MCP server sits behind Scale, which is the second
                      of three plans. Ours is on every pack, including the free
                      allowance, because it carries the same key and draws the
                      same credits as the API it wraps. */}
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">
                      MCP server for agents
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
                          (five tools, on every pack and the free allowance)
                        </span>
                      </span>
                    </td>
                    <td className="py-4 pl-4">
                      <span className="text-xs text-muted-foreground">
                        Scale and up, {usd(FORMO_SCALE_MONTHLY_BILLED_YEARLY)} a
                        month billed yearly
                      </span>
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">
                      Funnels, attribution, forms
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
              Formo figures read from formo.so/pricing and docs.formo.so on
              2026-08-22. The monthly prices come from the billing toggle on
              that page; the yearly ones are 20% lower. Their prices may have
              moved since.
            </p>
          </section>

          {/* What is Formo, and where it overlaps */}
          <section className="mb-12">
            <h2 className="text-2xl font-light tracking-[var(--tracking-title)] mb-4">
              What is Formo?
            </h2>
            <p className="text-muted-foreground mb-4">
              Formo describes itself as analytics and attribution for DeFi, and
              as the system of record for crypto apps. It is built for the
              product, growth and data teams at a protocol, and most of it has
              no overlap with what we do: an SDK that records visits, wallet
              connects and transactions in your own app; funnels, retention,
              attribution, audiences and alerts; token-gated forms and waitlists
              that can verify a responder’s X, Discord, Farcaster or Lens
              account; and a wallet profile for each user, with net worth,
              positions, labels and social handles.
            </p>
            <p className="text-muted-foreground mb-4">
              That profile is where the two products meet. It carries X and
              Farcaster beside more than a dozen other identity fields, and
              Formo says it resolves identities from ENS and other sources. Two
              routes into it take a wallet that never touched your app:
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2 mb-4">
              <li>
                <strong className="text-foreground">Import Wallets.</strong> A
                CSV with one address per row, or an API call with an address
                array, adds the wallets to your user list and profiles them. It
                needs the Scale plan or above, and the docs publish neither a
                per-import cap nor a match rate.
              </li>
              <li>
                <strong className="text-foreground">
                  One address at a time.
                </strong>{' '}
                The single-profile endpoint is sold per request over x402 on
                Base at {num(FORMO_X402_USDC_PER_REQUEST)} USDC each, with no
                account. The request is paid whether or not the address resolves
                to anybody.
              </li>
            </ul>
            <p className="text-muted-foreground">
              Both are real, and a team already on Scale should use them. That
              team is not the one we are arguing with: Formo exports any segment
              as a CSV, a CSV is our input, and a run here says which of those X
              handles still reach a person before the campaign goes out. The
              question this page answers is what a list costs when the list is
              the whole job.
            </p>
          </section>

          {/* The arithmetic. One inset panel, the same surface PackPricing uses,
              with the sums shown rather than their results. Every number is
              computed from a constant: ours from lib/packs.ts, theirs from the
              dated constants at the top of this file. */}
          <section className="mb-16">
            <h2 className="text-2xl font-light tracking-[var(--tracking-title)] mb-4">
              One list, three ways to pay for it
            </h2>
            <p className="text-muted-foreground mb-6">
              Take a list of {num(LIST_SIZE)} wallets you already hold, and
              price the X and Farcaster accounts behind it. Formo figures read
              on 2026-08-22.
            </p>
            <div className="rounded-lg border border-border bg-muted p-6">
              <dl className="space-y-4 text-sm">
                <div>
                  <dt className="font-medium">Formo Scale</dt>
                  <dd className="text-muted-foreground">
                    {usd(FORMO_SCALE_MONTHLY_BILLED_YEARLY)} × 12 ={' '}
                    <span className="font-semibold text-foreground tabular-nums">
                      {usd(FORMO_SCALE_YEAR)}
                    </span>{' '}
                    for the year billed yearly, or{' '}
                    <span className="font-semibold text-foreground tabular-nums">
                      {usd(FORMO_SCALE_MONTHLY)}
                    </span>{' '}
                    for one month at the monthly rate, with the analytics suite
                    and a 10,000 monthly active user cap alongside
                  </dd>
                </div>
                <div>
                  <dt className="font-medium">Formo over x402</dt>
                  <dd className="text-muted-foreground">
                    {num(LIST_SIZE)} × {usd(FORMO_X402_USDC_PER_REQUEST)} ={' '}
                    <span className="font-semibold text-foreground tabular-nums">
                      {usd(FORMO_X402_LIST)}
                    </span>
                    , one request per address, paid whether or not it resolves
                  </dd>
                </div>
                <div>
                  <dt className="font-medium">walletlink.social</dt>
                  <dd className="text-muted-foreground">
                    {num(LIST_SIZE)} × {MATCH_RATE_PERCENT}% ≈{' '}
                    <span className="font-semibold text-foreground tabular-nums">
                      {num(EXPECTED_MATCHES)} matches
                    </span>{' '}
                    at the measured rate, which our {COVERING_PACK.name} pack
                    covers:{' '}
                    <span className="font-semibold text-foreground tabular-nums">
                      {usd(COVERING_PACK.priceCents / 100)}
                    </span>{' '}
                    once for {num(COVERING_PACK.matches)} matches, leaving{' '}
                    {num(COVERING_PACK.matches - EXPECTED_MATCHES)} for the next
                    list, good for {CREDIT_LIFETIME_DAYS} days
                  </dd>
                </div>
              </dl>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              The {MATCH_RATE_PERCENT}% is a measured average used to size a
              pack, not a promise. Your list will land above or below it, and
              the bill follows the matches it actually returns: a wallet we
              cannot resolve costs nothing.
            </p>
          </section>

          {/* What is walletlink.social */}
          <section className="mb-12">
            <h2 className="text-2xl font-light tracking-[var(--tracking-title)] mb-4">
              What is walletlink.social?
            </h2>
            <p className="text-muted-foreground mb-4">
              One job, with nothing to install in your app. Upload a holder
              list, or paste a contract address, and get back:
            </p>
            <ol className="list-decimal pl-6 text-muted-foreground space-y-2 mb-4">
              <li>
                X handles and Farcaster profiles, with the class of evidence
                behind each match shown on the row
              </li>
              <li>
                Whether the X handle still reaches a person, checked against X
                itself
              </li>
              <li>A CSV of the whole thing, on every pack</li>
            </ol>
            <p className="text-muted-foreground">
              Nothing is inferred or guessed, so every match can be defended. We
              return identity, not analytics about what the person did next.
            </p>
          </section>

          {/* When to choose each. Formo's card is not padded out to match ours:
              a DeFi app with its own users has real reasons to buy it. */}
          <section className="mb-16">
            <h2 className="text-2xl font-light tracking-[var(--tracking-title)] mb-6">
              When to choose each
            </h2>

            <div className="grid md:grid-cols-2 gap-6">
              <div className="border rounded-lg p-6 bg-accent-brand-tint border-accent-brand">
                <h3 className="font-semibold mb-4 text-accent-brand">
                  Choose walletlink.social if:
                </h3>
                <ul className="space-y-3 text-sm">
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-accent-brand flex-shrink-0" />
                    <span>
                      You already have the list and need the people behind it
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-accent-brand flex-shrink-0" />
                    <span>You want to pay once, for matches, and be done</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-accent-brand flex-shrink-0" />
                    <span>
                      You need each X handle checked for reachability, and the
                      attestation behind each match shown on its row
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-accent-brand flex-shrink-0" />
                    <span>You want Farcaster coverage that is complete</span>
                  </li>
                </ul>
              </div>

              <div className="border rounded-lg p-6">
                <h3 className="font-semibold mb-4">Choose Formo if:</h3>
                <ul className="space-y-3 text-sm text-muted-foreground">
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                    <span>
                      You run a DeFi app and want funnels, attribution and
                      retention over your own users
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                    <span>
                      You want a wallet-level profile of each of those users,
                      kept as a system of record
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                    <span>You want token-gated forms and waitlists</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                    <span>
                      Your users are on Solana, or spread across the major EVM
                      chains
                    </span>
                  </li>
                </ul>
              </div>
            </div>
          </section>

          {/* Pricing comparison. The section owns the rhythm: space-y-6 separates
              the heading, the pack grid and the callouts, so the h2 carries no
              margin of its own and the callouts carry no mt. */}
          <section className="mb-16 space-y-6">
            <h2 className="text-2xl font-light tracking-[var(--tracking-title)]">
              Pricing breakdown
            </h2>

            <PackPricing />

            {/* The competitor's tier block takes the same inset surface as
                PackPricing above it: `bg-muted` at full opacity behind the one
                hairline, one panel for one meaning. */}
            <div className="rounded-lg border border-border bg-muted p-6">
              <h3 className="font-semibold mb-4">Formo</h3>
              <p className="text-muted-foreground text-sm mb-3">
                Three plans metered in monthly active users, plus a
                pay-per-request route, read on 2026-08-22. The first figure is
                the monthly rate billed yearly; the bracketed one is billed
                monthly:
              </p>
              <ul className="list-disc pl-6 text-sm text-muted-foreground space-y-2">
                <li>
                  Growth: $199 / month ($249 monthly). Up to 5,000 monthly
                  active users. Wallet profiles with social handles are
                  included; Import Wallets and the Profiles API are not.
                </li>
                <li>
                  Scale: {usd(FORMO_SCALE_MONTHLY_BILLED_YEARLY)} / month (
                  {usd(FORMO_SCALE_MONTHLY)} monthly). Up to 10,000 monthly
                  active users. Adds the API, MCP, Import Wallets and Contract
                  Events. The cheapest plan that takes a wallet list.
                </li>
                <li>
                  Enterprise: quoted. Custom monthly active users, unlimited
                  events, volume discounts.
                </li>
                <li>
                  Pay per request: one profile for{' '}
                  {num(FORMO_X402_USDC_PER_REQUEST)} USDC over x402 on Base, no
                  account needed. One address per call.
                </li>
              </ul>
              <p className="text-muted-foreground text-sm mt-3">
                Every new workspace gets a 7-day trial of all features. When it
                ends, data collection stops until a plan is bought.
              </p>
            </div>

            <div className="p-6 border rounded-lg bg-accent-brand-tint border-accent-brand">
              <p className="text-sm">
                <span className="font-medium">What the money buys:</span> a year
                on Formo Scale is {usd(FORMO_SCALE_YEAR)} for an analytics suite
                that happens to profile the wallets you import. Our{' '}
                {COVERING_PACK.name} pack is{' '}
                {usd(COVERING_PACK.priceCents / 100)} once, for{' '}
                {num(COVERING_PACK.matches)} matches, the identity alone, and
                nothing to renew. They are not the same purchase. If your app
                needs the analytics, the arithmetic does not favour us, and the
                profiles arrive with the subscription whether you compare them
                or not.
              </p>
            </div>
          </section>

          {/* Closing CTA. The Button primitive on a Link, the same as the hero,
              with the label the product uses for this action everywhere. */}
          <section className="text-center py-12 border-t">
            <h2 className="text-2xl font-light tracking-[var(--tracking-title)] mb-4">
              Ready to find your wallet holders?
            </h2>
            <p className="text-muted-foreground mb-6">
              Try walletlink.social free: {FREE_MATCHES_PER_WINDOW} matches in a
              rolling {FREE_WINDOW_DAYS}-day window, no card, nothing to
              install.
            </p>
            <Button asChild>
              <Link href="/">
                Run a lookup
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </Button>
          </section>

          {/* Related comparisons. Each link is the `link` variant at `inline`
              size, the one treatment for a text link in a list or a sentence.
              Only the live competitors, matching the footer's Compare column. */}
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
                  <Link href="/vs/cookie3">vs Cookie3</Link>
                </Button>
              </li>
            </ul>
          </nav>
        </article>
      </PageShell>
    </>
  );
}
