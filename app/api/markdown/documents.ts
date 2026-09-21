/**
 * The markdown representation of each negotiable page.
 *
 * ## Why these live under `app/` and not in `lib/`
 *
 * Two guards decide it. `scripts/check-house-style.mjs` walks `app`,
 * `components` and `lib`, so it would read these either way. But
 * `scripts/check-design-language.mjs` walks `app` and `components` only, and
 * these are template literals full of published prose. Moving them to `lib/`
 * would drop every sentence below out of that guard without a word of
 * warning, which is the same silent loss of coverage `app/llms.txt/route.ts`
 * records in its own header. Colocated with the handler that serves them,
 * both guards keep reading them.
 *
 * ## The rule these documents follow
 *
 * A markdown twin is a projection of the page's own sources, never a second
 * copy of the page's prose. Every figure below comes from the constant or the
 * loader the HTML page reads, so the two cannot disagree: prices from
 * `lib/packs.ts`, API limits from `lib/api-plans.ts`, posts from
 * `lib/blog.ts`, holder figures from `lib/holder-pages.ts` through the same
 * helpers the report component calls.
 *
 * Where a page's only source IS its prose, there is no twin and the page is
 * not negotiable. That is why `/vs/*` and `/privacy` are absent: their
 * content is editorial writing with nothing behind it to derive from, and a
 * hand-written twin would be a second copy that drifts the first time either
 * side is edited. Those URLs answer HTML to every client, which is a correct
 * answer to `Accept: text/markdown` when no markdown representation exists.
 */
import { llmsTxtBody } from '@/app/llms.txt/route';
import type { BlogPost } from '@/lib/blog';
import { PRODUCTION_URL } from '@/lib/site-url';
import {
  PACKS,
  PACK_IDS,
  MEASURED_MATCH_RATE,
  FREE_MATCHES_PER_WINDOW,
  FREE_WINDOW_DAYS,
  CREDIT_LIFETIME_MONTHS,
} from '@/lib/packs';
import { API_PLANS, CREDIT_API_PLAN } from '@/lib/api-plans';
import { MATCH_SENTENCE } from '@/lib/canonical-sentences';
import {
  chainLabel,
  holderBasis,
  holderBasisCaveat,
  holderBasisPhrase,
  isNamed,
  measurementInProgress,
  standardLabel,
  LISTING_MIN_REACHABLE,
  type HolderCollection,
  type HolderOverlap,
  type HolderStats,
  type ListedHolderCollection,
} from '@/lib/holder-pages';

/**
 * A JSON string is a valid YAML double-quoted scalar.
 *
 * The same helper the blog twin has always used, for the reason recorded
 * there: titles carry colons, and a bare colon ends a plain scalar, so an
 * unquoted line parses as something else or fails to parse at all.
 */
const scalar = (value: string) => JSON.stringify(value);

/**
 * Frontmatter, with `canonical_url` on every document without exception.
 *
 * A markdown twin is a second representation of one page, not a second page.
 * The `Link: rel="canonical"` header says so to a crawler; this says so to
 * the reader that only ever sees the bytes, which is the agent these
 * documents exist for.
 */
function frontmatter(fields: Record<string, string | null>): string {
  /**
   * Assembled with a template rather than `['---', ...lines, '---']`, which
   * is the obvious form and trips the house-style extractor: its quote
   * matcher pairs the closing quote of the first `'---'` with the opening
   * quote of the second and reads `, ...lines, ` as copy, then fails the
   * ellipsis rule on the spread. A real limitation of naive quote pairing,
   * recorded in `scripts/check-house-style.mjs`, and cheaper to write around
   * than to widen a guard for.
   */
  const lines = Object.entries(fields)
    .filter((entry): entry is [string, string] => entry[1] !== null)
    .map(([key, value]) => `${key}: ${scalar(value)}`)
    .join('\n');
  return `---\n${lines}\n---`;
}

/**
 * The home page: the `/llms.txt` body, and deliberately not a new document.
 *
 * `/llms.txt` already answers "what is this site, what does it cover, what
 * does it cost" in markdown, derived from the constants. Writing a second
 * answer here would be a sixth copy of the figures `app/llms.txt/route.ts`
 * spends its header warning against. So this is one document at two URLs,
 * with one builder, and the only difference is the media type each is served
 * with.
 */
export function homeMarkdown(): string {
  /**
   * Frontmatter is the one thing added, and it is why this is not a byte-for
   * byte copy of `/llms.txt`. The two URLs are two documents about the same
   * thing, and only this one is a representation of a page: it has to name
   * the page it represents, or a reader holding only the bytes has no way
   * back to it.
   */
  const head = frontmatter({
    title: 'walletlink.social',
    description:
      'Resolve Ethereum wallet addresses to the X and Farcaster accounts their owners published, and back again.',
    canonical_url: `${PRODUCTION_URL}/`,
  });
  return `${head}\n\n${llmsTxtBody()}`;
}

