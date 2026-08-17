import type { Metadata } from 'next';
import Link from 'next/link';
import { PageShell } from '@/components/ui/page-shell';
import { Button } from '@/components/ui/button';
import { Figure } from '@/components/ui/figure';
import { TIER_PRICES } from '@/lib/access';
import { ArrowRight, BookOpenText, Check, MagnifyingGlass, X } from '@phosphor-icons/react/dist/ssr';

export const metadata: Metadata = {
  title: 'walletlink.social vs Cookie.fun: Comparison (2026)',
  description:
    'Compare walletlink.social and Cookie.fun for AI agent wallet detection. See how dedicated wallet-to-social lookups compare to an AI agent analytics platform.',
  keywords: ['Cookie.fun alternative', 'AI agent wallets', 'wallet to social', 'agent detection', 'crypto marketing'],
  openGraph: {
    title: 'walletlink.social vs Cookie.fun: Which is Right for You?',
    description:
      'Compare wallet-to-social lookup tools with AI agent analytics platforms. Different tools for different jobs.',
    type: 'article',
    url: 'https://walletlink.social/vs/cookie',
    siteName: 'walletlink.social',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'walletlink.social vs Cookie.fun Comparison',
    description: 'Wallet-to-social lookups with agent detection vs AI agent analytics platform.',
  },
  alternates: {
    canonical: 'https://walletlink.social/vs/cookie',
  },
};

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: 'walletlink.social vs Cookie.fun: Which is Right for You?',
  description:
    'Detailed comparison of wallet-to-social lookups with AI agent analytics for crypto teams. Compare features, pricing, and use cases.',
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
    '@id': 'https://walletlink.social/vs/cookie',
  },
  datePublished: '2025-01-01',
  dateModified: new Date().toISOString().split('T')[0],
  keywords: 'Cookie.fun alternative, AI agent wallets, wallet to social, agent detection',
};

