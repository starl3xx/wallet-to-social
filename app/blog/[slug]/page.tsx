import type { Metadata } from 'next';
import Link from 'next/link';
import { PageShell } from '@/components/ui/page-shell';
import { notFound } from 'next/navigation';
import { ArrowLeft } from '@phosphor-icons/react/dist/ssr';
import { getPostBySlug, getAllSlugs } from '@/lib/blog';
import { FREE_MATCHES_PER_WINDOW, FREE_WINDOW_DAYS } from '@/lib/packs';

// Revalidate every hour so scheduled posts appear on time
export const revalidate = 3600;

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
      <PageShell>
        <header className="mx-auto max-w-[68ch]">
          <div className="mb-6 flex items-center gap-3 font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">
            <Link
              href="/blog"
              className="transition-control hover:text-accent-brand"
            >
              Blog
            </Link>
            <span aria-hidden="true">·</span>
            <span>
              {new Date(post.publishedAt).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </span>
          </div>

          {/* Display tier: weight 200 with the tight tracking, the one place besides
              the marketing hero where Extraleicht is allowed to get large. */}
          <h1 className="mb-4 text-4xl font-extralight leading-[1.05] tracking-[-0.04em] md:text-5xl">
            {post.title}
          </h1>
          <p className="text-lg font-light text-muted-foreground">
            {post.description}
          </p>
        </header>

        <article className="py-12">
          {/* max-w-[68ch], not max-w-none. max-w-none deleted the typography
              plugin's own 65ch default inside an 896px article, running body copy
              to roughly 95 characters per line at the prose-lg root. The measure is
              the point of a reading column. */}
          <div
            className="prose prose-lg dark:prose-invert mx-auto max-w-[68ch]
              prose-headings:font-semibold
              prose-h2:text-xl prose-h2:mt-12 prose-h2:mb-4
              prose-h3:text-base prose-h3:mt-8 prose-h3:mb-3
              prose-p:text-foreground/80 prose-p:leading-relaxed prose-li:text-foreground/80 prose-li:leading-relaxed
              prose-a:text-accent-brand dark:prose-a:text-accent-brand prose-a:no-underline hover:prose-a:underline
              prose-strong:text-foreground
              prose-code:text-sm prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-sm prose-code:font-mono
              prose-pre:bg-muted prose-pre:border prose-pre:font-mono
              prose-table:text-sm
              prose-th:text-left prose-th:py-3 prose-th:px-4 prose-th:border-b prose-th:font-semibold
              prose-td:py-3 prose-td:px-4 prose-td:border-b
              prose-blockquote:border-l-accent-brand prose-blockquote:text-muted-foreground
              
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
              Upload your wallet list and see who you can reach.{' '}
              {FREE_MATCHES_PER_WINDOW} matches free every {FREE_WINDOW_DAYS}{' '}
              days.
            </p>
            <Link
              href="/"
              className="inline-flex items-center gap-2 bg-foreground text-background px-6 py-3 rounded-lg font-medium hover:opacity-90 transition-opacity"
            >
              Try walletlink.social
            </Link>
          </div>

          {/* Footer */}
        </article>
      </PageShell>
    </>
  );
}
