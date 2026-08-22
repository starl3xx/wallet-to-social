import type { Metadata } from 'next';
import Link from 'next/link';
import { PageShell } from '@/components/ui/page-shell';
import {
  listHolderCollections,
  chainLabel,
  type HolderCollection,
} from '@/lib/holder-pages';

/**
 * The hub over the per-collection reports: every seeded collection, grouped
 * by chain. It exists for the crawl path and the reader who arrived at one
 * report and wants the rest; the grouping is by chain because the chain
 * decides the match rate more than the collection does.
 */
export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'Holder reachability reports',
  description:
    'Per-collection reports on the people behind the wallets: how many holders resolve to an X or Farcaster account, and how many are still reachable. Measured against the walletlink.social index.',
  alternates: { canonical: 'https://walletlink.social/holders' },
  openGraph: {
    title: 'Holder reachability reports',
    description:
      'How many holders of each collection resolve to reachable people, measured against a 4.8M wallet identity index.',
    url: 'https://walletlink.social/holders',
    siteName: 'walletlink.social',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Holder reachability reports',
    description:
      'How many holders of each collection resolve to reachable people.',
  },
};

export default async function HoldersHubPage() {
  const collections = await listHolderCollections();

  const byChain = new Map<string, HolderCollection[]>();
  for (const c of collections) {
    const list = byChain.get(c.chain) ?? [];
    list.push(c);
    byChain.set(c.chain, list);
  }

  return (
    <PageShell>
      <div className="max-w-[68ch]">
        <h1 className="mb-4 max-w-[17ch] text-4xl font-extralight leading-[1.02] tracking-[var(--tracking-display)] sm:text-5xl">
          Who holds it, and who can you{' '}
          <em className="font-semibold not-italic text-accent-brand">reach</em>?
        </h1>
        <p className="mb-10 max-w-[52ch] text-lg font-light leading-snug tracking-[var(--tracking-lead)] text-muted-foreground">
          Per-collection reports on the people behind the wallets, measured
          against the walletlink.social identity index. Pick a collection, or{' '}
          <Link href="/" className="text-accent-brand">
            run your own list
          </Link>
          .
        </p>

        {[...byChain.entries()].map(([chain, list]) => (
          <section key={chain} className="mb-10">
            <h2 className="mb-3 text-2xl font-light tracking-[var(--tracking-title)]">
              {chainLabel(chain)}
            </h2>
            <ul className="space-y-2">
              {list.map((c) => (
                <li key={c.address} className="text-muted-foreground">
                  <Link
                    href={`/holders/${c.chain}/${c.address}`}
                    className="text-accent-brand"
                  >
                    {c.name}
                  </Link>{' '}
                  <span className="tabular-nums">
                    ({c.holdersImported.toLocaleString()} holders measured)
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </PageShell>
  );
}
