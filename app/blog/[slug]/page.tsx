import type { Metadata } from 'next';
import Link from 'next/link';
import { PageShell } from '@/components/ui/page-shell';
import { Button } from '@/components/ui/button';
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
        {/* One column for the whole document. The header was `max-w-[68ch]` at
            the 16px root (about 580px) while the prose div was `prose-lg
            max-w-[68ch]`, whose ch is computed at 18px (about 650px), so the
            title sat 43px to the right of the first paragraph; the back link and
            the CTA then escaped the column altogether and ran the full shell.
            `text-lg` here makes the wrapper's ch match the prose root, so one
            68ch is the measure for everything below. The cost is that anything
            inside without its own size inherits 18px, so every child states its
            size. */}
        <div className="mx-auto max-w-[68ch] text-lg">
          <header>
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
            {/* max-w-none because the column above owns the measure. The
                typography plugin's own 65ch default would otherwise sit narrower
                than the 68ch wrapper and the header would overhang the prose
                again, which is the step this column exists to remove.

                The table cells get `tabular-nums` so the cost figures stack; the
                scroll box around the table itself is rendered in lib/blog.ts. */}
            <div
              className="prose prose-lg dark:prose-invert max-w-none
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
                prose-td:py-3 prose-td:px-4 prose-td:border-b prose-td:tabular-nums
                prose-blockquote:border-l-accent-brand prose-blockquote:text-muted-foreground
                prose-hr:border-border"
              dangerouslySetInnerHTML={{ __html: post.html }}
            />

            {/* Back link */}
            <div className="mt-16 pt-8 border-t">
              <Link
                href="/blog"
                className="transition-control inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden />
                All posts
              </Link>
            </div>

            {/* CTA. The paragraph and the button both state a size, because the
                column above is text-lg. The button is the Button primitive on a
                Link, which gives it the control height and the violet affordance
                the /vs pages use, instead of a hand-rolled foreground pill. The
                label is the one every marketing CTA for "/" carries, so the
                destination has one name wherever it is offered. */}
            <div className="mt-8 p-6 bg-muted/50 rounded-lg text-center">
              <h3 className="text-xl font-semibold mb-2">
                Ready to find your holders?
              </h3>
              <p className="text-base text-muted-foreground mb-4">
                Upload your wallet list and see who you can reach.{' '}
                {FREE_MATCHES_PER_WINDOW} matches free every {FREE_WINDOW_DAYS}{' '}
                days.
              </p>
              <Button asChild>
                <Link href="/">Run a lookup</Link>
              </Button>
            </div>
          </article>
        </div>
      </PageShell>
    </>
  );
}
