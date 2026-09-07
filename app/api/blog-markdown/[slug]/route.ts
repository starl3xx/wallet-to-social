import { getAllSlugs, getPostBySlug } from '@/lib/blog';
import { PRODUCTION_URL } from '@/lib/site-url';

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

/** A JSON string is a valid YAML double-quoted scalar. */
const scalar = (value: string) => JSON.stringify(value);

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
 * `lib/blog.ts` already parses every post with gray-matter and keeps the raw
 * body on `BlogPost.content`, so this is a projection of an existing loader
 * and is not a second copy of anything.
 *
 * `stripLeadingH1` is deliberately NOT applied. The page component strips it
 * because the page renders its own title from the frontmatter and would
 * otherwise ship two h1s; here the body is the whole document, and its own
 * heading is the only title in it.
 *
 * The frontmatter gray-matter removed is restored rather than prepended as
 * prose, for the same reason: a second `# Title` above the body's own would
 * give the document two top-level headings. Values go through
 * `JSON.stringify`, which emits a valid YAML double-quoted scalar. Titles
 * carry colons ("The priority score formula: finding your most valuable
 * holders") and a bare colon ends a plain scalar, so an unquoted line would
 * parse as something else or fail to parse at all.
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

  const canonical = `${PRODUCTION_URL}/blog/${post.slug}`;

  const frontmatter = [
    '---',
    `title: ${scalar(post.title)}`,
    ...(post.description ? [`description: ${scalar(post.description)}`] : []),
    `date: ${scalar(post.publishedAt)}`,
    // Carried when the post has one, for the same reason the HTML page emits
    // dateModified only then: a twin that publishes only the original date
    // tells a reader the post has never been revised, while the page beside
    // it says otherwise. Absent on an unrevised post, which is the honest
    // answer rather than a stand-in.
    ...(post.updatedAt ? [`updated_date: ${scalar(post.updatedAt)}`] : []),
    `canonical_url: ${scalar(canonical)}`,
    '---',
  ].join('\n');

  return new Response(`${frontmatter}\n\n${post.content.trim()}\n`, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      Link: `<${canonical}>; rel="canonical"`,
    },
  });
}
