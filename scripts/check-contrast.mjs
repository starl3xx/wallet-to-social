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
import { readFileSync } from 'fs';

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

/* ---------- the dark hairline, composited ---------- */
// Dark `--border` is translucent BY DESIGN (decorative separation, exempt from
// the 3:1 control rule), so the pair table above cannot hold it: the pair loop
// rejects any translucent token because its contrast depends on the surface.
// The hairline's aesthetic IS a function of composite contrast on the card, so
// that is what gets asserted. The floor is the measurement the old value set:
// white at 10% composited to 1.32:1 on the dark card, and the tinted-white
// retone may not dim below it. Composited in gamma-encoded sRGB, which is how
// a browser blends normal content.
{
  const body = THEMES.dark;
  const m = body.match(/--border:\s*oklch\(([^)]+)\)/);
  if (!m) {
    hits.push('dark hairline: --border not found as an oklch value');
  } else {
    const [colour, rawAlpha] = m[1].split('/').map((s) => s.trim());
    const [L, C, h] = colour.split(/\s+/).map(parseFloat);
    const alpha = rawAlpha
      ? rawAlpha.endsWith('%')
        ? parseFloat(rawAlpha) / 100
        : parseFloat(rawAlpha)
      : 1;
    const card = token(body, 'card');
    const line = oklchToRgb(L, C || 0, h || 0);
    const composited = line.map((v, i) =>
      Math.round(v * alpha + card[i] * (1 - alpha))
    );
    const r = contrast(composited, card);
    if (r < 1.32) {
      hits.push(
        `dark hairline on card: composite ${r.toFixed(2)}:1, must stay >= 1.32:1 (what the old white/10% measured)`
      );
    }
  }
}

/* ---------- the green fence: chip tints vs the reserved tints ---------- */
/**
 * A ChainChip's field is mixed from the chain's plate colour
 * (`CHAIN_PLATES` in components/ui/chain-marks.tsx). Green marks an attested
 * fact and violet marks an affordance, so a chip field that resolves within a
 * just-noticeable distance of `--attested-tint` or `--accent-brand-tint`
 * would let a brand impersonate the one distinction the product is sold on.
 *
 * Every declared percentage is re-measured here, per theme, and every `null`
 * (the fallback to `--fill-subtle`) is re-justified: an unnecessary fallback
 * is as loud as a missing one, so the table cannot rot in either direction.
 * The math proves itself first on Robinhood's lime plate, which measurably
 * sits inside the attested JND in light at every candidate percentage: if the
 * fence stops detecting that collision, it has stopped detecting collisions.
 */
const srgbToOklab = ([r8, g8, b8]) => {
  const [r, g, b] = [r8, g8, b8].map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
};
const hexToRgb = (h) => {
  h = h.replace('#', '');
  if (h.length === 3)
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};
const okMix = (a, b, t) => a.map((v, i) => v * t + b[i] * (1 - t));
const okDist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const FENCE = 0.04; // JND with margin; oklab distance
const FLOOR = 0.015; // below this the tint is not visibly a tint at all
const CANDIDATES = { light: [10, 12, 14, 16], dark: [14, 16, 18, 22] };

{
  const src = readFileSync('components/ui/chain-marks.tsx', 'utf8');
  const plateRe =
    /(\w+):\s*\{\s*hex:\s*'(#[0-9A-Fa-f]{3,6})',\s*light:\s*(\d+|null),\s*dark:\s*(\d+|null)\s*\}/g;
  const plates = [...src.matchAll(plateRe)].map(
    ([, chain, hex, light, dark]) => ({
      chain,
      hex,
      light: light === 'null' ? null : parseInt(light, 10),
      dark: dark === 'null' ? null : parseInt(dark, 10),
    })
  );
  if (plates.length < 8) {
    hits.push(
      `chip tints: parsed only ${plates.length} CHAIN_PLATES entries from chain-marks.tsx; the table moved or changed shape, so the fence is guarding nothing`
    );
  }

  const clears = (plateLab, card, reserved, pct) => {
    const tint = okMix(plateLab, card, pct / 100);
    return (
      okDist(tint, card) >= FLOOR &&
      reserved.every((r) => okDist(tint, r) > FENCE)
    );
  };

  // The self-test: Robinhood's lime at 10% light must register as a
  // collision, or the fence math is broken and everything below is noise.
  {
    const lime = srgbToOklab(hexToRgb('#CCFF00'));
    const card = srgbToOklab(token(THEMES.light, 'card'));
    const att = srgbToOklab(token(THEMES.light, 'attested-tint'));
    const tint = okMix(lime, card, 0.1);
    if (okDist(tint, att) > FENCE) {
      console.error(
        'FIXTURE FAIL  the green fence no longer detects the lime/attested collision it was built on. The fence math is wrong, so every verdict below would be too.'
      );
      process.exit(1);
    }
  }

  for (const theme of ['light', 'dark']) {
    const body = THEMES[theme];
    const card = srgbToOklab(token(body, 'card'));
    const reserved = [
      srgbToOklab(token(body, 'attested-tint')),
      srgbToOklab(token(body, 'accent-brand-tint')),
    ];
    for (const p of plates) {
      const plateLab = srgbToOklab(hexToRgb(p.hex));
      const declared = p[theme];
      const smallest =
        CANDIDATES[theme].find((pct) =>
          clears(plateLab, card, reserved, pct)
        ) ?? null;
      if (declared !== smallest) {
        hits.push(
          declared === null
            ? `chip tint ${p.chain} (${theme}): declared fallback, but ${smallest}% clears the fence and the floor — an unnecessary fallback hides a working tint`
            : smallest === null
              ? `chip tint ${p.chain} (${theme}): declares ${declared}%, but no candidate percentage clears the green fence and visibility floor — this chain must fall back to --fill-subtle (null)`
              : `chip tint ${p.chain} (${theme}): declares ${declared}%, measured smallest clearing candidate is ${smallest}%`
        );
      }
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
