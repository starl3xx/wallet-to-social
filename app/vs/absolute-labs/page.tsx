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
import { INDEXED_WALLETS, CHAIN_COUNT_WORD } from '@/lib/public-figures';
import { ReachabilityClaim } from '@/components/ReachabilityClaim';
import { breadcrumbJsonLd } from '@/lib/breadcrumbs';

/**
 * Absolute Labs sells a Wallet Relationship Management platform: a web3 CRM
 * with marketing automation, audience building and campaign tooling, in the
 * same category as Addressable and Cookie3. Wallet identity is one capability
 * inside it rather than the product.
 *
 * Everything attributed to Absolute Labs was read from absolutelabs.io on
 * 2026-09-21 and is dated in the copy. The platform page describes the product
 * as an "AI-powered, Web3-driven customer engagement platform", offers
 * "600M+ Data-Rich Profiles" under its Acquire heading, and every call to
 * action on the site is "Get a Live Demo".
 *
 * Two things were checked rather than assumed, because both are the kind of
 * claim that ages badly:
 *
 * - **There is no public price.** absolutelabs.io/pricing returns the site's
 *   own 404 page, and no tier, seat price or minimum appears anywhere on the
 *   site. So this page says "no public price, demo only" and does not invent a
 *   range to compare against. That is a real difference worth naming and not a
 *   criticism: enterprise software is often sold this way.
 * - **The profile count is theirs, quoted as theirs.** 600M+ profiles is not
 *   comparable with the indexed-wallet figure and the page must not put them
 *   in the same column as if it were. A profile in a CRM is a record;
 *   what we count is a wallet carrying an identity its owner published. The
 *   copy says so rather than letting the larger number look like a loss.
 */

export const metadata: Metadata = {
  title: 'Absolute Labs alternative for wallet to social lookup',
  description:
    'Absolute Labs sells a web3 CRM with wallet identity inside it. walletlink.social sells the lookup on its own, priced per match, with no demo call. What each one is, checked September 2026.',
  keywords: [
    'absolute labs alternative',
    'wallet relationship management',
    'web3 CRM alternative',
    'wallet to social',
    'wallet to twitter',
  ],
  openGraph: {
    title: 'Absolute Labs alternative for wallet to social lookup',
    description:
      'A web3 CRM with identity inside it, against the lookup sold on its own. One takes a demo call, one takes a CSV.',
    type: 'article',
    url: 'https://walletlink.social/vs/absolute-labs',
    siteName: 'walletlink.social',
    // Not inherited: declaring an openGraph block drops the root segment's
    // opengraph-image file, and a comparison page exists to be posted.
    images: ['/opengraph-image'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Absolute Labs alternative for wallet to social lookup',
    description:
      'A web3 CRM with identity inside it, against the lookup sold on its own.',
    images: ['/twitter-image'],
  },
  alternates: {
    canonical: 'https://walletlink.social/vs/absolute-labs',
  },
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: 'Absolute Labs alternative for wallet to social lookup',
  description:
    'How Absolute Labs and walletlink.social differ: a wallet relationship management platform sold by demo, against a wallet-to-social lookup priced per match.',
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
    '@id': 'https://walletlink.social/vs/absolute-labs',
  },
  datePublished: '2026-09-21',
  // The file's last authored change, not the render date: a dateModified
  // taken from the clock tells a crawler every page changed today, on every
  // request. Move it when the copy moves.
  dateModified: '2026-09-21',
  keywords:
    'absolute labs alternative, wallet relationship management, web3 CRM, wallet to social',
};

const breadcrumbJson = breadcrumbJsonLd([
  { name: 'Comparisons', path: '/vs' },
  { name: 'vs Absolute Labs', path: '/vs/absolute-labs' },
]);

