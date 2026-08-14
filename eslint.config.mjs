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
/**
 * All 22 shaded Tailwind families, INCLUDING the five neutrals.
 *
 * The first version of this list held only the 17 chromatic families, and the
 * guard reported "raw palette classes: 0" while 18 violations were live —
 * `bg-gray-500` colouring the agent badge, `text-neutral-400` throughout the blog
 * hero, `bg-gray-100` on three admin chips. Neutrals are the easiest ones to reach
 * for by accident, because they look like they might be the muted token.
 *
 * `scripts/check-palette-guard.mjs` feeds this regex known-bad and known-good
 * strings. That test exists because the guard has now silently passed over live
 * violations twice: once for requiring whitespace before the class, once for this.
 */
const TAILWIND_PALETTE =
  '(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)';

/**
 * Deliberately not an allowlist of utility prefixes. The first version listed
 * them (`bg|text|border|…`) and required whitespace immediately before, which
 * missed two whole shapes:
 *
 *   hover:text-green-500                 variants occupy the leading slot
 *   prose-blockquote:border-l-emerald-500 directional suffix, unlisted prefix
 *
 * The second of those was sitting in the blog page while the guard reported
 * clean. So match the family and shade wherever they appear after a hyphen,
 * through any chain of variants. None of the semantic tokens contain a palette
 * family name, so this cannot fire on `accent-brand`, `attested`, `caution` or
 * `destructive`.
 */
const PALETTE_CLASS = `(?:[a-z0-9-]+:)*[a-z-]*-${TAILWIND_PALETTE}-[0-9]{2,3}`;

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
          selector: `Literal[value=/(^|\\s)${PALETTE_CLASS}(\\/[0-9]{1,3})?(\\s|$)/]`,
          message:
            'Use a semantic colour token, not a raw Tailwind palette class. ' +
            'accent-brand for brand and interactive, attested for owner-published identities only, ' +
            'caution for limits and staleness, destructive for removal, muted for everything else. ' +
            'See app/globals.css and CLAUDE.md.',
        },
        {
          selector: `TemplateElement[value.raw=/(^|\\s)${PALETTE_CLASS}(\\/[0-9]{1,3})?(\\s|$)/]`,
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
