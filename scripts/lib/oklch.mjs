/**
 * OKLCH to sRGB, and the token reader that feeds it.
 *
 * Extracted from `check-contrast.mjs` when a second guard needed the same
 * conversion. Writing it twice was the obvious move and the wrong one: a
 * colour-space implementation that is subtly wrong produces plausible numbers,
 * so two copies means two chances to be plausibly wrong and no way to notice.
 *
 * **This module is deliberately not self-validating.** `check-contrast.mjs`
 * owns the fixtures, measured in Chrome, and runs them before it uses anything
 * here. Both guards run in the same CI job, so a conversion that drifts fails
 * there first and loudly. Duplicating the fixtures here would just be the same
 * mistake in a smaller form.
 */
import { readFileSync } from 'fs';

/* ---------- OKLCH -> sRGB (Björn Ottosson's matrices) ---------- */

export function oklchToRgb(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ ** 3,
    m = m_ ** 3,
    s = s_ ** 3;

  const lin = [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];

  // Gamma-encode, then clamp. Clamping after encoding is what a browser does
  // when a colour falls outside sRGB, and several brand tones here do.
  return lin.map((v) => {
    const enc =
      v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(enc * 255)));
  });
}

export const hex = ([r, g, b]) =>
  '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

/* ---------- read the real tokens ---------- */

/**
 * Both guards read `app/globals.css` rather than a copied table, so neither can
 * drift from what ships. That is the whole point: a guard with its own copy of
 * the values guards the copy.
 */
export function readTokens(path = 'app/globals.css') {
  const css = readFileSync(path, 'utf8');

  const block = (selector) => {
    const re = new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\}`, 'm');
    const m = css.match(re);
    if (!m) throw new Error(`Could not find the ${selector} block in ${path}`);
    return m[1];
  };

  const token = (body, name) => {
    const m = body.match(new RegExp(`--${name}:\\s*oklch\\(([^)]+)\\)`));
    if (!m) return null;
    // An alpha token (`oklch(1 0 0 / 10%)`) has no single opaque value, so it
    // is reported rather than converted. Callers decide what that means.
    if (m[1].includes('/')) return { alpha: true };
    const [L, C, h] = m[1].trim().split(/[\s/]+/);
    return oklchToRgb(parseFloat(L), parseFloat(C || 0), parseFloat(h || 0));
  };

  return { block, token };
}
