import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageShell } from '@/components/ui/page-shell';
import { Figure } from '@/components/ui/figure';
import { Button } from '@/components/ui/button';
import { ArrowRight, Warning } from '@phosphor-icons/react/dist/ssr';
import { FREE_MATCHES_PER_WINDOW, FREE_WINDOW_DAYS } from '@/lib/packs';
import {
  listHolderCollections,
  getHolderCollection,
  getHolderStats,
  getHolderOverlap,
  measurementInProgress,
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
          {/* The link variant at inline size: the one treatment for a text
              link inside a sentence, with the underline affordance and focus
              ring a bare anchor lacked. Button renders the Link via Slot, so
              it works in a server component. */}
          <Button asChild variant="link" size="inline">
            <Link href="/holders">Holder reports</Link>
          </Button>{' '}
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

        {/* A below-floor page whose holders are mostly unchecked is a
            measurement still running, not a measured low rate, and must say
            so: without this note the small numbers below read as a finding
            about the collection. The caution panel is the app's one warning
            idiom (app/page.tsx mergeWarning). A fully checked below-floor
            page skips it, because there the numbers are the finding. */}
        {measurementInProgress(stats) && (
          <div className="mb-8 flex items-start gap-3 rounded-lg border border-caution bg-caution-tint p-4">
            <Warning
              className="mt-0.5 h-4 w-4 flex-none text-caution"
              aria-hidden
            />
            <p className="text-sm text-caution">
              Measurement in progress: {stats.checked.toLocaleString()} of{' '}
              {stats.holderCount.toLocaleString()} holders checked so far.
              Every reachable person shown was really found, so the numbers
              here are lower bounds; they rise as the remaining holders are
              checked.
            </p>
          </div>
        )}

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
            {/* No data is not a median of zero; n/a says which claim this is. */}
            <Figure
              value={
                stats.medianFcFollowers !== null
                  ? stats.medianFcFollowers.toLocaleString()
                  : 'n/a'
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
                  <Button asChild variant="link" size="inline">
                    <Link href={`/holders/${o.chain}/${o.address}`}>
                      {o.name}
                    </Link>
                  </Button>{' '}
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
          <p className="mb-6 text-muted-foreground">
            Paste any contract address or upload a CSV and get the people
            behind the wallets, ranked by holdings times reach. Free covers{' '}
            {FREE_MATCHES_PER_WINDOW} matches every {FREE_WINDOW_DAYS} days,
            and a wallet we cannot resolve costs nothing.
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
