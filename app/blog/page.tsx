import type { Metadata } from 'next';
import Link from 'next/link';
import { PageShell } from '@/components/ui/page-shell';
import { ArrowRight } from '@phosphor-icons/react/dist/ssr';
import { getAllPosts } from '@/lib/blog';

// Revalidate every hour so scheduled posts appear on time
export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'Blog - walletlink.social',
  description:
    'Insights on wallet identity, token holder outreach, AI agent detection, and Web3 marketing. From the team building walletlink.social.',
  openGraph: {
    title: 'Blog - walletlink.social',
    description:
      'Insights on wallet identity, token holder outreach, AI agent detection, and Web3 marketing.',
    type: 'website',
    url: 'https://walletlink.social/blog',
    siteName: 'walletlink.social',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Blog - walletlink.social',
    description:
      'Insights on wallet identity, token holder outreach, AI agent detection, and Web3 marketing.',
  },
  alternates: {
    canonical: 'https://walletlink.social/blog',
  },
};

export default function BlogIndex() {
  const posts = getAllPosts();

  return (
    <PageShell>
        <header className="mb-12">
          <h1 className="mb-4 text-4xl font-extralight tracking-[-0.04em] sm:text-5xl">Blog</h1>
          <p className="text-xl text-muted-foreground">
            Insights on wallet identity, token holder outreach, and Web3
            marketing.
          </p>
        </header>

        {/* Posts */}
        {posts.length === 0 ? (
          <p className="text-muted-foreground">No posts yet. Check back soon.</p>
        ) : (
          <div className="space-y-8">
            {posts.map((post) => (
              <article
                key={post.slug}
                className="group border rounded-lg p-6 hover:border-foreground/20 transition-colors"
              >
                <Link href={`/blog/${post.slug}`} className="block">
                  <p className="text-xs text-muted-foreground mb-2">
                    {new Date(post.publishedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                  </p>
                  <h2 className="text-xl font-semibold mb-2 group-hover:text-accent-brand dark:group-hover:text-accent-brand transition-colors">
                    {post.title}
                  </h2>
                  <p className="text-muted-foreground mb-4">
                    {post.description}
                  </p>
                  <span className="inline-flex items-center gap-1 text-sm font-medium text-accent-brand">
                    Read more <ArrowRight className="h-4 w-4" />
                  </span>
                </Link>
              </article>
            ))}
          </div>
        )}

        {/* Footer */}
    </PageShell>
  );
}
