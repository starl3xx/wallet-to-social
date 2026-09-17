#!/usr/bin/env node
/**
 * Guards the house style in text a person reads.
 *
 * `CLAUDE.md` declares the house style as a standing rule and, until this
 * file, nothing enforced any of it. That is the shape of rule this repo has
 * learned to distrust: it held for as long as whoever was writing happened to
 * remember it, and the evidence that it had stopped holding was sitting in the
 * published copy. The product spelled its own signature phrase two ways
 * ("labelled" in twenty-three places, "labeled" in the two written most
 * recently), shipped fifteen three-dot ellipses in loading copy, and put a
 * hyphen where a colon belonged in the message every job shows on submit.
 *
 * ## What counts as text a person reads
 *
 * Only that. Not identifiers, not code comments, not data values.
 *
 * The distinction is load-bearing and it is why this file is longer than the
 * regexes in it. `'cancelled'` is a job status persisted in Postgres and
 * returned by the API, so "correcting" it is a breaking change wearing a
 * spelling fix's clothes. `aria-labelledby` is an HTML attribute. `optimism`
 * is a chain. `normaliseTwitterRecord` is a function somebody has to grep for.
 * A first draft that swept all of those up would have been rejected on sight,
 * and rightly: a guard that cannot tell prose from code teaches people to
 * ignore it.
 *
 * So the scan reads three things and nothing else:
 *
 *   1. JSX text nodes: between `>` and `<`, containing no braces. This is
 *      copy by construction.
 *   2. String literals that look like prose, which here means they contain a
 *      space and a letter, minus an exclusion list for the shapes that pass
 *      that test and are not prose (paths, mime types, class strings, SQL).
 *   3. Markdown and MDX outside fenced code blocks, plus `docs-site/`, the
 *      README and PROJECT_OVERVIEW.
 *
 * Code comments are deliberately out of scope. The tree holds 139 em dashes
 * in comments, and rewriting them would produce a diff touching most of the
 * repository to change nothing anybody reads on a screen. The house style
 * exists to make the product read as one voice; a comment is not the product.
 *
 * Run: node scripts/check-house-style.mjs
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * British spellings, and only ones with no innocent reading.
 *
 * Every entry here was checked against the tree before it was added. The ones
 * that are NOT here matter as much as the ones that are:
 *
 *   `cancelled`  a persisted job status and an API value (`lib/types.ts`,
 *                `lib/farcaster-dm.ts`, the jobs route). Renaming it is a
 *                migration, not a spelling fix.
 *   `grey`       appears only inside `greyscale` in a comment about font
 *                smoothing, and as nothing else.
 *   `licence`    no hits, and the noun/verb split makes it a false-positive
 *                factory next to "license" the verb, which is correct in both
 *                dialects.
 *   `towards`    accepted in American English. It is a preference, not an
 *                error, and this guard only fires on errors.
 *
 * `labell(ed|ing)` carries a negative lookbehind for `aria-`, because
 * `aria-labelledby` is the attribute's real name in every dialect.
 */
const BRITISH = [
  [/(?<!aria-)\blabell(?:ed|ing)\b/i, 'labeled / labeling'],
  [/\bbehaviours?\b/i, 'behavior'],
  [/\bcolour(?:s|ed|ing)?\b/i, 'color'],
  [/\bcentres?\b/i, 'center'],
  [/\borganis(?:e|es|ed|ing|ation|ations)\b/i, 'organize / organization'],
  [/\brecognis(?:e|es|ed|ing|able)\b/i, 'recognize'],
  [/\boptimis(?:e|es|ed|ing|ation|ations)\b/i, 'optimize / optimization'],
  [/\bcustomis(?:e|es|ed|ing|ation)\b/i, 'customize'],
  [/\bnormalis(?:e|es|ed|ing|ation)\b/i, 'normalize'],
  [/\bsummaris(?:e|es|ed|ing)\b/i, 'summarize'],
  [/\bprioritis(?:e|es|ed|ing)\b/i, 'prioritize'],
  [/\bcatalogues?\b/i, 'catalog'],
  [/\bfavourites?\b/i, 'favorite'],
  [/\bdefence\b/i, 'defense'],
  [/\bwhilst\b/i, 'while'],
];

