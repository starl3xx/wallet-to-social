import { PRODUCTION_URL } from '@/lib/site-url';

/**
 * BreadcrumbList JSON-LD, in one place.
 *
 * Nine pages already draw a trail a reader can see (the post's "Blog" eyebrow,
 * the report's "Holder reports / <chain>" line, the comparison pages under the
 * /vs hub) and not one of them published the machine-readable half, while the
 * docs subdomain emits a BreadcrumbList on every page. This is that half.
 *
 * ## What it is for, honestly
 *
 * It teaches a crawler nothing about the site shape: the rendered HTML already
 * carries two anchors to /holders from a report and three to /blog from a
 * post, so those crawl edges exist with or without this. Text extractors drop
 * script tags, so it adds no quotable sentence either. The single documented
 * effect is display: Google and Bing render a breadcrumb trail in place of the
 * raw URL. That is worth a helper and nine three-line call sites, and it is
 * worth nothing more, so nothing here should grow.
 *
 * ## Every crumb carries a URL, deliberately
 *
 * Google drops a BreadcrumbList whose non-final items have no `item`, so a
 * label with no page behind it cannot be a crumb. That decides the one case
 * where the visible trail and the valid trail disagree: a holder report shows
 * "Holder reports / Base", but there is no /holders/base route (the hub groups
 * by chain inside one page), so the chain travels in the leaf crumb's name
 * instead of becoming a crumb of its own. The leaf keeps its own URL, which is
 * allowed and keeps every position addressable.
 */

/** One step in a trail. `path` is site-relative and starts with a slash. */
export interface Crumb {
  name: string;
  path: string;
}

/**
 * The root crumb, prepended to every trail so nine call sites cannot each
 * invent a name for the homepage. "walletlink.social" is what the header
 * lockup, the footer and every `siteName` already call it.
 */
const HOME: Crumb = { name: 'walletlink.social', path: '/' };

function absolute(path: string): string {
  if (!path.startsWith('/')) {
    throw new Error(
      `Breadcrumb path must be site-relative and start with a slash: "${path}"`
    );
  }
  // PRODUCTION_URL carries no trailing slash, and the homepage canonical in
  // app/layout.tsx is the bare origin, so "/" must not add one back. A
  // machine-to-machine URL here must also never be the www host or anything
  // that redirects (CHANGELOG 2026-08-15), which is why this builds from the
  // one declared origin rather than from a request.
  return path === '/' ? PRODUCTION_URL : `${PRODUCTION_URL}${path}`;
}

/**
 * The JSON-LD node for a trail, ready for a `<script type="application/ld+json">`.
 *
 * Pass the trail below the homepage, leaf last:
 *
 *   breadcrumbJsonLd([
 *     { name: 'Holder reports', path: '/holders' },
 *     { name: 'Based Fellas on Base', path: '/holders/base/0x...' },
 *   ])
 */
export function breadcrumbJsonLd(trail: Crumb[]) {
  const crumbs = [HOME, ...trail];
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((crumb, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: crumb.name,
      item: absolute(crumb.path),
    })),
  };
}
