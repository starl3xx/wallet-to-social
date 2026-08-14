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
  weight: 400 | 600 | 800;
  style: 'normal';
}

/** Must match `fontFamily` in the JSX exactly. ASCII only: an umlaut here and
 *  not there is a silent fallback rather than an error. */
export const OG_FONT_FAMILY = 'Sohne';

/**
 * The URLs are built by the caller, not here, and that is load-bearing.
 * Turbopack resolves `new URL(..., import.meta.url)` at build time and needs a
 * literal path it can trace to a real file. Composing a directory URL here and
 * appending filenames fails to resolve, which is a build error rather than a
 * runtime one, so it is at least loud.
 */
export interface OgFontUrls {
  book: URL;
  halbfett: URL;
  fett: URL;
}

export async function loadOgFonts(urls: OgFontUrls): Promise<OgFont[]> {
  const [book, halbfett, fett] = await Promise.all([
    fetch(urls.book).then((r) => r.arrayBuffer()),
    fetch(urls.halbfett).then((r) => r.arrayBuffer()),
    fetch(urls.fett).then((r) => r.arrayBuffer()),
  ]);

  return [
    { name: OG_FONT_FAMILY, data: book, weight: 400, style: 'normal' },
    { name: OG_FONT_FAMILY, data: halbfett, weight: 600, style: 'normal' },
    { name: OG_FONT_FAMILY, data: fett, weight: 800, style: 'normal' },
  ];
}

/** Share-card palette, kept here so three generators cannot drift apart. */
export const OG = {
  ground: '#0B0D16',
  groundGradient: 'radial-gradient(120% 140% at 12% 8%, #2A1F72 0%, #14122E 45%, #0B0D16 100%)',
  paper: '#FAFAFB',
  ink: '#0C0E1A',
  text: '#EDEEF8',
  textMuted: '#8A90A8',
  brand: '#8585FF',
  brandTint: 'rgba(133,133,255,0.16)',
  attested: '#35C48D',
  attestedTint: 'rgba(15,122,85,0.20)',
} as const;
