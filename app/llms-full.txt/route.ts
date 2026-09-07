import { getAllPosts } from '@/lib/blog';
import { PRODUCTION_URL } from '@/lib/site-url';

export const runtime = 'nodejs';

/** The same day as /llms.txt, since the two are read as one pair. */
export const revalidate = 86400;

/**
 * /llms-full.txt: the whole blog corpus in one fetch.
 *
 * docs.walletlink.social already serves a full-text file for the product and
 * API documentation; the apex answered 404 for the path agents probe next.
 * This is the marketing-site half of that pair, and its corpus is the blog:
 * the guides are the only long-form prose on this host that has a source to
 * render from.
 *
 * ## What is NOT in it, deliberately
 *
 * No /pricing and no /vs pages. Those are hand-written TSX with no markdown
 * source, so a full-text version of them would be a hand-authored second copy
 * of claims that `scripts/check-published-figures.ts` reads with `matchAll`.
 * A restated figure is a figure tested twice, and the checker fails on the
 * second one. The summaries in /llms.txt are what those pages get.
 *
 * No /holders reports either: they are aggregates over a live index, they
 * number in the hundreds, and none of them is prose.
 *
 * Every figure an agent might want from this file is therefore reached the
 * same way it always was: /llms.txt interpolates the constants, and
 * GET /api/v1/stats serves the measured table.
 *
 * ## Shape
 *
 * One document per post, newest first, in the order `getAllPosts` returns.
 * Each is preceded by a thematic break and two metadata lines, because the
 * body keeps its own h1 (`stripLeadingH1` belongs to the HTML page, which
 * renders a title of its own) and a second one above it would give every
 * document two top-level headings.
 */
export function GET(): Response {
  const posts = getAllPosts();

  const preamble = `# walletlink.social: every guide, in full

The complete text of every post on the walletlink.social blog, newest first, exactly as published. Each one is also served on its own at ${PRODUCTION_URL}/blog/{slug}.md.

What the product is, what the index covers, what a match is, what it costs and how the API and the MCP server work are summarised at ${PRODUCTION_URL}/llms.txt. The product and API documentation is a separate corpus, in full, at https://docs.walletlink.social/llms-full.txt.`;

  const documents = posts.map(
    (post) => `---

Source: ${PRODUCTION_URL}/blog/${post.slug}
Published: ${post.publishedAt}

${post.content.trim()}`
  );

  return new Response(`${preamble}\n\n${documents.join('\n\n')}\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