const RULES = [
  {
    name: 'ellipsis',
    re: /\.\.\./,
    msg: 'Use the ellipsis character “…”, not three periods. It is one glyph with its own spacing, and a screen reader reads it as an ellipsis rather than as three full stops.',
  },
  {
    name: 'em-dash',
    re: /—|&mdash;/,
    msg: 'No em dashes (CLAUDE.md, House style). Use the mark the sentence wants: a colon, a semicolon, a comma or brackets.',
  },
  {
    name: 'onchain',
    re: /\bon[-\s]chain\b/i,
    msg: '“onchain” is one word (CLAUDE.md, House style). Same for “offchain”.',
  },
  {
    name: 'straight-apostrophe',
    // Only between letters, so "don't" fires and a possessive-free string of
    // code punctuation does not.
    re: /[A-Za-z]'[A-Za-z]/,
    /**
     * UI copy only, and that scoping is the rule rather than an exemption.
     *
     * CLAUDE.md says "curly apostrophes in UI text", and it means the UI: a
     * Markdown source file is not the rendered thing, and every engineering
     * doc in this repo writes possessives straight. Running this over
     * `docs-site/` and PROJECT_OVERVIEW produced fourteen hits that were all
     * correct Markdown, which is how a guard trains people to skip its output.
     */
    uiOnly: true,
    msg: "Curly apostrophes in copy (CLAUDE.md, UI Guidelines): “We’ll”, not “We'll”.",
  },
  {
    name: 'hyphen-as-dash',
    // " - " standing in for a colon or a dash between two clauses.
    re: /[a-z,)] - [a-z(]/,
    msg: 'A spaced hyphen is not a dash. Use a colon, a semicolon or a comma; the house style bans the em dash that would otherwise go here.',
  },
  {
    name: 'british-spelling',
    re: null, // handled by BRITISH, below
    msg: 'American English (memory: house preference). ',
  },
];

/**
 * Shapes that contain a space and a letter and are still not prose.
 *
 * The last entry is the subtle one and it fixes a real false positive rather
 * than a hypothetical. Quote matching here is naive by necessity (a real
 * parser is not worth it for a style guard), so on a line like
 *
 *   return [headers.join(','), ...rows].join('\n');
 *
 * the CLOSING quote of `','` pairs with the OPENING quote of `'\n'`, and the
 * code between them arrives as a four-plus character "string" with a space and
 * letters in it: `), ...rows].join(`. It has no innocent reading as copy, and
 * neither does anything else carrying `].`, `).`, `](`, `)(` or `=>`.
 *
 * The cost is that a sentence ending in a parenthetical full stop, "(see
 * below).", is skipped. That is a missed check, never a false alarm, which is
 * the right direction for a guard to fail in.
 */
const NOT_PROSE = [
  /^[\w-]+\/[\w-]+$/, // mime types, paths
  /^[A-Za-z-]+:\s*[\w(]/, // css declarations
  /\bSELECT\b|\bFROM\b|\bWHERE\b|\bINSERT\b|\bCREATE\b/i, // SQL
  /^[a-z-]+(?:\s+[a-z0-9:[\]/.%-]+)+$/, // tailwind class strings
  /^\s*[\d.]+\s/, // version-ish
  /https?:\/\//, // urls, which carry their own spelling
  /\]\.|\)\.|\]\(|\)\(|=>/, // see below
];

const isProse = (s) =>
  / /.test(s) && /[A-Za-z]{2}/.test(s) && !NOT_PROSE.some((r) => r.test(s));

/** Blank comments, preserving length and newlines so offsets still map. */
export function blankComments(src) {
  const blank = (m) => m.replace(/[^\n]/g, ' ');
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(
      /(^|[^:])\/\/[^\n]*/g,
      (m, lead) => lead + blank(m.slice(lead.length))
    );
}

