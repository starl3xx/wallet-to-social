/**
 * The markdown half of content negotiation.
 *
 * A request for an ordinary page carrying `Accept: text/markdown` is rewritten
 * here by `next.config.ts`, which passes the original path through. Nothing
 * else reaches this handler in normal use: `/api/` is disallowed in
 * robots.txt, and the rewrite is the only thing that names these paths.
 *
 * ## Why a rewrite and not middleware
 *
 * Middleware would run on every request to the whole site to change the
 * answer for a few, and the negotiation it would implement is exactly what a
 * rewrite `has` condition already is. The routing layer is also where the
 * decision belongs: a request that does not ask for markdown never touches
 * this file, and never pays for it.
 *
 * ## The one thing to get right about the `has` regex
 *
 * Next compiles a `has` value as `new RegExp(\`^${value}$\`)`, anchored at
 * both ends (`matchHas` in
 * `next/dist/shared/lib/router/utils/prepare-destination.js`). So the pattern
 * in `next.config.ts` is `.*text/markdown.*` and not `text/markdown`: the
 * bare form matches only a client whose entire Accept header is those
 * fourteen characters, which is a curl invocation and not an agent. Every
 * real client sends a list. Getting this wrong fails silently and in the safe
 * direction, which is why it needs an assertion rather than a test run.
 *
 * ## Selection is contains, not q-value
 *
 * `Accept: text/html;q=0.9, text/markdown;q=0.1` is answered with markdown
 * here, although a strict reading of RFC 9110 prefers the HTML. That is
 * deliberate: it is the behavior Cloudflare's Markdown for Agents implements,
 * so a client written against that gets the same answer from this site, and
 * the alternative is a q-value parser whose failure mode is serving an agent
 * the HTML it explicitly asked not to have. A browser never sends
 * `text/markdown` in any position, which is the case that actually matters.
 *
 * ## Caching
 *
 * `Vary: Accept` is on every response below, and on the HTML responses too
 * (the `headers()` block in `next.config.ts`). Vercel's own CDN already keys
 * on `Accept` without being told, so this is not what stops a browser being
 * served markdown there; it is what stops every cache between here and the
 * client from doing it.
 */
import { getAllPosts, getPostBySlug } from '@/lib/blog';
import {
  getHolderCollection,
  getHolderOverlap,
  getHolderStats,
  listHolderCollections,
} from '@/lib/holder-pages';
import { PRODUCTION_URL } from '@/lib/site-url';
import {
  blogIndexMarkdown,
  blogPostMarkdown,
  holderReportIsIndexable,
  holderReportMarkdown,
  holdersIndexMarkdown,
  homeMarkdown,
  pricingMarkdown,
} from '../documents';

export const runtime = 'nodejs';

/**
 * Dynamic, and the holder documents are why.
 *
 * `app/api/starter-collections/route.ts` records what `force-static` does to
 * a handler that reads a database: Next runs its GET during every build, and
 * the read becomes a build-time dependency. Two of the documents below read
 * Neon, so the whole handler stays dynamic and buys its caching back with the
 * `s-maxage` on each response, which is the same hour the pages they mirror
 * revalidate on.
 */
export const dynamic = 'force-dynamic';

/** The same hour `app/blog/[slug]/page.tsx` and the holder report use. */
const CACHE = 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400';

interface MarkdownDocument {
  body: string;
  /** The HTML page this is a representation of, never a second page. */
  canonical: string;
  /**
   * Set only where the HTML page itself carries a noindex, so the two
   * representations of one page agree about whether it may be indexed. A
   * placeholder-named holder report is the only case today.
   */
  noindex?: boolean;
}

function markdownResponse(doc: MarkdownDocument): Response {
  return new Response(doc.body, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      Vary: 'Accept',
      Link: `<${doc.canonical}>; rel="canonical"`,
      'Cache-Control': CACHE,
      ...(doc.noindex ? { 'X-Robots-Tag': 'noindex' } : {}),
    },
  });
}

/**
 * The path set here and the rewrite sources in `next.config.ts` are one list
 * split across two files, and `scripts/check-invariants.ts` asserts they
 * still agree. A rewrite with no branch here answers 404 to a client that
 * asked politely for markdown; a branch with no rewrite is unreachable code
 * that looks like a shipped feature.
 */
async function resolveDocument(
  segments: string[]
): Promise<MarkdownDocument | null> {
  const [first, second, third] = segments;

  if (segments.length === 0) {
    return { body: homeMarkdown(), canonical: `${PRODUCTION_URL}/` };
  }

  if (segments.length === 1 && first === 'pricing') {
    return { body: pricingMarkdown(), canonical: `${PRODUCTION_URL}/pricing` };
  }

  if (segments.length === 1 && first === 'blog') {
    return {
      body: blogIndexMarkdown(getAllPosts()),
      canonical: `${PRODUCTION_URL}/blog`,
    };
  }

  if (segments.length === 2 && first === 'blog') {
    const post = getPostBySlug(second);
    if (!post) return null;
    return {
      body: blogPostMarkdown(post),
      canonical: `${PRODUCTION_URL}/blog/${post.slug}`,
    };
  }

  if (segments.length === 1 && first === 'holders') {
    return {
      body: holdersIndexMarkdown(await listHolderCollections()),
      canonical: `${PRODUCTION_URL}/holders`,
    };
  }

  if (segments.length === 3 && first === 'holders') {
    const collection = await getHolderCollection(second, third);
    if (!collection) return null;
    const [stats, overlap] = await Promise.all([
      getHolderStats(second, third),
      getHolderOverlap(second, third),
    ]);
    // The same condition the page 404s on, so a collection with no holdings
    // rows does not get a report in one representation and not the other.
    if (!stats) return null;
    return {
      body: holderReportMarkdown(collection, stats, overlap),
      canonical: `${PRODUCTION_URL}/holders/${collection.chain}/${collection.address}`,
      noindex: !holderReportIsIndexable(collection),
    };
  }

  return null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path?: string[] }> }
) {
  const { path } = await params;
  const doc = await resolveDocument(path ?? []);
  /**
   * A plain 404 rather than `notFound()`, matching the blog twin beside it.
   * `notFound()` is written for a page, where it renders `not-found.tsx`;
   * from a handler the honest answer is the status and a line of text, and
   * the caller asked for markdown rather than a rendered page.
   *
   * Falling back to the HTML is not an option here and would not be right
   * anyway: the rewrite has already replaced the request, and every path that
   * reaches this point without a document is one whose HTML page is also a
   * 404.
   */
  if (!doc) {
    return new Response('No markdown representation at this path\n', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', Vary: 'Accept' },
    });
  }
  return markdownResponse(doc);
}
