import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { marked } from 'marked';

const CONTENT_DIR = path.join(process.cwd(), 'content');
const PUBLISHED_DIR = path.join(CONTENT_DIR, 'published');

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
  return fs.readdirSync(dir).filter((f) => f.endsWith('.md') && f !== '.gitkeep');
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

  return files
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
        html: marked(content) as string,
        publishedAt: (data.publish_date as string) || (data.date as string) || '2025-01-01',
      };
    })
    .filter(Boolean) as BlogPost[];
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
    html: marked(content) as string,
    publishedAt: (data.publish_date as string) || (data.date as string) || '2025-01-01',
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