/** Blank fenced code blocks and inline code in Markdown, same contract. */
export function blankCode(src) {
  const blank = (m) => m.replace(/[^\n]/g, ' ');
  return src.replace(/```[\s\S]*?```/g, blank).replace(/`[^`\n]*`/g, blank);
}

/** Every stretch of a .tsx file that is copy, as [text, offset] pairs. */
export function copySpans(src) {
  const bare = blankComments(src);
  const spans = [];
  /**
   * The `(?<![=\-!<>])` is load-bearing and was not in the first draft.
   *
   * Without it the `>` of an arrow function opens a span, so
   * `setRows((prev) => [...prev, ...next]);` followed by any JSX on a later
   * line reads as one long "text node" full of code. The first version of this
   * guard reported a three-dot ellipsis in a spread because of exactly that,
   * which is the kind of false positive that gets a guard switched off. `!=`,
   * `<=`, `>=` and `->` are excluded for the same reason.
   *
   * The `;`/`=` rejection below is the second fence: JSX text does not contain
   * either, and code that slips past the lookbehind almost always does.
   */
  for (const m of bare.matchAll(/(?<![=\-!<>])>([^<>{}]*[A-Za-z][^<>{}]*)</g)) {
    if (/[;=]/.test(m[1])) continue;
    // A spread reached one more span than the lookbehind caught:
    // `[...header), ...rows].join(`. Copy does not contain `[...name`.
    if (/[[({,]\s*\.\.\.[A-Za-z_$]/.test(m[1])) continue;
    spans.push([m[1], m.index + 1]);
  }
  for (const m of bare.matchAll(/(['"])((?:[^'"\\\n]|\\.){4,})\1/g))
    if (isProse(m[2])) spans.push([m[2], m.index + 1]);
  return spans;
}

function fire(rule, text) {
  if (rule.name !== 'british-spelling') return rule.re.test(text);
  return BRITISH.some(([re]) => re.test(text));
}

function detail(rule, text) {
  if (rule.name !== 'british-spelling') return rule.msg;
  const hit = BRITISH.find(([re]) => re.test(text));
  return rule.msg + `Write “${hit[1]}”.`;
}

// ---------------------------------------------------------------- fixtures

const FIXTURES = {
  ellipsis: {
    bad: ['Loading...', 'Submitting job...', 'Paste addresses...'],
    // Three dots in copy is always the violation, so there is no "good" form
    // of it beyond the corrected one. What keeps `{...props}` and `[...prev]`
    // out is the extractor, not this rule: JSX text spans exclude braces, and
    // a spread is not a prose string. That is tested below, against the
    // extractor, which is where the work actually happens.
    good: ['Loading…', 'Submitting job…', 'a range 1–5'],
  },
  'em-dash': {
    bad: ['one thing — and another', 'one thing &mdash; another'],
    good: ['one thing: another', 'a hyphen-joined word', 'a range 1–5'],
  },
  onchain: {
    bad: ['an on-chain record', 'stored On-Chain', 'kept on chain forever'],
    good: ['an onchain record', 'offchain data', 'the chain on which it runs'],
  },
  'straight-apostrophe': {
    bad: ["We'll send it", "it's here", "don't do that"],
    good: ['We’ll send it', 'it’s here', "a 'quoted' word"],
  },
  'hyphen-as-dash': {
    bad: ['Job queued - processing will start', 'done, - and then more'],
    good: [
      'Job queued: processing will start',
      'a well-known name',
      'the 0x-prefixed form',
    ],
  },
  'british-spelling': {
    bad: [
      'every match is labelled',
      'the same behaviour',
      'a brand colour',
      'we recognise it',
      'not an optimisation',
      'ENS normalises to lowercase',
    ],
    good: [
      'every match is labeled',
      'the same behavior',
      'a brand color',
      'we recognize it',
      // The ones deliberately left alone.
      'aria-labelledby points at it',
      'the job was cancelled',
      'we cover Optimism',
      'moving towards a fix',
    ],
  },
};

let failed = 0;
for (const rule of RULES) {
  const f = FIXTURES[rule.name];
  for (const s of f.bad)
    if (!fire(rule, s)) {
      console.error(`FIXTURE FAIL  ${rule.name} missed: ${JSON.stringify(s)}`);
      failed++;
    }
  for (const s of f.good)
    if (fire(rule, s)) {
      console.error(
        `FIXTURE FAIL  ${rule.name} false alarm: ${JSON.stringify(s)}`
      );
      failed++;
    }
}

// The extractor is the part that decides what gets read at all, so it is
// tested harder than the regexes are. A miss here reports a clean codebase.
{
  const src = [
    '/** Do not write Loading... in a comment. */',
    'const a = 1; // nor on-chain here',
    '<p>Loading...</p>',
    "const msg = 'Submitting job...';",
    "const cls = 'flex items-center gap-2';",
    "const path = 'text/csv';",
    "const url = 'https://x.com/a-b';",
    'setRows((prev) => [...prev, ...next]);',
    '<Thing {...props} />',
  ].join('\n');
  const spans = copySpans(src);
  const texts = spans.map((s) => s[0]);
  const want = ['Loading...', 'Submitting job...'];
  for (const w of want)
    if (!texts.includes(w)) {
      console.error(`FIXTURE FAIL  extractor missed copy: ${w}`);
      failed++;
    }
  for (const t of texts)
    if (/comment|nor on-chain/.test(t)) {
      console.error(`FIXTURE FAIL  extractor read a comment: ${t}`);
      failed++;
    }
  for (const t of texts)
    if (/flex items-center|text\/csv|https:/.test(t)) {
      console.error(`FIXTURE FAIL  extractor read code as prose: ${t}`);
      failed++;
    }
  // A spread is three dots and is never copy. This is what keeps the ellipsis
  // rule off `{...props}` and `[...prev]`, and it is the reason that rule has
  // no "good" fixture of its own.
  for (const t of texts)
    if (/\.\.\.(?:props|prev|next)/.test(t)) {
      console.error(`FIXTURE FAIL  extractor read a spread as copy: ${t}`);
      failed++;
    }
  // Offsets must map to the real line.
  const loading = spans.find((s) => s[0] === 'Loading...');
  if (src.slice(0, loading[1]).split('\n').length !== 3) {
    console.error('FIXTURE FAIL  extractor offset points at the wrong line');
    failed++;
  }
}
{
  const md = ['Say onchain here.', '```', 'on-chain in a fence', '```'].join(
    '\n'
  );
  const out = blankCode(md);
  if (/on-chain/.test(out)) {
    console.error('FIXTURE FAIL  blankCode left a fenced block readable');
    failed++;
  }
  if (out.split('\n').length !== md.split('\n').length) {
    console.error('FIXTURE FAIL  blankCode lost a newline');
    failed++;
  }
}

if (failed) {
  console.error(
    `\n${failed} fixture(s) failed. The guard does not do what it claims.`
  );
  process.exit(1);
}

// ------------------------------------------------------------------- scan

function walk(dir, out = [], exts) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (e !== 'node_modules' && e !== '.next') walk(p, out, exts);
    } else if (exts.some((x) => p.endsWith(x))) out.push(p);
  }
  return out;
}

const hits = [];
const record = (file, offsetSrc, index, rule, text) =>
  hits.push({
    file,
    line: offsetSrc.slice(0, index).split('\n').length,
    rule: rule.name,
    msg: detail(rule, text),
    text: text.trim().replace(/\s+/g, ' ').slice(0, 80),
  });

for (const file of walk('app', [], ['.tsx', '.ts']).concat(
  walk('components', [], ['.tsx', '.ts']),
  walk('lib', [], ['.tsx', '.ts'])
)) {
  const src = readFileSync(file, 'utf8');
  for (const [text, index] of copySpans(src))
    for (const rule of RULES)
      if (fire(rule, text)) record(file, src, index, rule, text);
}

for (const file of walk('docs-site', [], ['.mdx', '.md', '.json']).concat([
  'README.md',
  'PROJECT_OVERVIEW.md',
])) {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  const bare = file.endsWith('.json') ? raw : blankCode(raw);
  bare.split('\n').forEach((line, i) => {
    for (const rule of RULES)
      if (!rule.uiOnly && fire(rule, line))
        hits.push({
          file,
          line: i + 1,
          rule: rule.name,
          msg: detail(rule, line),
          text: line.trim().slice(0, 80),
        });
  });
}

if (!hits.length) {
  console.log(
    `house style ok — ${RULES.length} rules over UI copy, docs-site, README and PROJECT_OVERVIEW`
  );
  process.exit(0);
}
for (const h of hits)
  console.error(`${h.file}:${h.line}  [${h.rule}]  ${h.text}\n    ${h.msg}`);
console.error(`\n${hits.length} violation(s). See CLAUDE.md, House style.`);
process.exit(1);
