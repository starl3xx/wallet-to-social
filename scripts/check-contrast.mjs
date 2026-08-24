#!/usr/bin/env node
/**
 * Guards colour contrast in both themes.
 *
 * The other two guards ask "is this value on-system?". Neither can ask "can a
 * person see it?", and that is a different question with a numeric answer, so it
 * belongs in a script rather than in review. The control boundary sat at 1.26:1
 * in light and 1.48:1 in dark for the life of the project: every token involved
 * was on-system, the palette guard passed, and an empty text field was a
 * rectangle you had to already know was there.
 *
 * Reads the tokens straight out of `app/globals.css`, so it cannot drift from
 * what ships. Converts OKLCH to sRGB and applies WCAG 2.1 relative luminance.
 *
 * The conversion is checked against fixtures measured in Chrome, because a
 * colour-space implementation that is subtly wrong produces plausible numbers
 * and would bless exactly what it exists to catch.
 *
 * Run: node scripts/check-contrast.mjs
 */

// The conversion and the token reader live in `scripts/lib/oklch.mjs` so that
// `check-og-palette.mjs` uses the same ones. The fixtures below stay here: this
// script owns them, runs them before anything else, and both guards run in the
// same CI job, so a drifted conversion fails here first.
import { oklchToRgb, hex, readTokens } from './lib/oklch.mjs';

const relLuminance = ([r, g, b]) =>
  [r, g, b]
    .map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    })
    .reduce((acc, c, i) => acc + c * [0.2126, 0.7152, 0.0722][i], 0);

function contrast(a, b) {
  const [hi, lo] = [relLuminance(a), relLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/* ---------- fixtures: the conversion must reproduce these ---------- */

const FIXTURES = [
  [[0.145, 0, 0], '#0a0a0a'],
  [[0.205, 0, 0], '#171717'],
  [[0.985, 0, 0], '#fafafa'],
  [[0.64, 0, 0], '#8c8c8c'],
  [[0.55, 0, 0], '#717171'],
  [[0.68, 0.19, 280], '#8585ff'],
  [[0.42, 0.19, 280], '#4131b0'],
];

let failed = 0;
for (const [[L, C, h], expected] of FIXTURES) {
  const got = hex(oklchToRgb(L, C, h));
  if (got !== expected) {
    console.error(
      `FIXTURE FAIL  oklch(${L} ${C} ${h}) -> ${got}, expected ${expected}`
    );
    failed++;
  }
}
// And the ratio itself, against a value measured in the browser.
{
  const r = contrast(oklchToRgb(0.985, 0, 0), oklchToRgb(0.145, 0, 0));
  if (Math.abs(r - 18.97) > 0.05) {
    console.error(
      `FIXTURE FAIL  body-text ratio ${r.toFixed(2)}, expected ~18.97`
    );
    failed++;
  }
}
if (failed) {
  console.error(
    `\n${failed} fixture(s) failed. The colour conversion is wrong, so every number below would be too.`
  );
  process.exit(1);
}

/* ---------- read the real tokens ---------- */

const { block, token } = readTokens('app/globals.css');

const THEMES = { light: block(':root'), dark: block('\\.dark') };

/**
 * `need` follows WCAG 2.1: 4.5 for body text, 3.0 for the visual information
 * needed to identify a control. Purely decorative separation (`--border` on a
 * card, a table rule) is exempt and is deliberately absent from this list.
 */
const PAIRS = [
  ['body text', 'foreground', 'background', 4.5],
  ['muted text on page', 'muted-foreground', 'background', 4.5],
  ['muted text on card', 'muted-foreground', 'card', 4.5],
  ['brand text', 'accent-brand', 'background', 4.5],
  ['brand button label', 'accent-brand-foreground', 'accent-brand', 4.5],
  ['attested', 'attested', 'background', 4.5],
  ['attested on card', 'attested', 'card', 4.5],
  ['caution', 'caution', 'background', 4.5],
  ['destructive', 'destructive', 'background', 4.5],
  // The control boundary, against every surface a control sits on.
  ['control edge on page', 'input', 'background', 3.0],
  ['control edge on card', 'input', 'card', 3.0],
  ['control edge on muted', 'input', 'muted', 3.0],
  ['focus ring', 'ring', 'background', 3.0],
];

const hits = [];
for (const [theme, body] of Object.entries(THEMES)) {
  for (const [label, fg, bg, need] of PAIRS) {
    const a = token(body, fg);
    const b = token(body, bg);
    if (!a || !b) {
      hits.push(
        `${theme} ${label}: token --${!a ? fg : bg} not found as an opaque oklch value`
      );
      continue;
    }
    if (a.alpha || b.alpha) {
      hits.push(
        `${theme} ${label}: --${a.alpha ? fg : bg} is translucent, so its contrast depends on whatever is behind it. A control boundary must be opaque.`
      );
      continue;
    }
    const r = contrast(a, b);
    if (r < need) {
      hits.push(
        `${theme} ${label}: ${hex(a)} on ${hex(b)} = ${r.toFixed(2)}:1, needs ${need.toFixed(1)}:1`
      );
    }
  }
}

if (hits.length) {
  console.error('Contrast failures:\n');
  for (const h of hits) console.error('  ' + h);
  console.error('\nSee docs/DESIGN-LANGUAGE.md, Colour.');
  process.exit(1);
}

console.log(
  `contrast ok — ${PAIRS.length * 2} pairs across both themes meet WCAG AA (4.5:1 text, 3:1 controls)`
);