/** The published post, exactly as its file was written. */
export function blogPostMarkdown(post: BlogPost): string {
  /**
   * `stripLeadingH1` is deliberately NOT applied. The page component strips
   * it because the page renders its own title from the frontmatter and would
   * otherwise ship two h1s; here the body is the whole document, and its own
   * heading is the only title in it.
   *
   * The frontmatter gray-matter removed is restored rather than prepended as
   * prose, for the same reason: a second `# Title` above the body's own would
   * give the document two top-level headings.
   */
  const head = frontmatter({
    title: post.title,
    description: post.description ?? null,
    date: post.publishedAt,
    // Carried when the post has one, for the same reason the HTML page emits
    // dateModified only then: a twin that publishes only the original date
    // tells a reader the post has never been revised, while the page beside
    // it says otherwise.
    updated_date: post.updatedAt ?? null,
    canonical_url: `${PRODUCTION_URL}/blog/${post.slug}`,
  });
  return `${head}\n\n${post.content.trim()}\n`;
}

/** The blog index: every published post, newest first, from its frontmatter. */
export function blogIndexMarkdown(posts: BlogPost[]): string {
  const head = frontmatter({
    title: 'walletlink.social blog',
    description:
      'Guides and findings on resolving wallet addresses to the social accounts their owners published.',
    canonical_url: `${PRODUCTION_URL}/blog`,
  });

  const entries = posts.map((post) => {
    const line = `- [${post.title}](${PRODUCTION_URL}/blog/${post.slug}), ${post.publishedAt}`;
    return post.description ? `${line}\n  ${post.description}` : line;
  });

  const body =
    entries.length > 0 ? entries.join('\n') : 'No posts are published yet.';

  return `${head}\n\n# Blog\n\nEach post is also available as markdown at its own URL, with \`.md\` appended or by asking for \`Accept: text/markdown\`.\n\n${body}\n`;
}

/**
 * Pricing, from the constants and no further.
 *
 * The FAQ the HTML page renders is not reproduced here, and that is the rule
 * rather than an omission: those answers are editorial prose whose only
 * source is that page, so a copy of them here would be the drift this file's
 * header exists to prevent. The link below is the honest way to carry them.
 */
export function pricingMarkdown(): string {
  const head = frontmatter({
    title: 'walletlink.social pricing: what a match costs',
    description: `Credit packs bought once, metered in matches. Free is ${FREE_MATCHES_PER_WINDOW} matches in a rolling ${FREE_WINDOW_DAYS}-day window.`,
    canonical_url: `${PRODUCTION_URL}/pricing`,
  });

  const rows = PACK_IDS.map((id) => {
    const pack = PACKS[id];
    const price = `$${pack.priceCents / 100}`;
    const perMatch = `$${(pack.priceCents / 100 / pack.matches).toFixed(3)}`;
    return `| ${pack.name} | ${price} | ${pack.matches.toLocaleString()} | ${perMatch} | ${pack.fits} |`;
  });

  const api = API_PLANS[CREDIT_API_PLAN];
  const example = 10_000;
  const exampleMatches = Math.round(example * MEASURED_MATCH_RATE);

  return `${head}

# Pricing

${MATCH_SENTENCE} That is the billing unit, on the site and through the API alike, so an unpromising list is cheap to try and splitting one saves nothing.

| Pack | Price | Matches | Per match | Fits |
| --- | --- | --- | --- | --- |
${rows.join('\n')}

Packs are bought once, not subscribed to. Credits last ${CREDIT_LIFETIME_MONTHS} months from purchase.

## Free allowance

${FREE_MATCHES_PER_WINDOW} matches in a rolling ${FREE_WINDOW_DAYS}-day window, and it bills what it delivers: the allowance is spent on matches, so a list that resolves to nothing costs nothing against it.

## What a list costs, worked through

At the measured match rate of ${(MEASURED_MATCH_RATE * 100).toFixed(1)}%, ${example.toLocaleString()} addresses resolve to roughly ${exampleMatches.toLocaleString()} matches. The rate is an estimate for planning and never bills anybody: you are charged for the matches that come back, whatever the number turns out to be.

## API limits on a credit plan

- ${api.requestsPerMinute.toLocaleString()} requests per minute
- ${api.requestsPerDay.toLocaleString()} requests per day
- ${api.requestsPerMonth.toLocaleString()} requests per month
- ${api.maxBatchSize.toLocaleString()} addresses per batch call

The questions people ask before buying, and the answers, are on the HTML page at ${PRODUCTION_URL}/pricing. They are written prose rather than derived from anything, so they are not restated here where they would drift.
`;
}

