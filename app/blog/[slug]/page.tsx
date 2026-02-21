import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getPostBySlug, getAllSlugs } from '@/lib/blog';

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  return getAllSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) return {};

  return {
    title: `${post.title} - walletlink.social`,
    description: post.description,
    openGraph: {
      title: post.title,
      description: post.description,
      type: 'article',
      url: `https://walletlink.social/blog/${slug}`,
      siteName: 'walletlink.social',
    },
    twitter: {
      card: 'summary_large_image',
      title: post.title,
      description: post.description,
    },
    alternates: {
      canonical: `https://walletlink.social/blog/${slug}`,
    },
  };
}

export default async function BlogPost({ params }: Props) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) notFound();

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.description,
    author: {
      '@type': 'Organization',
      name: 'walletlink.social',
      url: 'https://walletlink.social',
    },
    publisher: {
      '@type': 'Organization',
      name: 'walletlink.social',
      url: 'https://walletlink.social',
    },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': `https://walletlink.social/blog/${slug}`,
    },
    datePublished: post.publishedAt,
    dateModified: new Date().toISOString().split('T')[0],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="min-h-screen bg-background">
        <article className="container mx-auto py-12 px-4 max-w-4xl">
          {/* Header */}
          <header className="mb-12">
            <div className="flex items-center gap-4 mb-8">
              <Link
                href="/"
                className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
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
              <span className="text-muted-foreground">/</span>
              <Link
                href="/blog"
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Blog
              </Link>
            </div>

            <h1 className="text-4xl font-bold mb-4">{post.title}</h1>
            <p className="text-xl text-muted-foreground">{post.description}</p>
          </header>

          {/* Content */}
          <div
            className="prose prose-lg dark:prose-invert max-w-none
              prose-headings:font-semibold
              prose-h2:text-2xl prose-h2:mt-12 prose-h2:mb-4
              prose-h3:text-xl prose-h3:mt-8 prose-h3:mb-3
              prose-p:text-muted-foreground prose-p:leading-relaxed
              prose-a:text-emerald-600 dark:prose-a:text-emerald-400 prose-a:no-underline hover:prose-a:underline
              prose-strong:text-foreground
              prose-code:text-sm prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded
              prose-pre:bg-muted prose-pre:border
              prose-table:text-sm
              prose-th:text-left prose-th:py-3 prose-th:px-4 prose-th:border-b prose-th:font-semibold
              prose-td:py-3 prose-td:px-4 prose-td:border-b
              prose-blockquote:border-l-emerald-500 prose-blockquote:text-muted-foreground
              prose-li:text-muted-foreground
              prose-hr:border-border"
            dangerouslySetInnerHTML={{ __html: post.html }}
          />

          {/* Back link */}
          <div className="mt-16 pt-8 border-t">
            <Link
              href="/blog"
              className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              All posts
            </Link>
          </div>

          {/* CTA */}
          <div className="mt-8 p-8 bg-muted/50 rounded-lg text-center">
            <h3 className="text-xl font-semibold mb-2">
              Ready to find your holders?
            </h3>
            <p className="text-muted-foreground mb-4">
              Upload your wallet list and see who you can reach. 1,000 wallets
              free.
            </p>
            <Link
              href="/"
              className="inline-flex items-center gap-2 bg-foreground text-background px-6 py-3 rounded-lg font-medium hover:opacity-90 transition-opacity"
            >
              Try walletlink.social
            </Link>
          </div>

          {/* Footer */}
          <footer className="mt-16 pt-8 border-t text-center text-sm text-muted-foreground">
            <Link
              href="/"
              className="hover:text-foreground transition-colors"
            >
              walletlink.social
            </Link>
          </footer>
        </article>
      </div>
    </>
  );
}