export default function AbsoluteLabsComparison() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJson) }}
      />
      <PageShell>
        <article className="max-w-[68ch]">
          <header className="mb-12">
            <h1 className="mb-4 max-w-[19ch] text-4xl font-extralight leading-[1.02] tracking-[var(--tracking-display)] sm:text-5xl">
              A platform, or{' '}
              <em className="font-semibold not-italic text-accent-brand">
                the answer
              </em>
              .
            </h1>
            <p className="max-w-[46ch] text-lg font-light leading-snug tracking-[var(--tracking-lead)] text-muted-foreground">
              Absolute Labs sells wallet relationship management, with identity
              as one part of it. We sell the identity lookup, and nothing else.
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <Button asChild>
                <Link href="/">
                  <MagnifyingGlass className="h-4 w-4" aria-hidden />
                  Run a lookup
                </Link>
              </Button>
              <Button asChild variant="soft">
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
                label="to start, no demo call"
              />
            </dl>
          </header>

          <div className="mb-16">
            <ReachabilityClaim competitor="Absolute Labs" undocumented />
          </div>

          <section className="mb-12">
            <h2 className="text-2xl font-light tracking-[var(--tracking-title)] mb-4">
              What Absolute Labs is
            </h2>
            <p className="text-muted-foreground mb-4">
              Absolute Labs sells a Wallet Relationship Management platform,
              which its own site describes as an AI-powered, web3-driven
              customer engagement platform. Read on 2026-09-21, the pitch is a
              full marketing stack: build audiences by wallet type, behavioral
              trigger and interest, run cross-chain and cross-channel campaigns,
              bridge web2 and web3 data, and hold it all in one place instead of
              a CRM plus a data warehouse plus a campaign tool.
            </p>
            <p className="text-muted-foreground mb-4">
              Its Acquire section offers access to more than 600 million
              data-rich profiles. That is their number for their product, and it
              is not the same quantity as the {INDEXED_WALLETS} wallets below. A
              profile in a CRM is a record about somebody. What we count is a
              wallet carrying a social account its owner published, which is a
              narrower thing and the only thing we sell.
            </p>
            <p className="text-muted-foreground">
              If you need the platform, buy the platform. This page exists for
              the case where you do not.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-light tracking-[var(--tracking-title)] mb-4">
              One takes a demo call, one takes a CSV
            </h2>
            <p className="text-muted-foreground mb-4">
              Checked 2026-09-21: Absolute Labs publishes no price.
              absolutelabs.io/pricing returns the site’s own “page not found”,
              and no tier, seat price or contract minimum appears anywhere else
              on the site. Every call to action is “Get a Live Demo”.
            </p>
            <p className="text-muted-foreground mb-4">
              That is how enterprise software is often sold and it is not a
              criticism. It is a difference in what the next hour looks like. On
              that path the next step is a call, a scoping conversation and a
              quote. Here the next step is pasting addresses into a box.
            </p>
            <p className="text-muted-foreground">
              Your first {FREE_MATCHES_PER_WINDOW} matches are free every{' '}
              {FREE_WINDOW_DAYS} days with no card, the packs are one-time
              payments from ${PACKS.trial.priceCents / 100}, and a wallet that
              resolves to nothing is never billed.
            </p>
          </section>

          {/* The comparison table. A Check in a capability cell is green,
              whichever column it sits in: "has this" is a measured fact, and
              green is the color of one. A cross is muted. */}
          <section className="mb-16">
            <h2 className="text-2xl font-light tracking-[var(--tracking-title)] mb-6">
              Side by side
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-4 pr-4"></th>
                    <th className="text-left py-4 px-4 bg-accent-brand-tint rounded-tl-lg">
                      <span className="font-semibold">walletlink.social</span>
                    </th>
                    <th className="text-left py-4 pl-4">Absolute Labs</th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Sold as</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      Wallet → social only
                    </td>
                    <td className="py-4 pl-4">
                      Wallet relationship management platform
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
                    <td className="py-4 pl-4">
                      No public price, demo only (checked 2026-09-21)
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">
                      Start without talking to sales
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
                          ({FREE_MATCHES_PER_WINDOW} free matches, no card)
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
                    <td className="py-4 pr-4 font-medium">
                      Evidence behind each match
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
                          (attested or correlated, labeled on every row)
                        </span>
                      </span>
                    </td>
                    <td className="py-4 pl-4 text-muted-foreground">
                      Not documented publicly
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">
                      Is the handle still live
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
                          (live, suspended, unclaimed or reassigned)
                        </span>
                      </span>
                    </td>
                    <td className="py-4 pl-4 text-muted-foreground">
                      Not documented publicly
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
                    <td className="py-4 pl-4 text-muted-foreground">
                      Not named on the site
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
                          (every pack, on all {CHAIN_COUNT_WORD} supported
                          chains)
                        </span>
                      </span>
                    </td>
                    <td className="py-4 pl-4 text-muted-foreground">
                      Audience building inside the platform
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">
                      Campaigns and automation
                    </td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <span className="flex items-start gap-2">
                        <X
                          alt="No"
                          role="img"
                          aria-label="No"
                          className="mt-0.5 h-4 w-4 flex-none text-muted-foreground"
                        />
                        <span className="text-xs text-muted-foreground">
                          (export to the tools you already run)
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
                    <td className="py-4 pr-4 font-medium">API and MCP</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <span className="flex items-start gap-2">
                        <Check
                          alt="Yes"
                          role="img"
                          aria-label="Yes"
                          className="mt-0.5 h-4 w-4 flex-none text-attested"
                        />
                        <span className="text-xs text-muted-foreground">
                          (in every pack, plus an x402 rail for agents)
                        </span>
                      </span>
                    </td>
                    <td className="py-4 pl-4 text-muted-foreground">
                      Not documented publicly
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-light tracking-[var(--tracking-title)] mb-4">
              Which one you want
            </h2>
            <p className="text-muted-foreground mb-4">
              A platform is the right buy when the work is continuous: a team
              running segmented campaigns every week, against audiences that
              need to stay in sync, with reporting somebody reads. That is a
              real job and a lookup tool does not do it.
            </p>
            <p className="text-muted-foreground">
              This is the right buy when the work is a question. Who holds this
              token and can we reach them. Who showed up to the mint. Which of
              these 4,000 addresses is somebody with an audience. You want the
              answer, in a CSV, today, and you do not want to own a platform to
              get it.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-light tracking-[var(--tracking-title)] mb-4">
              What a lookup looks like
            </h2>
            <ol className="list-decimal pl-6 text-muted-foreground space-y-2 mb-4">
              <li>
                Paste addresses, upload a CSV, or give us a token or NFT
                contract and we pull the holders
              </li>
              <li>We match them against the identity index</li>
              <li>
                Export X handles and Farcaster profiles, ranked by holdings
                times reach
              </li>
              <li>Send it to an X list, or to whatever CRM you already run</li>
            </ol>
            <p className="text-muted-foreground">
              The index holds {INDEXED_WALLETS} wallets with complete Farcaster
              protocol coverage, refreshed daily. Over 99.8% of the X handles
              were published by the wallet owner themselves, and every match
              carries the evidence class behind it. Where we only have a
              correlation, the row says so.
            </p>
          </section>

          <section className="mb-16 space-y-6">
            <h2 className="text-2xl font-light tracking-[var(--tracking-title)]">
              Pricing
            </h2>

            <PackPricing />

            <div className="p-6 border rounded-lg bg-accent-brand-tint border-accent-brand">
              <p className="text-sm">
                <span className="font-medium">No contract to negotiate:</span>{' '}
                every pack is a one-time payment and every one includes API
                access. Credits last 12 months, and a wallet that resolves to
                nothing is never billed.
              </p>
            </div>
          </section>

          <section className="text-center py-12 border-t">
            <h2 className="text-2xl font-light tracking-[var(--tracking-title)] mb-4">
              Skip the demo call
            </h2>
            <p className="text-muted-foreground mb-6">
              Try walletlink.social free: {FREE_MATCHES_PER_WINDOW} matches in a
              rolling {FREE_WINDOW_DAYS}-day window, no credit card required.
            </p>
            <Button asChild>
              <Link href="/">
                Run a lookup
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </Button>
          </section>

          {/* Related comparisons. Only live competitors are listed here, as in
              the footer: /vs/blaze and /vs/airstack stay published for the
              searches that land on them, but neither service takes customers
              any more (2026-08-22), and a live page should send readers to
              live comparisons. */}
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
              <li>
                <Button asChild variant="link" size="inline">
                  <Link href="/vs/nansen">vs Nansen</Link>
                </Button>
              </li>
            </ul>
          </nav>
        </article>
      </PageShell>
    </>
  );
}