/** The holder-report hub: every collection currently above the listing floor. */
export function holdersIndexMarkdown(
  collections: ListedHolderCollection[]
): string {
  const head = frontmatter({
    title: 'Token and NFT holder reachability reports',
    description:
      'How many holders of a collection resolve to an X handle or a Farcaster account their owner published, and how many of those still reach somebody.',
    canonical_url: `${PRODUCTION_URL}/holders`,
  });

  const rows = collections.map((collection) => {
    const url = `${PRODUCTION_URL}/holders/${collection.chain}/${collection.address}`;
    return `| [${collection.name}](${url}) | ${chainLabel(collection.chain)} | ${collection.reachableAny.toLocaleString()} |`;
  });

  return `${head}

# Holder reachability reports

Aggregates only. No wallet list and no handle list is published on any report, here or on the reports themselves.

A collection appears here once at least ${LISTING_MIN_REACHABLE} of its holders are reachable. Below that, the number would be reporting how little measuring has happened rather than anything about the collection, so it is withheld rather than published as a finding. A report stays live at its own URL whether or not it is listed here.

| Collection | Chain | Reachable holders |
| --- | --- | --- |
${rows.join('\n')}
`;
}

/**
 * One collection's report.
 *
 * Every disclosure rule the HTML page obeys is obeyed here by calling the
 * same predicate, never by restating it: `holderBasis` decides what was
 * measured, `holderBasisCaveat` carries the hedge, `measurementInProgress`
 * marks a rate as a lower bound, and `isNamed` decides whether this document
 * may be indexed at all. The one rule with no helper behind it is the
 * absolute one, and it is kept by having nothing to keep: no wallet and no
 * handle is in scope in this function.
 */
export function holderReportMarkdown(
  collection: HolderCollection,
  stats: HolderStats,
  overlap: HolderOverlap[]
): string {
  const chain = chainLabel(collection.chain);
  const basis = holderBasis(collection);
  const caveat = holderBasisCaveat(basis);
  const measured = stats.holderCount.toLocaleString();
  const population = holderBasisPhrase(basis, {
    measuredNoun: 'addresses',
    ofCollection: ` holding ${collection.name}`,
  });
  const reachablePct =
    stats.holderCount > 0
      ? Math.round((stats.reachableAny / stats.holderCount) * 1000) / 10
      : 0;
  const inProgress = measurementInProgress(stats);

  const head = frontmatter({
    title: `${collection.name} holder reachability on ${chain}`,
    description: `Reachability measured over ${population} on ${chain}.`,
    dataset_confirmed_onchain: collection.lastSeenAt
      ? collection.lastSeenAt.slice(0, 10)
      : null,
    canonical_url: `${PRODUCTION_URL}/holders/${collection.chain}/${collection.address}`,
  });

  const notes = [
    caveat,
    inProgress
      ? `${stats.checked.toLocaleString()} of the ${measured} measured addresses have been checked so far, so every rate below is a lower bound that rises as the rest are checked.`
      : null,
    'Aggregates only: no wallet list and no handle list is published.',
  ].filter((note): note is string => note !== null);

  const neighbors =
    overlap.length > 0
      ? `\n\n## Collections these holders also hold\n\n${overlap
          .map(
            (other) =>
              `- [${other.name}](${PRODUCTION_URL}/holders/${other.chain}/${other.address}) on ${chainLabel(other.chain)}: ${other.sharedHolders.toLocaleString()} shared holders`
          )
          .join('\n')}`
      : '';

  return `${head}

# ${collection.name} holder reachability on ${chain}

Measured over ${population}. ${notes.join(' ')}

| Measure | Value |
| --- | --- |
| Addresses measured | ${measured} |
| Reachable on X or Farcaster | ${stats.reachableAny.toLocaleString()} (${reachablePct}%) |
| Carrying an X handle | ${stats.withTwitter.toLocaleString()} |
| Carrying a Farcaster account | ${stats.withFarcaster.toLocaleString()} |
| X handles live | ${stats.xLive.toLocaleString()} |
| X handles suspended | ${stats.xSuspended.toLocaleString()} |
| X handles nobody holds | ${stats.xUnclaimed.toLocaleString()} |

${standardLabel(collection.contractType, collection.chain, collection.address)} contract at ${collection.address} on ${chain}.${neighbors}
`;
}

/** Whether this report may be indexed, decided by the rule the page uses. */
export function holderReportIsIndexable(collection: HolderCollection): boolean {
  return isNamed(collection.name);
}
