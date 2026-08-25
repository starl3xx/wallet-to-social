import type { MetadataRoute } from 'next';
import { getAllSlugs } from '@/lib/blog';
import { listHolderCollections } from '@/lib/holder-pages';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = 'https://walletlink.social';

  const holderCollections = await listHolderCollections();
  const holderEntries: MetadataRoute.Sitemap = holderCollections.map((c) => ({
    url: `${baseUrl}/holders/${c.chain}/${c.address}`,
    lastModified: new Date(),
    changeFrequency: 'weekly',
    priority: 0.7,
  }));

  const blogSlugs = getAllSlugs();
  const blogEntries: MetadataRoute.Sitemap = blogSlugs.map((slug) => ({
    url: `${baseUrl}/blog/${slug}`,
    lastModified: new Date(),
    changeFrequency: 'monthly',
    priority: 0.7,
  }));

  return [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      // The one page a stranger can act on without an account, so it earns a
      // priority between the homepage and the comparison pages.
      url: `${baseUrl}/check`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.9,
    },
    {
      // The buying-intent page: "walletlink pricing" searches and the AI
      // agents shortlisting tools both land here.
      url: `${baseUrl}/pricing`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.9,
    },
    {
      url: `${baseUrl}/vs/addressable`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      // Kept for the searches that still land on it, but the service is gone
      // (checked 2026-08-22), so it ranks one step below the live comparisons.
      url: `${baseUrl}/vs/blaze`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.7,
    },
    {
      url: `${baseUrl}/vs/cookie3`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${baseUrl}/vs/holder`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${baseUrl}/vs/formo`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      // Kept for the searches that still land on it, but the service is gone
      // (checked 2026-08-22), so it ranks one step below the live comparisons.
      url: `${baseUrl}/vs/airstack`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.7,
    },
    {
      url: `${baseUrl}/blog`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.7,
    },
    {
      // Low priority, but present: a policy nobody can find is not published,
      // and a directory listing has to name a reachable URL for it.
      url: `${baseUrl}/privacy`,
      lastModified: new Date(),
      changeFrequency: 'yearly',
      priority: 0.3,
    },
    ...blogEntries,
    {
      // The hub over the per-collection reports; the reports themselves
      // follow at 0.7.
      url: `${baseUrl}/holders`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    ...holderEntries,
  ];
}
