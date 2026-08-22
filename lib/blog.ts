import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { Marked, Renderer, type Tokens } from 'marked';

const CONTENT_DIR = path.join(process.cwd(), 'content');
const PUBLISHED_DIR = path.join(CONTENT_DIR, 'published');

/**
 * Markdown renderer for post bodies.
 *
 * A GFM table is the one block that cannot reflow: the four-column table in
 * airdrop-targeting-identity.md measured 396px wide at a 375 viewport, and with
 * nothing between it and the page the document itself grew to 420, so the
 * header, hero and footer all slid sideways when the reader panned. The design
 * language allows `overflow-x-auto` on a genuine data table and nowhere else,
 * so the table gets its own scroll box here, at the one place every post's
 * HTML is produced, rather than a wrapper hand-placed in 26 markdown files.
 *
 * marked v17 calls a renderer override with `this` bound to the live renderer,
 * and the default `table` needs that renderer's `parser` to render the cells,
 * so the default is reached through the prototype with `this` kept.
 *
 * A `Marked` instance rather than the shared `marked` singleton, so the
 * override stays local to the blog.
 */
const markdown = new Marked({
  renderer: {
    table(token: Tokens.Table) {
      return `<div class="overflow-x-auto">${Renderer.prototype.table.call(this, token)}</div>`;
    },
  },
});

export interface BlogPost {
  slug: string;
  title: string;
  description: string;
  headlineVariations?: string[];
  content: string;
  html: string;
  publishedAt: string;
}

function slugify(filename: string): string {
  return filename.replace(/\.md$/, '');
}

function getMarkdownFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md') && f !== '.gitkeep');
}

function isPublishable(data: Record<string, unknown>): boolean {
  if (!data.published) return false;
  if (!data.publish_date) return true;
  const publishDate = new Date(data.publish_date as string);
  return publishDate <= new Date();
}

export function getAllPosts(): BlogPost[] {
  const files = getMarkdownFiles(PUBLISHED_DIR);
  const today = new Date();

  return (
    files
      .map((filename) => {
        const filePath = path.join(PUBLISHED_DIR, filename);
        const raw = fs.readFileSync(filePath, 'utf-8');
        const { data, content } = matter(raw);

        if (!isPublishable(data)) return null;

        return {
          slug: slugify(filename),
          title: data.title || filename,
          description: data.meta_description || '',
          headlineVariations: data.headline_variations,
          content,
          html: markdown.parse(stripLeadingH1(content)) as string,
          publishedAt:
            (data.publish_date as string) ||
            (data.date as string) ||
            '2025-01-01',
        };
      })
      .filter(Boolean)
      /**
       * Newest first. There was no sort at all, so posts came back in whatever
       * order the directory read produced, which is alphabetical by filename:
       * the live blog opened with 27 February, then 16 March, then 23 March,
       * because the files begin ai-agent-, ai-agents-, airdrop-. A reader had no
       * way to tell what was new, and the first thing on the page was chosen by
       * the letter a.
       *
       * `publish_date` is written as an ISO date ("2026-02-27") in every post's
       * frontmatter, so a plain string comparison is already chronological and
       * needs no Date parsing. The fallback in the map above is "2025-01-01",
       * which sorts a post missing a date to the bottom rather than the top: an
       * undated post is not news.
       */
      .sort((a, b) =>
        b!.publishedAt.localeCompare(a!.publishedAt)
      ) as BlogPost[]
  );
}

/**
 * Removes the leading `# ` heading from post markdown.
 *
 * Every one of the 26 published posts carries its own h1, and the page renders
 * another from frontmatter, so each post shipped two. The page hid the duplicate
 * with `prose-h1:hidden`, which leaves it in the accessibility tree and in the
 * document outline: display:none hides it visually, but the document still
 * declares two top-level headings, and search engines still parse both.
 *
 * Only the FIRST h1 goes, and only if it is the first non-empty line. A later `# `
 * would be a deliberate section break, and removing it would be a content change.
 */
function stripLeadingH1(md: string): string {
  const lines = md.split('\n');
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i++;
  if (i < lines.length && /^#\s+\S/.test(lines[i])) {
    lines.splice(i, 1);
    while (i < lines.length && lines[i].trim() === '') lines.splice(i, 1);
  }
  return lines.join('\n');
}

export function getPostBySlug(slug: string): BlogPost | null {
  const filePath = path.join(PUBLISHED_DIR, `${slug}.md`);
  if (!fs.existsSync(filePath)) return null;

  const raw = fs.readFileSync(filePath, 'utf-8');
  const { data, content } = matter(raw);

  if (!isPublishable(data)) return null;

  return {
    slug,
    title: data.title || slug,
    description: data.meta_description || '',
    headlineVariations: data.headline_variations,
    content,
    html: markdown.parse(stripLeadingH1(content)) as string,
    publishedAt:
      (data.publish_date as string) || (data.date as string) || '2025-01-01',
  };
}

export function getAllSlugs(): string[] {
  const files = getMarkdownFiles(PUBLISHED_DIR);
  return files
    .map((filename) => {
      const filePath = path.join(PUBLISHED_DIR, filename);
      const raw = fs.readFileSync(filePath, 'utf-8');
      const { data } = matter(raw);
      if (!isPublishable(data)) return null;
      return slugify(filename);
    })
    .filter(Boolean) as string[];
}
