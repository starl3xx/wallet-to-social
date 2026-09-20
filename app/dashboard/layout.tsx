import type { Metadata } from 'next';

/**
 * Keep the dashboard out of the index.
 *
 * `app/dashboard/page.tsx` is a client component, so it cannot export metadata
 * itself; a layout is the only place the directive can live. Same shape as
 * `app/admin/layout.tsx` and `app/success/layout.tsx`, for the same reason.
 *
 * Deliberately noindex rather than a robots.txt Disallow. A disallowed URL can
 * still be indexed from a link, and Google cannot read a noindex on a page it
 * is forbidden to fetch, so blocking the crawl is the one change that would
 * make the page harder to remove.
 *
 * No canonical and no sitemap entry, deliberately. Declaring a canonical is
 * asking to be indexed, and the sitemap is where that request is actually
 * made; a signed-in surface asks for neither. No `openGraph` block either,
 * since declaring one drops the root segment's file-based image and a private
 * page has nothing to share.
 */
export const metadata: Metadata = {
  title: 'Dashboard',
  robots: { index: false, follow: false },
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
