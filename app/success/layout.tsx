import type { Metadata } from 'next';

/**
 * Keep the checkout return page out of the index.
 *
 * It renders per-purchase state from the query string and has nothing a
 * searcher could want, so an indexed copy is at best a dead end and at worst
 * a stranger's receipt page in the results.
 *
 * `app/success/page.tsx` is a client component, so it cannot export metadata
 * itself; a layout is the only place the directive can live. Search Console
 * confirmed on 2026-08-30 that the route was crawlable and index-eligible.
 *
 * Deliberately noindex rather than a robots.txt Disallow. A disallowed URL can
 * still be indexed from a link, and Google cannot read a noindex on a page it
 * is forbidden to fetch, so blocking the crawl is the one change that would
 * make the page harder to remove.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function SuccessLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