export default function CookieComparison() {
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
              Identity, not{' '}
              <em className="font-semibold not-italic text-accent-brand">attention</em>.
            </h1>
            <p className="max-w-[46ch] text-lg font-light leading-snug text-foreground/80">
              Cookie scores what an account does. We tell you which wallet it is, so the score has someone attached to it.
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
                with the contactable one in brand because it is the number to act on
                and coverage carrying a green mark because it is the measured one. */}
            <dl className="mt-8 flex flex-wrap gap-x-10 gap-y-5 border-t border-border pt-5">
              <Figure value="5M" label="wallets indexed" />
              <Figure value="100%" label="Farcaster coverage" attested />
              <Figure value="13%" label="have an X or Farcaster account" brand />
              <Figure value={`$${TIER_PRICES.pro}`} label="once, no subscription" />
            </dl>
          </header>

          {/* Quick Summary */}
          <section className="mb-16">
            <h2 className="text-2xl font-light tracking-[-0.028em] mb-6">Quick comparison</h2>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-4 pr-4"></th>
                    <th className="text-left py-4 px-4 bg-accent-brand-tint rounded-tl-lg">
                      <span className="font-semibold">walletlink.social</span>
                    </th>
                    <th className="text-left py-4 pl-4">Cookie.fun</th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Focus</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      Wallet → Social + Agent detection
                    </td>
                    <td className="py-4 pl-4">AI agent analytics &amp; rankings</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Input</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      Your wallet list (CSV)
                    </td>
                    <td className="py-4 pl-4">Browse agent index</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Pricing</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <span className="font-semibold text-accent-brand">
                        ${TIER_PRICES.pro} - ${TIER_PRICES.unlimited}
                      </span>{' '}
                      one-time
                    </td>
                    <td className="py-4 pl-4">Free + premium (stake 10K $COOKIE)</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Agent detection</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <Check className="h-4 w-4 text-accent-brand" />
                      <span className="text-xs text-muted-foreground ml-1">(13K+ agents)</span>
                    </td>
                    <td className="py-4 pl-4">
                      <X className="h-4 w-4 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground ml-1">(tracks agents, doesn&apos;t detect in wallets)</span>
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Twitter/X lookup</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <Check className="h-4 w-4 text-accent-brand" />
                    </td>
                    <td className="py-4 pl-4">
                      <X className="h-4 w-4 text-muted-foreground" />
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Farcaster lookup</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <Check className="h-4 w-4 text-accent-brand" />
                    </td>
                    <td className="py-4 pl-4">
                      <X className="h-4 w-4 text-muted-foreground" />
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Agent mindshare rankings</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <X className="h-4 w-4 text-muted-foreground" />
                    </td>
                    <td className="py-4 pl-4">
                      <Check className="h-4 w-4 text-accent-brand" />
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Agent token analytics</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <X className="h-4 w-4 text-muted-foreground" />
                    </td>
                    <td className="py-4 pl-4">
                      <Check className="h-4 w-4 text-accent-brand" />
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Batch wallet processing</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <Check className="h-4 w-4 text-accent-brand" />
                      <span className="text-xs text-muted-foreground ml-1">(up to 50K+)</span>
                    </td>
                    <td className="py-4 pl-4">
                      <X className="h-4 w-4 text-muted-foreground" />
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">CSV export</td>
                    <td className="py-4 px-4 bg-accent-brand-tint">
                      <Check className="h-4 w-4 text-accent-brand" />
                    </td>
                    <td className="py-4 pl-4">
                      <X className="h-4 w-4 text-muted-foreground" />
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-4 pr-4 font-medium">Trading interface</td>
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

          {/* What is Cookie.fun */}
          <section className="mb-12">
            <h2 className="text-2xl font-light tracking-[-0.028em] mb-4">What is Cookie.fun?</h2>
            <p className="text-muted-foreground mb-4">
              Cookie.fun is a data layer and analytics platform for AI agents.
              It indexes agents across multiple frameworks and tracks their
              performance using onchain and social data:
            </p>
            <ul className="list-disc list-inside text-muted-foreground space-y-2 mb-4">
              <li>Mindshare rankings based on social engagement and sentiment</li>
              <li>Agent token market data (market cap, holder growth, impressions)</li>
              <li>Built-in trading interface for agent tokens</li>
              <li>Premium analytics via $COOKIE token staking</li>
            </ul>
            <p className="text-muted-foreground">
              Cookie.fun is great for researching and trading AI agent tokens.
              But it doesn&apos;t tell you which wallets in your holder list belong
              to AI agents, or resolve those wallets to social profiles.
            </p>
          </section>

          {/* What is walletlink.social */}
          <section className="mb-12">
            <h2 className="text-2xl font-light tracking-[-0.028em] mb-4">
              What is walletlink.social?
            </h2>
            <p className="text-muted-foreground mb-4">
              We turn wallet addresses into social profiles and flag AI agent
              wallets. Upload your holder list and get back:
            </p>
            <ol className="list-decimal list-inside text-muted-foreground space-y-2 mb-4">
              <li>Twitter handles and Farcaster profiles for human wallets</li>
              <li>Agent detection across 13,000+ known agents (Virtuals, ERC-8004, ElizaOS, Olas)</li>
              <li>Agent metadata: name, framework, and token symbol</li>
              <li>CSV export with all data for further analysis</li>
            </ol>
            <p className="text-muted-foreground">
              The key difference: we work with <em>your</em> wallet list. Instead of
              browsing an agent index, you upload your holders and we tell you which
              ones are bots, which are humans, and how to reach the humans.
            </p>
          </section>

          {/* When to choose each */}
          <section className="mb-16">
            <h2 className="text-2xl font-light tracking-[-0.028em] mb-6">When to choose each</h2>

            <div className="grid md:grid-cols-2 gap-6">
              {/* walletlink.social */}
              <div className="border rounded-lg p-6 bg-accent-brand-tint border-accent-brand">
                <h3 className="font-semibold mb-4 text-accent-brand">
                  Choose walletlink.social if:
                </h3>
                <ul className="space-y-3 text-sm">
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-accent-brand flex-shrink-0" />
                    <span>You have a wallet list and need social profiles</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-accent-brand flex-shrink-0" />
                    <span>You want to identify agent wallets in your holders</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-accent-brand flex-shrink-0" />
                    <span>You need to separate humans from bots for outreach</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-accent-brand flex-shrink-0" />
                    <span>You want to export everything to CSV</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-accent-brand flex-shrink-0" />
                    <span>You prefer one-time pricing over token staking</span>
                  </li>
                </ul>
              </div>

              {/* Cookie.fun */}
              <div className="border rounded-lg p-6">
                <h3 className="font-semibold mb-4">Choose Cookie.fun if:</h3>
                <ul className="space-y-3 text-sm text-muted-foreground">
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                    <span>You want to research and rank AI agents</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                    <span>You trade AI agent tokens</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                    <span>You want mindshare and sentiment analytics</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                    <span>You&apos;re already holding $COOKIE tokens</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
                    <span>You don&apos;t have a specific wallet list to analyze</span>
                  </li>
                </ul>
              </div>
            </div>
          </section>

          {/* Pricing Comparison */}
          <section className="mb-16">
            <h2 className="text-2xl font-light tracking-[-0.028em] mb-6">Pricing breakdown</h2>

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

            <div className="bg-muted/30 rounded-lg p-6">
              <h3 className="font-semibold mb-4">Cookie.fun</h3>
              <p className="text-muted-foreground text-sm mb-2">
                Freemium with token-gated premium:
              </p>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>- Basic analytics: free (3-day &amp; 7-day data)</li>
                <li>- Premium analytics: stake 10,000 $COOKIE tokens</li>
                <li>- Premium unlocks holder distribution, sentiment analysis, and advanced data</li>
              </ul>
            </div>

            <div className="mt-6 p-4 border rounded-lg bg-accent-brand-tint border-accent-brand">
              <p className="text-sm">
                <span className="font-medium">Different models:</span>{' '}
                walletlink.social charges a one-time fee in USD. Cookie.fun
                gates premium features behind token staking, meaning your cost
                fluctuates with $COOKIE&apos;s price and you get your tokens back
                when you unstake.
              </p>
            </div>
          </section>

          {/* Use them together */}
          <section className="mb-16">
            <h2 className="text-2xl font-light tracking-[-0.028em] mb-4">Better together</h2>
            <p className="text-muted-foreground mb-4">
              These tools complement each other. A typical workflow:
            </p>
            <ol className="list-decimal list-inside text-muted-foreground space-y-2">
              <li>Use Cookie.fun to research which AI agents are trending</li>
              <li>Export your token&apos;s holder list from Etherscan or Basescan</li>
              <li>Upload to walletlink.social to identify agents and find human holders&apos; socials</li>
              <li>Filter out agent wallets and focus outreach on real community members</li>
            </ol>
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
