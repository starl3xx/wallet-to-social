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
      {/* The one reading column, 68ch and left-aligned inside the shell, the
          same column the post and the /vs pages read in. The index had no
          measure at all: card descriptions ran about 130 characters per line
          across the full shell. */}
      <div className="max-w-[68ch]">
        <header className="mb-12">
          {/* Display tier with the display tracking token; it was the same
              value written raw. One word, so it carries no emphasis span: the
              span is one 600 word inside a 200 line, and a line of one word
              has nothing for it to sit inside. */}
          <h1 className="mb-4 text-4xl font-extralight leading-[1.02] tracking-[var(--tracking-display)] sm:text-5xl">
            Blog
          </h1>
          {/* The one lede: 300 at 18px with the lead tracking, in
              `muted-foreground`. It was 20px at 400, a third way of writing
              the standfirst beside the post's and the /vs pages'. */}
          <p className="max-w-[46ch] text-lg font-light leading-snug tracking-[var(--tracking-lead)] text-muted-foreground">
            Insights on wallet identity, token holder outreach, and Web3
            marketing.
          </p>
        </header>

        {/* Posts */}
        {posts.length === 0 ? (
          <p className="text-muted-foreground">
            No posts yet. Check back soon.
          </p>
        ) : (
          <div className="space-y-8">
            {posts.map((post) => (
              <article
                key={post.slug}
                className="group rounded-lg border border-border p-6 transition-control hover:border-accent-brand"
              >
                <Link href={`/blog/${post.slug}`} className="block">
                  <p className="mb-2 text-xs text-muted-foreground">
                    {new Date(post.publishedAt).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })}
                  </p>
                  {/* The card title: 18px at 600. It was 20px, a size the
                      scale gives to the page's own h2s. `transition-control`,
                      not `transition-colors`: the tokens carry the duration.
                      No `dark:` restatement, since the token is theme-aware. */}
                  <h2 className="mb-2 text-lg font-semibold transition-control group-hover:text-accent-brand">
                    {post.title}
                  </h2>
                  <p className="mb-4 text-muted-foreground">
                    {post.description}
                  </p>
                  <span className="inline-flex items-center gap-1 text-sm font-medium text-accent-brand">
                    Read more <ArrowRight className="h-4 w-4" aria-hidden />
                  </span>
                </Link>
              </article>
            ))}
          </div>
        )}
      </div>
    </PageShell>
  );
}
