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
 * Nansen is wallet intelligence for traders and funds, not a wallet-to-social
 * lookup. It is on this list because it owns the search a person types when
 * they want to know something about a wallet, and because the two products
 * answer questions that sound identical and are not: Nansen answers "what
 * does this wallet do", we answer "who published this wallet, and can you
 * still reach them".
 *
 * Everything attributed to Nansen was read on 2026-09-21 and is dated in the
 * copy. Pricing comes from nansen.ai/plans, whose own heading is "All of
 * Nansen. One simple plan." and which offers exactly two tiers: Free at $0 and
 * Pro at $49 monthly, shown as $588 yearly on the yearly toggle.
 *
 * The decisive claim on this page is the endpoint list, not the price. The
 * Profiler API's own index at docs.nansen.ai/api/profiler names every address
 * endpoint Nansen sells: current balances, historical balances, DEX trades,
 * transactions, counterparties, counterparties batch, related wallets, first
 * funder, PnL and trade performance, labels, perp positions, perp trades,
 * Hyperliquid leaderboard, Hyperliquid PnL. There is no social endpoint in
 * that list. The labels endpoint documents its own contents as "ENS domains,
 * behavioral labels, DeFi labels, CEX labels, and more", with smart money and
 * alpha trader held back as premium labels, so ENS is the only identity in
 * it, and an ENS name is not an account anyone reads.
 *
 * That is why this page compares scope rather than tallying features, and why
 * it never claims Nansen is worse at what Nansen does.
 */

export const metadata: Metadata = {
  title: 'Nansen alternative for wallet to social lookup',
  description:
    'Nansen tells you what a wallet does. walletlink.social tells you who published it and whether you can still reach them on X or Farcaster. What each one actually returns, checked September 2026.',
  keywords: [
    'nansen alternative',
    'nansen wallet labels',
    'wallet to twitter',
    'wallet to social',
    'onchain audience',
  ],
  openGraph: {
    title: 'Nansen alternative for wallet to social lookup',
    description:
      'Nansen answers what a wallet does. We answer who is behind it, and whether the account still reaches a person.',
    type: 'article',
    url: 'https://walletlink.social/vs/nansen',
    siteName: 'walletlink.social',
    // Not inherited: declaring an openGraph block drops the root segment's
    // opengraph-image file, and a comparison page exists to be posted.
    images: ['/opengraph-image'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Nansen alternative for wallet to social lookup',
    description:
      'Nansen answers what a wallet does. We answer who is behind it.',
    images: ['/twitter-image'],
  },
  alternates: {
    canonical: 'https://walletlink.social/vs/nansen',
  },
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: 'Nansen alternative for wallet to social lookup',
  description:
    'How Nansen and walletlink.social differ: wallet behavior and labels against owner-published social accounts with reachability checked.',
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
    '@id': 'https://walletlink.social/vs/nansen',
  },
  datePublished: '2026-09-21',
  // The file's last authored change (`git log -1 -- app/vs/nansen/page.tsx`),
  // not the render date: a dateModified taken from the clock tells a crawler
  // every page changed today, on every request. Move it when the copy moves.
  dateModified: '2026-09-21',
  keywords: 'nansen alternative, wallet labels, wallet to twitter, onchain',
};

const breadcrumbJson = breadcrumbJsonLd([
  { name: 'Comparisons', path: '/vs' },
  { name: 'vs Nansen', path: '/vs/nansen' },
]);

