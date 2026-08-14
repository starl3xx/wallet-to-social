#!/usr/bin/env node
/**
 * Tests the palette guard against fixtures.
 *
 * This exists because the guard has silently reported clean over live violations
 * twice:
 *
 *   1. Its selector required whitespace immediately before the class, so
 *      `prose-blockquote:border-l-emerald-500` sat in the blog page undetected
 *      while the check passed.
 *   2. Its family list held only the 17 chromatic families, so `bg-gray-500`
 *      (colouring the agent badge), `text-neutral-400` (the blog hero) and 16
 *      others were invisible to both the rule and CI.
 *
 * Both times the guard was verified against the code it was meant to bless, which
 * proves nothing: code that already passes will always pass. A guard has to be
 * shown a violation it must catch and a valid string it must not flag.
 *
 * Run: node scripts/check-palette-guard.mjs
 */

import { readFileSync } from 'fs';

const config = readFileSync(new URL('../eslint.config.mjs', import.meta.url), 'utf8');

const palette = config.match(/const TAILWIND_PALETTE =\s*\n\s*'(\(\?:[^']+\))';/)?.[1];
const shape = config.match(/const PALETTE_CLASS = `([^`]+)`/)?.[1];
if (!palette || !shape) {
  console.error('FAIL: could not read TAILWIND_PALETTE / PALETTE_CLASS from eslint.config.mjs');
  process.exit(1);
}

const PALETTE_CLASS = shape.replace('${TAILWIND_PALETTE}', palette);
const re = new RegExp(`(^|\\s)${PALETTE_CLASS}(\\/[0-9]{1,3})?(\\s|$)`);

// Must be caught. Each entry is a shape that has actually shipped or nearly did.
const BAD = [
  ['bg-gray-500', 'bare neutral — coloured the agent badge'],
  ['text-neutral-400', 'neutral on the blog hero'],
  ['bg-gray-100 text-gray-800', 'neutral pair on an admin chip'],
  ['dark:bg-gray-800', 'neutral behind a dark: variant'],
  ['bg-slate-50', 'slate'],
  ['text-zinc-700', 'zinc'],
  ['border-stone-300', 'stone'],
  ['text-green-500', 'chromatic, the original case'],
  ['hover:text-green-500', 'variant occupies the leading slot'],
  ['prose-blockquote:border-l-emerald-500', 'directional suffix behind a prose variant'],
  ['bg-red-500/50', 'opacity suffix'],
  ['sm:dark:hover:bg-blue-600', 'stacked variants'],
  ['flex items-center bg-amber-100 rounded', 'mid-string'],
];

// Must NOT be caught. Semantic tokens and lookalikes.
const GOOD = [
  ['bg-accent-brand', 'brand token'],
  ['bg-accent-brand-tint', 'brand tint'],
  ['text-attested', 'attested token'],
  ['bg-attested-tint', 'attested tint'],
  ['text-caution', 'caution token'],
  ['bg-destructive text-destructive-foreground', 'destructive pair'],
  ['bg-muted text-muted-foreground', 'muted pair'],
  ['bg-surface-inverse text-surface-inverse-muted', 'inverse surface tokens'],
  ['grid-cols-3 gap-4 rounded-lg', 'layout utilities'],
  ['text-neutral', 'family name with no shade is not a palette class'],
  ['bg-gray', 'ditto'],
  ['duration-200 ease-out', 'motion utilities'],
];

let failed = 0;
for (const [s, why] of BAD) {
  if (!re.test(s)) { console.error(`FAIL  missed:      ${s.padEnd(42)} ${why}`); failed++; }
}
for (const [s, why] of GOOD) {
  if (re.test(s)) { console.error(`FAIL  false alarm: ${s.padEnd(42)} ${why}`); failed++; }
}

if (failed) {
  console.error(`\n${failed} fixture(s) failed. The guard does not do what it claims.`);
  process.exit(1);
}
console.log(`palette guard ok — ${BAD.length} violations caught, ${GOOD.length} valid strings passed`);
