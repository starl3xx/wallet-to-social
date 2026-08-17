#!/usr/bin/env node
/**
 * Guards the colours that CANNOT be tokens.
 *
 * Two surfaces render outside the CSS cascade and so cannot use `var(--token)`
 * at all: Satori, which draws every `next/og` share card from an inline style
 * object, and HTML email, where clients strip custom properties. Both therefore
 * have to write literal colours, and both had drifted.
 *
 * The existing guards could not have caught it. `check-design-language.mjs` and
 * the ESLint rule walk `app` and `components` only and match Tailwind class
 * names, so `lib/og-fonts.ts` and `lib/email.ts` were outside their file scope
 * and a hex literal was outside their pattern. `check-contrast.mjs` reads
 * `globals.css` and never opens a source file. The result was a palette object
 * whose own comment said it existed to stop drift, holding eleven values of
 * which two matched the token they stood for.
 *
 * WHAT THIS CHECKS. Every literal colour on those two surfaces must equal a
 * real token, converted from the oklch in `app/globals.css` at run time rather
 * than copied. A guard with its own table of values guards the table.
 *
 * EXCEPTIONS ARE NAMED, NOT INFERRED. A card treatment with no token
 * equivalent, such as the dark card's violet gradient, is legitimate. It is
 * listed below by value with a reason, so it stays a decision somebody made
 * rather than a value nobody checked. Anything not listed and not a token
 * fails.
 *
 * Run: node scripts/check-og-palette.mjs
 */

import { readFileSync } from 'fs';
import { readTokens, hex } from './lib/oklch.mjs';

const { block, token } = readTokens('app/globals.css');
const THEMES = { light: block(':root'), dark: block('\\.dark') };

/** Every opaque token value, in both themes, as a lookup from hex to name. */
const allowed = new Map();
for (const [theme, body] of Object.entries(THEMES)) {
  for (const m of body.matchAll(/--([a-z0-9-]+):\s*oklch\(/g)) {
    const rgb = token(body, m[1]);
    if (!rgb || rgb.alpha) continue;
    const h = hex(rgb);
    if (!allowed.has(h)) allowed.set(h, `--${m[1]} (${theme})`);
  }
}

/**
 * Values that are deliberately not tokens. Each needs a reason, and the reason
 * has to be about rendering rather than taste: "a token cannot express this".
 */
const EXCEPTIONS = new Map([
  [
    'radial-gradient(120% 140% at 12% 8%, #2a1f72 0%, #14122e 45%, #0b0d16 100%)',
    'the dark share card\'s ground is a designed gradient; no token is a gradient',
  ],
  [
    'rgba(57,191,137,0.20)',
    'a translucent wash so the card gradient shows through; built from --attested (dark)',
  ],
  // Platform identity, documented in CLAUDE.md. These identify a platform, not
  // an affordance, so they are deliberately outside the palette.
  ['#0f1419', 'X brand colour'],
  ['#8a63d2', 'Farcaster brand colour'],
]);

/** Surfaces that must write literals, and why they cannot do otherwise. */
const SURFACES = [
  { file: 'lib/og-fonts.ts', why: 'Satori resolves an inline style object with no CSS cascade' },
  { file: 'lib/email.ts', why: 'email clients strip CSS custom properties' },
  { file: 'app/blog/[slug]/opengraph-image.tsx', why: 'Satori share card' },
  { file: 'app/opengraph-image.tsx', why: 'Satori share card' },
];

// Hex, rgb()/rgba() and named gradients. Deliberately not matching `var(--x)`,
// which is the thing we want these files to use where they can.
const COLOUR = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|radial-gradient\([^;]*?\)(?=[,;\s'"`])/g;

let violations = 0;
let checked = 0;

for (const { file, why } of SURFACES) {
  let src;
  try {
    src = readFileSync(file, 'utf8');
  } catch {
    console.error(`MISSING  ${file} — the guard names a file that no longer exists`);
    violations++;
    continue;
  }

  const lines = src.split('\n');
  lines.forEach((line, i) => {
    // Skip comments: the doc blocks name tokens on purpose.
    const trimmed = line.trim();
    if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) return;

    for (const raw of line.match(COLOUR) ?? []) {
      const value = raw.toLowerCase().replace(/\s+/g, ' ');
      checked++;
      if (EXCEPTIONS.has(value)) continue;
      // Expand a 3-digit hex before comparing.
      const norm = /^#[0-9a-f]{3}$/.test(value)
        ? '#' + value.slice(1).split('').map((c) => c + c).join('')
        : value;
      if (allowed.has(norm)) continue;
      console.error(
        `${file}:${i + 1}  ${raw}  is neither a token nor a named exception\n` +
          `    (${why}, so a literal is fine, but it must be a token's value)`
      );
      violations++;
    }
  });
}

if (violations) {
  console.error(
    `\n${violations} colour(s) outside the token set.\n` +
      'Either use the token\'s value, or add it to EXCEPTIONS with a rendering reason.'
  );
  process.exit(1);
}

console.log(
  `og palette ok — ${checked} literal colours across ${SURFACES.length} files, ` +
    `all token values or named exceptions`
);
