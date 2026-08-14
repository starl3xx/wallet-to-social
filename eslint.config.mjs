import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

/**
 * Palette guard.
 *
 * The product had accumulated 471 hardcoded Tailwind palette classes across ten
 * colour families, against a design system that defines four semantic tokens.
 * Colour had stopped meaning anything a user could learn: four pricing tiers in
 * four unrelated hues, two different greens, and an emerald doing brand duty at
 * 2.54:1 against white.
 *
 * The sweep is only worth doing once. This is what stops it coming back one
 * convenient `text-green-500` at a time.
 *
 * Use instead:
 *   accent-brand / accent-brand-tint  brand and anything interactive
 *   attested / attested-tint          an identity the owner published (only)
 *   caution / caution-tint            truncation, staleness, limits
 *   destructive                       revoking, deleting
 *   muted / muted-foreground / border everything else
 */
const TAILWIND_PALETTE =
  '(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)';
const PALETTE_CLASS = `(?:bg|text|border|ring|from|via|to|decoration|outline|shadow|divide|accent|caret|fill|stroke)-${TAILWIND_PALETTE}-[0-9]{2,3}`;

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ['app/**/*.{ts,tsx}', 'components/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          // Matches the class string wherever it is written: a className
          // literal, a template chunk, or a variable holding class names.
          selector: `Literal[value=/(^|\\s)${PALETTE_CLASS}(\\s|$)/]`,
          message:
            'Use a semantic colour token, not a raw Tailwind palette class. ' +
            'accent-brand for brand and interactive, attested for owner-published identities only, ' +
            'caution for limits and staleness, destructive for removal, muted for everything else. ' +
            'See app/globals.css and CLAUDE.md.',
        },
        {
          selector: `TemplateElement[value.raw=/(^|\\s)${PALETTE_CLASS}(\\s|$)/]`,
          message:
            'Use a semantic colour token, not a raw Tailwind palette class. ' +
            'See app/globals.css and CLAUDE.md.',
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
  ]),
]);

export default eslintConfig;
