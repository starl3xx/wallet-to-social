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

import { readFileSync } from 'fs';

/* ---------- OKLCH -> sRGB (Björn Ottosson's matrices) ---------- */

function oklchToRgb(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;

  const lin = [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];

  // Gamma-encode, then clamp. Clamping after encoding is what a browser does
  // when a colour falls outside sRGB, and several brand tones here do.
  return lin.map((v) => {
    const enc = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(enc * 255)));
  });
}

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

const hex = ([r, g, b]) =>
  '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

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
    console.error(`FIXTURE FAIL  oklch(${L} ${C} ${h}) -> ${got}, expected ${expected}`);
    failed++;
  }
}
// And the ratio itself, against a value measured in the browser.
{
  const r = contrast(oklchToRgb(0.985, 0, 0), oklchToRgb(0.145, 0, 0));
  if (Math.abs(r - 18.97) > 0.05) {
    console.error(`FIXTURE FAIL  body-text ratio ${r.toFixed(2)}, expected ~18.97`);
    failed++;
  }
}
if (failed) {
  console.error(`\n${failed} fixture(s) failed. The colour conversion is wrong, so every number below would be too.`);
  process.exit(1);
}

/* ---------- read the real tokens ---------- */

const css = readFileSync('app/globals.css', 'utf8');

function block(selector) {
  const re = new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\}`, 'm');
  const m = css.match(re);
  if (!m) throw new Error(`Could not find the ${selector} block in app/globals.css`);
  return m[1];
}

function token(body, name) {
  const m = body.match(new RegExp(`--${name}:\\s*oklch\\(([^)]+)\\)`));
  if (!m) return null;
  const parts = m[1].trim().split(/[\s/]+/);
  if (m[1].includes('/')) return { alpha: true };
  const [L, C, h] = parts;
  return oklchToRgb(parseFloat(L), parseFloat(C || 0), parseFloat(h || 0));
}

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
      hits.push(`${theme} ${label}: token --${!a ? fg : bg} not found as an opaque oklch value`);
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
