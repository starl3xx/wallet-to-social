/**
 * Söhne for the OG image generators.
 *
 * Satori, which renders every `next/og` image, has no access to CSS or to
 * installed fonts. Each face has to be handed to it as a font buffer, and it
 * cannot read woff2 either, which is why `public/fonts` carries `.ttf`
 * duplicates of the three weights used here alongside the woff2 the site loads.
 *
 * These routes run on the edge, so there is no filesystem to read from. Fetching
 * by URL is the same mechanism the generators already use for the logo.
 *
 * Weight coverage is deliberate and minimal. Every weight added here is another
 * ~100 KB fetched per render, and Satori silently substitutes the nearest
 * available weight rather than failing, so an unloaded weight produces a card
 * that looks slightly wrong instead of one that errors.
 */
export interface OgFont {
  name: string;
  data: ArrayBuffer;
  // Stops at 600. The design language's weight scale has no 800 in it, and the
  // one card that used to reach for it now sets its emphasis span at 600.
  weight: 200 | 400 | 600;
  style: 'normal';
}

/** Must match `fontFamily` in the JSX exactly. ASCII only: an umlaut here and
 *  not there is a silent fallback rather than an error. */
export const OG_FONT_FAMILY = 'Sohne';

/**
 * Card copy is limited to what Söhne actually contains.
 *
 * Satori draws with the buffers passed to it and nothing else. A browser walks
 * a fallback chain when a face lacks a codepoint; Satori draws a missing-glyph
 * box instead. So characters outside Söhne's coverage must not appear in any
 * card, however good they look in the app.
 *
 * The one that has already bitten: 𝕏 (U+1D54F, Mathematical Alphanumeric
 * Symbols) shipped as a tofu box on the default card. Use a plain "X" here.
 * The same applies to anything else decorative: arrows, dingbats, most emoji.
 */


/**
 * The URLs are built by the caller, not here, and that is load-bearing.
 * Turbopack resolves `new URL(..., import.meta.url)` at build time and needs a
 * literal path it can trace to a real file. Composing a directory URL here and
 * appending filenames fails to resolve, which is a build error rather than a
 * runtime one, so it is at least loud.
 */
export interface OgFontUrls {
  extraleicht: URL;
  book: URL;
  halbfett: URL;
}

export async function loadOgFonts(urls: OgFontUrls): Promise<OgFont[]> {
  const [extraleicht, book, halbfett] = await Promise.all([
    fetch(urls.extraleicht).then((r) => r.arrayBuffer()),
    fetch(urls.book).then((r) => r.arrayBuffer()),
    fetch(urls.halbfett).then((r) => r.arrayBuffer()),
  ]);

  return [
    // 200 is the display tier the card headline is set in. Satori substitutes the
    // nearest available weight rather than failing, so without this the headline
    // rendered at 400: a blunter card, not a broken one, which is exactly why it
    // shipped unnoticed.
    { name: OG_FONT_FAMILY, data: extraleicht, weight: 200, style: 'normal' },
    { name: OG_FONT_FAMILY, data: book, weight: 400, style: 'normal' },
    { name: OG_FONT_FAMILY, data: halbfett, weight: 600, style: 'normal' },
  ];
}

/**
 * Share-card palette, kept here so the generators cannot drift apart.
 *
 * That was already the stated purpose and it did not hold. The blog generator
 * imported this object, took two values from it, and then wrote eight more
 * inline, because there were no paper-card entries to take. A shared palette
 * with a hole in it gets worked around rather than extended, so the hole is the
 * defect. The paper set below exists to close it.
 *
 * **Every value here is a real token value**, converted from the oklch in
 * `app/globals.css`, and `scripts/check-og-palette.mjs` fails the build if one
 * drifts. Satori resolves an inline style object with no CSS cascade, so
 * `var(--token)` genuinely cannot be used in a card and a literal is
 * unavoidable. What was avoidable was the literal being a different colour from
 * the token it stands for. Before this, only two of the eleven matched, and
 * every neutral carried a blue cast: the signature of reaching for Tailwind's
 * slate rather than this project's strictly achromatic greys.
 *
 * The two DELIBERATE exceptions are marked. They are choices, not drift, and
 * the guard is told about them by name.
 */
export const OG = {
  /**
   * DELIBERATE. The dark card's ground is a violet radial gradient rather than
   * a flat token, and its stops are a designed treatment with no token
   * equivalent. Changing it is a design decision, not a correctness fix.
   */
  groundGradient:
    'radial-gradient(120% 140% at 12% 8%, #2A1F72 0%, #14122E 45%, #0B0D16 100%)',

  // Dark card. Values mirror the dark theme.
  text: '#fafafa', // --foreground
  textMuted: '#a1a1a1', // --muted-foreground
  brand: '#8585ff', // --accent-brand
  attested: '#39bf89', // --attested

  /**
   * DELIBERATE. A translucent wash so the ground gradient shows through, which
   * a flat token cannot do. The base is now the dark `--attested` above rather
   * than the light one it used to borrow, so the hue is on-system even though
   * the value is not a token.
   */
  attestedTint: 'rgba(57,191,137,0.20)',

  // Paper card. Values mirror the light theme.
  paper: '#fafafa', // near-white ground, achromatic
  ink: '#0a0a0a', // --foreground
  paperMuted: '#737373', // --muted-foreground
  paperBrand: '#4131b0', // --accent-brand
  paperBrandTint: '#eff1ff', // --accent-brand-tint
  paperAttested: '#00704a', // --attested
  paperAttestedTint: '#e1f9ec', // --attested-tint
} as const;