export default function NansenComparison() {
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
              What it does, or{' '}
              <em className="font-semibold not-italic text-accent-brand">
                who it is
              </em>
              .
            </h1>
            <p className="max-w-[46ch] text-lg font-light leading-snug tracking-[var(--tracking-lead)] text-muted-foreground">
              Nansen reads a wallet’s behavior. We read what its owner
              published, and check whether the account still reaches a person.
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
                label="to start, no subscription"
              />
            </dl>
          </header>

          <div className="mb-16">
            <ReachabilityClaim competitor="Nansen" undocumented />
          </div>

          <section className="mb-12">
            <h2 className="text-2xl font-light tracking-[var(--tracking-title)] mb-4">
              These are two different purchases
            </h2>
            <p className="text-muted-foreground mb-4">
              Nansen is wallet intelligence, sold to traders, funds and research
              teams. It answers questions about behavior: what this address
              holds, what it traded, who funded it first, which wallets move
              alongside it, and whether its pattern matches a cohort Nansen has
              named. That is a good product and this page is not an argument
              that it is a bad one.
            </p>
            <p className="text-muted-foreground mb-4">
              It is an argument that it answers a different question. We sell
              one thing: the X handle and the Farcaster account the owner of an
              address published, with the evidence behind each match and a state
              saying whether the handle still reaches anybody.
            </p>
            <p className="text-muted-foreground">
              The difference shows up in the endpoint list rather than in any
              marketing claim. Read on 2026-09-21, the Nansen Profiler API sells
              fourteen address endpoints: balances, historical balances, DEX
              trades, transactions, counterparties, counterparties in batch,
              related wallets, first funder, PnL and trade performance, labels,
              perp positions, perp trades, and two Hyperliquid endpoints. None
              of them returns a social account.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-light tracking-[var(--tracking-title)] mb-4">
              A label is not an identity
            </h2>
            <p className="text-muted-foreground mb-4">
              Nansen’s labels endpoint documents its own contents: ENS domains,
              behavioral labels, DeFi labels, CEX labels and more, with the
              smart money and alpha trader labels held back as premium. Checked
              2026-09-21.
            </p>
            <p className="text-muted-foreground mb-4">
              Every one of those except ENS is a classification Nansen made. It
              is Nansen saying this address behaves like a fund, or like a
              trader worth watching, which is exactly what a trader wants and is
              not something the wallet’s owner ever said. And an ENS name is a
              name, not an account: knowing an address is{' '}
              <code className="text-xs">vitalik.eth</code> does not give you
              somewhere to send a message.
            </p>
            <p className="text-muted-foreground">
              A match here is the opposite kind of fact. Over 99.8% of the X
              handles we return were published by the wallet owner themselves,
              through a Farcaster verification, an onchain ENS text record, an
              attested social sign-in or a manually verified record, and every
              match carries the evidence class that produced it. Nothing is
              inferred from a display name or a bio. Where we only have a
              correlation, the row says so.
            </p>
          </section>

          {/* The comparison table. A Check in a capability cell is green,
              whichever column it sits in: "has this" is a measured fact, and
              green is the color of one. A cross is muted. */}
          <section className="mb-16">
            <h2 className="text-2xl font-light tracking-[var(--tracking-title)] mb-6">
              What each one returns
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-4 pr-4"></th>
                    <th className="text-left py-4 px-4 bg-accent-brand-tint rounded-tl-lg">
                      <span className="font-semibold">walletlink.social</span>
                    </th>
                    <th className="text-left py-4 pl-4">Nansen</th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Sold as</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      Wallet → social only
                    </td>
                    <td className="py-4 pl-4">
                      Wallet intelligence for traders and funds
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">
                      X handle for a wallet
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
                          (attested, with the evidence class)
                        </span>
                      </span>
                    </td>
                    <td className="py-4 pl-4 text-muted-foreground">
                      <span className="flex items-start gap-2">
                        <X
                          alt="No"
                          role="img"
                          aria-label="No"
                          className="mt-0.5 h-4 w-4 flex-none text-muted-foreground"
                        />
                        <span className="text-xs">
                          (no social endpoint, checked 2026-09-21)
                        </span>
                      </span>
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Farcaster account</td>
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
                      Not applicable, no handle is returned
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">
                      Trading history and PnL
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
                          (a block explorer’s job, and Nansen’s)
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
                    <td className="py-4 pr-4 font-medium">Behavioral labels</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <span className="flex items-start gap-2">
                        <X
                          alt="No"
                          role="img"
                          aria-label="No"
                          className="mt-0.5 h-4 w-4 flex-none text-muted-foreground"
                        />
                        <span className="text-xs text-muted-foreground">
                          (we publish what owners said, not what we inferred)
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
                      Token holder views, not an outreach export
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
                      Free, or Pro at $49 a month ($588 a year), read 2026-09-21
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-light tracking-[var(--tracking-title)] mb-4">
              When Nansen is the right tool
            </h2>
            <p className="text-muted-foreground mb-4">
              Buy Nansen when the question is about money. Which wallets are
              accumulating this token, what a fund’s book looks like, who funded
              an address first, which cohort a trader belongs to. None of that
              is what we sell and none of it is something we would do better.
            </p>
            <p className="text-muted-foreground">
              Buy this when the question is about people. You have a holder
              list, an airdrop cohort or a set of addresses from a campaign, and
              you need the accounts those owners actually read so you can reach
              them. That is one lookup here and is not on Nansen’s price list at
              any tier.
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
              protocol coverage, refreshed daily. A wallet that resolves to
              nothing costs nothing: billing is per address that matched, not
              per address submitted.
            </p>
          </section>

          <section className="mb-16 space-y-6">
            <h2 className="text-2xl font-light tracking-[var(--tracking-title)]">
              Pricing
            </h2>

            <PackPricing />

            <div className="p-6 border rounded-lg bg-accent-brand-tint border-accent-brand">
              <p className="text-sm">
                <span className="font-medium">Nothing recurring:</span> every
                pack is a one-time payment and every one includes API access.
                There is no seat, no tier to keep paying for, and what you
                export is yours to keep.
              </p>
            </div>
          </section>

          <section className="text-center py-12 border-t">
            <h2 className="text-2xl font-light tracking-[var(--tracking-title)] mb-4">
              Find out who is behind the wallets
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
                  <Link href="/vs/absolute-labs">vs Absolute Labs</Link>
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
