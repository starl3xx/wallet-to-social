import { getAllSlugs, getPostBySlug } from '@/lib/blog';
import { PRODUCTION_URL } from '@/lib/site-url';
import { blogPostMarkdown } from '../../markdown/documents';

export const runtime = 'nodejs';

/**
 * The same hour as `app/blog/[slug]/page.tsx`, so a scheduled post becomes
 * readable in both forms at the same time rather than on two cadences.
 */
export const revalidate = 3600;

/** The published slugs, prerendered like the pages they mirror. */
export function generateStaticParams() {
  return getAllSlugs().map((slug) => ({ slug }));
}

/**
 * Every published post as markdown, served at /blog/{slug}.md.
 *
 * ## Why the handler is not at that path
 *
 * Neither obvious path exists in Next 16. A dynamic segment is a whole
 * directory name, so `app/blog/[slug].md/route.ts` is a literal segment
 * spelled "[slug].md" and matches nothing; `app/blog/[slug]/route.ts` is the
 * right segment and collides with the `page.tsx` already there. So the handler
 * lives here and `next.config.ts` rewrites /blog/:slug.md onto it.
 *
 * ## What stops it becoming a second indexable URL
 *
 * The `Link` header below, and only that. It declares the HTML page
 * canonical, which is the form a search engine can read for a document with
 * no `<head>` to put a tag in.
 *
 * It is worth being exact, because the obvious answer is wrong: a rewrite is
 * resolved inside the server and a crawler never sees the /api/ path, so the
 * `Disallow: /api/` in robots.txt does nothing here. The requested URL is
 * /blog/<slug>.md, which robots.txt allows. Sitting under /api buys tidiness,
 * not exclusion. If a hard exclusion is ever wanted, it has to be an
 * `X-Robots-Tag: noindex` on this response.
 *
 * ## What it returns
 *
 * `app/api/markdown/documents.ts` builds the document, and this route no
 * longer builds one of its own. The same post is reachable two ways now, at
 * /blog/<slug>.md and at /blog/<slug> with `Accept: text/markdown`, and two
 * builders for one document is the drift this repo keeps paying for
 * elsewhere. The frontmatter rules, and why `stripLeadingH1` is not applied,
 * are recorded with the builder.
 *
 * `lib/blog.ts` already parses every post with gray-matter and keeps the raw
 * body on `BlogPost.content`, so the document is a projection of an existing
 * loader and is not a second copy of anything.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const post = getPostBySlug(slug);

  if (!post) {
    return new Response(`No published post at /blog/${slug}.md\n`, {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  return new Response(blogPostMarkdown(post), {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      Link: `<${PRODUCTION_URL}/blog/${post.slug}>; rel="canonical"`,
      /**
       * Declared although nothing here varies: this URL always answers
       * markdown, whatever the client asks for. It is here because the same
       * document is now also reachable by negotiation at /blog/<slug>, and a
       * cache that holds one of the two should hold it under a key that says
       * which representation it is. Vercel's CDN keys on Accept regardless,
       * so this costs nothing and tells every cache downstream the truth.
       */
      Vary: 'Accept',
    },
  });
}
