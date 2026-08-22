import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageShell } from '@/components/ui/page-shell';
import { Figure } from '@/components/ui/figure';
import { Button } from '@/components/ui/button';
import { ArrowRight } from '@phosphor-icons/react/dist/ssr';
import {
  listHolderCollections,
  getHolderCollection,
  getHolderStats,
  getHolderOverlap,
  chainLabel,
  standardLabel,
} from '@/lib/holder-pages';

/**
 * The per-collection holder reachability report.
 *
 * Every page ranking for "[collection] holders" today lists bare addresses;
 * this one answers the question those searches are actually asking: who are
 * the people behind the wallets, and how many can you reach? The numbers
 * come from the index at ISR time (hourly), so the page moves as the index
 * does, and none of them is a static literal the figure checker would need
 * to watch.
 *
 * Aggregates only, by rule: no wallet list, no handle list. The interactive
 * answer stays /check and the app.
 */
export const revalidate = 3600;

interface Props {
  params: Promise<{ chain: string; address: string }>;
}

export async function generateStaticParams() {
  const collections = await listHolderCollections();
  return collections.map((c) => ({ chain: c.chain, address: c.address }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { chain, address } = await params;
  const collection = await getHolderCollection(chain, address);
  if (!collection) return {};
  const canonical = `https://walletlink.social/holders/${collection.chain}/${collection.address}`;
  const title = `${collection.name} holders on ${chainLabel(collection.chain)}: the reachable people`;
  const description = `How many ${collection.name} holders resolve to an X or Farcaster account the owner published, with reachability checked. Measured against the walletlink.social identity index, refreshed daily.`;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, type: 'article', siteName: 'walletlink.social' },
    // X reads twitter:* over og:*; a page without the block inherits the
    // root layout card (the /check lesson).
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default async function HolderPage({ params }: Props) {
  const { chain, address } = await params;
  const collection = await getHolderCollection(chain, address);
  if (!collection) notFound();
  const [stats, overlap] = await Promise.all([
    getHolderStats(chain, address),
    getHolderOverlap(chain, address),
  ]);
  if (!stats) notFound();

  const capped =
    collection.totalHolders !== null &&
    collection.totalHolders > collection.holdersImported;
  const reachablePct =
    stats.holderCount > 0
      ? Math.round((stats.reachableAny / stats.holderCount) * 1000) / 10
      : 0;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: `${collection.name} holders on ${chainLabel(collection.chain)}: the reachable people`,
    author: { '@type': 'Organization', name: 'walletlink.social', url: 'https://walletlink.social' },
    publisher: { '@type': 'Organization', name: 'walletlink.social', url: 'https://walletlink.social' },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': `https://walletlink.social/holders/${collection.chain}/${collection.address}`,
    },
  };

  return (
    <PageShell>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="max-w-[68ch]">
        <p className="mb-3 text-sm text-muted-foreground">
          <Link href="/holders" className="text-accent-brand">
            Holder reports
          </Link>{' '}
          / {chainLabel(collection.chain)}
        </p>
        <h1 className="mb-4 max-w-[17ch] text-4xl font-extralight leading-[1.02] tracking-[var(--tracking-display)] sm:text-5xl">
          {collection.name} holders, resolved to{' '}
          <em className="font-semibold not-italic text-accent-brand">people</em>.
        </h1>
        <p className="mb-2 text-lg font-light leading-snug tracking-[var(--tracking-lead)] text-muted-foreground">
          Every holder ranking shows addresses. This one shows how many of the
          wallets holding this {standardLabel(collection.contractType)} on{' '}
          {chainLabel(collection.chain)} resolve to an X or Farcaster account
          the owner published, and how many of those you can still reach.
        </p>
        <p className="mb-8 text-sm text-muted-foreground">
          {capped ? (
            <>
              Measured over the top{' '}
              {collection.holdersImported.toLocaleString()} of{' '}
              {collection.totalHolders!.toLocaleString()} holders, against the
              walletlink.social index, refreshed daily.
            </>
          ) : (
            <>
              Measured over all {collection.holdersImported.toLocaleString()}{' '}
              indexed holders, against the walletlink.social index, refreshed
              daily.
            </>
          )}
        </p>

        <dl className="grid grid-cols-2 items-start gap-x-8 gap-y-6 border-t border-border pt-6 sm:grid-cols-4">
          <Figure
            value={stats.holderCount.toLocaleString()}
            label="holders measured"
          />
          <Figure
            value={stats.withTwitter.toLocaleString()}
            label="with an X handle"
          />
          <Figure
            value={stats.withFarcaster.toLocaleString()}
            label="on Farcaster"
          />
          <Figure
            value={`${stats.reachableAny.toLocaleString()} (${reachablePct}%)`}
            label="reachable people"
            attested
          />
        </dl>

        <section className="mt-12">
          <h2 className="mb-3 text-2xl font-light tracking-[var(--tracking-title)]">
            Having a handle and reaching it are different claims
          </h2>
          <p className="mb-4 text-muted-foreground">
            Each X handle here was published by the wallet&rsquo;s owner, and
            each carries a reachability state checked against X itself. A
            campaign sent to the full handle list would mail accounts that no
            longer reach anyone; the reachable number above already excludes
            them.
          </p>
          <dl className="grid grid-cols-2 items-start gap-x-8 gap-y-6 border-t border-border pt-6 sm:grid-cols-4">
            <Figure value={stats.xLive.toLocaleString()} label="X handles live" attested />
            <Figure
              value={stats.xSuspended.toLocaleString()}
              label="suspended"
            />
            <Figure
              value={stats.xUnclaimed.toLocaleString()}
              label="names nobody holds"
            />
            <Figure
              value={
                stats.medianFcFollowers !== null
                  ? stats.medianFcFollowers.toLocaleString()
                  : '0'
              }
              label="median Farcaster followers"
            />
          </dl>
        </section>

        {overlap.length > 0 && (
          <section className="mt-12">
            <h2 className="mb-3 text-2xl font-light tracking-[var(--tracking-title)]">
              These holders also hold
            </h2>
            <ul className="space-y-2">
              {overlap.map((o) => (
                <li key={`${o.chain}:${o.address}`} className="text-muted-foreground">
                  <Link
                    href={`/holders/${o.chain}/${o.address}`}
                    className="text-accent-brand"
                  >
                    {o.name}
                  </Link>{' '}
                  <span className="tabular-nums">
                    ({o.sharedHolders.toLocaleString()} shared holders,{' '}
                    {chainLabel(o.chain)})
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-12 border-t border-border pt-8">
          <h2 className="mb-3 text-2xl font-light tracking-[var(--tracking-title)]">
            Run this on your own list
          </h2>
          <p className="mb-5 text-muted-foreground">
            Paste any contract address or upload a CSV and get the people
            behind the wallets, ranked by holdings times reach. Free covers
            100 matches every 30 days, and a wallet we cannot resolve costs
            nothing.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button asChild>
              <Link href="/">
                Run a lookup
                <ArrowRight aria-hidden />
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/pricing">Pricing</Link>
            </Button>
          </div>
        </section>
      </div>
    </PageShell>
  );
}
