import type { Metadata } from 'next';
import Link from 'next/link';
import { PageShell } from '@/components/ui/page-shell';

/**
 * The hub over the six comparison pages.
 *
 * Those pages shipped without one, so /vs itself returned 404 and the
 * comparisons had no crawl entry point: they were reachable from the sitemap
 * and from each other, and from nothing a reader could click. Search Console
 * for the three months to 2026-08-30 shows the site averaging position 50.1,
 * with the comparison set earning impressions and no clicks.
 *
 * The split below is the useful one for a reader who arrived on a vendor
 * name: three of these companies still sell something, and three do not.
 * A page about a dead service is kept because the searches keep arriving,
 * and it says so rather than pretending the comparison is live. Every claim
 * is dated on the page it belongs to; nothing is restated here, so this hub
 * cannot drift away from the pages it links.
 */
export const metadata: Metadata = {
  title: 'walletlink.social compared with other wallet-to-social tools',
  description:
    'Side-by-side comparisons with Addressable, Cookie3 and Formo, plus migration notes for Airstack, Blaze and Holder, which are no longer available.',
  keywords: [
    'wallet to social alternatives',
    'Addressable alternative',
    'Airstack alternative',
    'Holder alternative',
    'onchain marketing tools',
  ],
  alternates: { canonical: 'https://walletlink.social/vs' },
  openGraph: {
    title: 'walletlink.social compared with other wallet-to-social tools',
    description:
      'What each tool actually sells, and where a dedicated wallet-to-social lookup fits.',
    url: 'https://walletlink.social/vs',
    siteName: 'walletlink.social',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'walletlink.social compared with other wallet-to-social tools',
    description:
      'What each tool actually sells, and where a dedicated wallet-to-social lookup fits.',
  },
};

interface Comparison {
  slug: string;
  name: string;
  blurb: string;
}

const LIVE: Comparison[] = [
  {
    slug: 'addressable',
    name: 'Addressable',
    blurb:
      'An enterprise marketing suite that matches wallets to X audiences as one capability inside a wider platform.',
  },
  {
    slug: 'cookie3',
    name: 'Cookie3',
    blurb:
      'Onchain marketing analytics. Its X-to-wallet matching is capped at 10,000 accounts on every tier you can buy.',
  },
  {
    slug: 'formo',
    name: 'Formo',
    blurb:
      'Product analytics and attribution for DeFi apps. Wallet profiles carry social handles as a feature inside it.',
  },
];

const DISCONTINUED: Comparison[] = [
  {
    slug: 'airstack',
    name: 'Airstack',
    blurb:
      'Farcaster APIs deprecated on 2025-03-05, and airstack.xyz now redirects to senpi.ai.',
  },
  {
    slug: 'blaze',
    name: 'Blaze',
    blurb: 'withblaze.app stopped resolving, checked on 2026-08-22.',
  },
  {
    slug: 'holder',
    name: 'Holder',
    blurb: 'holder.xyz sunset its web3 CRM in June 2024.',
  },
];

const ALL = [...LIVE, ...DISCONTINUED];

const itemListJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'ItemList',
  name: 'walletlink.social comparisons',
  description:
    'Comparisons between walletlink.social and other wallet-to-social and onchain marketing tools.',
  numberOfItems: ALL.length,
  itemListElement: ALL.map((c, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    name: `walletlink.social vs ${c.name}`,
    url: `https://walletlink.social/vs/${c.slug}`,
  })),
};

function ComparisonList({ items }: { items: Comparison[] }) {
  return (
    <ul className="space-y-4">
      {items.map((c) => (
        <li key={c.slug} className="text-muted-foreground">
          <Link href={`/vs/${c.slug}`} className="text-accent-brand">
            walletlink.social vs {c.name}
          </Link>
          <p className="mt-1 max-w-[52ch] text-sm font-light leading-snug">
            {c.blurb}
          </p>
        </li>
      ))}
    </ul>
  );
}

export default function ComparisonsHubPage() {
  return (
    <PageShell>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd) }}
      />
      <div className="max-w-[68ch]">
        <h1 className="mb-4 max-w-[17ch] text-4xl font-extralight leading-[1.02] tracking-[var(--tracking-display)] sm:text-5xl">
          What each tool actually{' '}
          <em className="font-semibold not-italic text-accent-brand">sells</em>
        </h1>
        <p className="mb-10 max-w-[52ch] text-lg font-light leading-snug tracking-[var(--tracking-lead)] text-muted-foreground">
          Most tools in this category are platforms with a wallet-to-social
          feature inside them. walletlink.social is the lookup on its own,
          priced once per match. Each page below dates its claims, or{' '}
          <Link href="/check" className="text-accent-brand">
            check a handle
          </Link>{' '}
          without an account.
        </p>

        <section className="mb-10">
          <h2 className="mb-3 text-2xl font-light tracking-[var(--tracking-title)]">
            Still available
          </h2>
          <ComparisonList items={LIVE} />
        </section>

        <section className="mb-10">
          <h2 className="mb-3 text-2xl font-light tracking-[var(--tracking-title)]">
            No longer available
          </h2>
          <p className="mb-4 max-w-[52ch] text-sm font-light leading-snug text-muted-foreground">
            These pages are kept because the searches keep arriving. Each one
            says what happened and where the work goes now.
          </p>
          <ComparisonList items={DISCONTINUED} />
        </section>
      </div>
    </PageShell>
  );
}
