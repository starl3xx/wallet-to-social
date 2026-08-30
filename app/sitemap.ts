import type { MetadataRoute } from 'next';
import { getAllPosts } from '@/lib/blog';
import { listHolderCollections } from '@/lib/holder-pages';

/**
 * Regenerate hourly, on the same cadence as the holder pages themselves.
 *
 * Without this the route is an async function Next prerenders once, so the
 * sitemap freezes at build time: the daily seed cron adds collections that
 * never appear until somebody happens to redeploy. Verified in production on
 * 2026-08-30, where all 106 URLs carried one of two build timestamps 10ms
 * apart.
 */
export const revalidate = 3600;

/**
 * `lastmod` is omitted wherever no honest value exists.
 *
 * Every entry here used to call `new Date()`, which stamps the render time on
 * pages that had not changed. Google's guidance is to leave the field out
 * rather than supply a date the content does not support, because a lastmod
 * that always says "now" is ignored at best and distrusted at worst. So the
 * three kinds of entry are treated differently: a blog post carries its
 * publish date, a holder report carries the date its holder set was last
 * confirmed onchain, and a hub carries the newest date among its children.
 * The static marketing pages carry nothing, because nothing in the codebase
 * records when they last changed.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = 'https://walletlink.social';

  const holderCollections = await listHolderCollections();
  const holderEntries: MetadataRoute.Sitemap = holderCollections.map((c) => ({
    url: `${baseUrl}/holders/${c.chain}/${c.address}`,
    lastModified: new Date(c.lastSeenAt),
    changeFrequency: 'weekly',
    priority: 0.7,
  }));

  const posts = getAllPosts();
  const blogEntries: MetadataRoute.Sitemap = posts.map((post) => ({
    url: `${baseUrl}/blog/${post.slug}`,
    lastModified: new Date(post.publishedAt),
    changeFrequency: 'monthly',
    priority: 0.7,
  }));

  /** The newest child date, or undefined when a hub has no children yet. */
  const newest = (entries: MetadataRoute.Sitemap): Date | undefined => {
    const times = entries
      .map((e) => (e.lastModified ? new Date(e.lastModified).getTime() : NaN))
      .filter((t) => Number.isFinite(t));
    return times.length ? new Date(Math.max(...times)) : undefined;
  };

  return [
    {
      url: baseUrl,
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      // The one page a stranger can act on without an account, so it earns a
      // priority between the homepage and the comparison pages.
      url: `${baseUrl}/check`,
      changeFrequency: 'weekly',
      priority: 0.9,
    },
    {
      // The buying-intent page: "walletlink pricing" searches and the AI
      // agents shortlisting tools both land here.
      url: `${baseUrl}/pricing`,
      changeFrequency: 'monthly',
      priority: 0.9,
    },
    {
      // The hub over the comparisons. Without it the six pages below have no
      // crawl entry point: /vs itself returned 404 until 2026-08-30, so they
      // were reachable only from the sitemap and from each other.
      url: `${baseUrl}/vs`,
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${baseUrl}/vs/addressable`,
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      // Kept for the searches that still land on it, but the service is gone
      // (checked 2026-08-22), so it ranks one step below the live comparisons.
      url: `${baseUrl}/vs/blaze`,
      changeFrequency: 'monthly',
      priority: 0.7,
    },
    {
      url: `${baseUrl}/vs/cookie3`,
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${baseUrl}/vs/holder`,
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${baseUrl}/vs/formo`,
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      // Kept for the searches that still land on it, but the service is gone
      // (checked 2026-08-22), so it ranks one step below the live comparisons.
      url: `${baseUrl}/vs/airstack`,
      changeFrequency: 'monthly',
      priority: 0.7,
    },
    {
      url: `${baseUrl}/blog`,
      lastModified: newest(blogEntries),
      changeFrequency: 'weekly',
      priority: 0.7,
    },
    {
      // Low priority, but present: a policy nobody can find is not published,
      // and a directory listing has to name a reachable URL for it.
      url: `${baseUrl}/privacy`,
      changeFrequency: 'yearly',
      priority: 0.3,
    },
    ...blogEntries,
    {
      // The hub over the per-collection reports; the reports themselves
      // follow at 0.7.
      url: `${baseUrl}/holders`,
      lastModified: newest(holderEntries),
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    ...holderEntries,
  ];
}
