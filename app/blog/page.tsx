import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
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
    <div className="min-h-screen bg-background">
      <div className="container mx-auto py-12 px-4 max-w-4xl">
        {/* Header */}
        <header className="mb-12">
          <Link
            href="/"
            className="inline-flex items-center gap-2 mb-8 text-muted-foreground hover:text-foreground transition-colors"
          >
            <Image
              src="/icon.png"
              alt="walletlink.social"
              width={24}
              height={24}
              className="rounded"
            />
            <span className="text-sm font-medium">walletlink.social</span>
          </Link>

          <h1 className="text-4xl font-bold mb-4">Blog</h1>
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
                  <h2 className="text-2xl font-semibold mb-2 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                    {post.title}
                  </h2>
                  <p className="text-muted-foreground mb-4">
                    {post.description}
                  </p>
                  <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-600 dark:text-emerald-400">
                    Read more <ArrowRight className="h-4 w-4" />
                  </span>
                </Link>
              </article>
            ))}
          </div>
        )}

        {/* Footer */}
        <footer className="mt-16 pt-8 border-t text-center text-sm text-muted-foreground">
          <Link href="/" className="hover:text-foreground transition-colors">
            walletlink.social
          </Link>
        </footer>
      </div>
    </div>
  );
}
