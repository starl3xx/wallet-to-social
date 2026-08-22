import { SiteFooter } from './site-footer';
import { BrandLockup } from './brand-marks';
import { AccessBanner } from '@/components/AccessBanner';
import { ThemeToggle } from '@/components/ThemeToggle';

/**
 * The shell every page renders inside.
 *
 * `app/layout.tsx` rendered three context providers and nothing else: no header,
 * no footer, no container, no nav. That single absence is why the product read as
 * assembled rather than designed. With nothing shared above the page, all eight
 * surfaces invented their own wrapper, their own brand lockup and their own
 * footer, and there was nowhere for a design language to live.
 *
 * The visible symptoms it fixes:
 *
 *   - Three content widths. 1152px on the homepage, 896px on blog and all five
 *     /vs pages, 1280px on admin, so the measure re-flowed by up to 256px as you
 *     navigated. One width now, owned here. Admin keeps `wide` (1280px) as the
 *     one named exception: dense tables genuinely need more than 1152px, and
 *     docs/DESIGN-LANGUAGE.md records it under Layout.
 *   - A brand lockup that was a different object on the homepage (40px mark at
 *     10px radius beside a 30px two-tone bold h1) than on the seven other pages
 *     (24px mark at 4px radius beside a 14px muted span). The most repeated
 *     element on the site drifted the most. It is `BrandLockup` now, shared
 *     with the footer, so the two cannot drift again.
 *   - Three headers. The account cluster, the theme control and the header rule
 *     each arrived through an optional prop that exactly one page passed, so
 *     /check, the five /vs pages and both blog routes rendered a lockup and
 *     nothing else: a dark-mode visitor on /vs had no way to switch back above
 *     `sm`, and a signed-in buyer saw no balance, no account and no way to buy.
 *     The shell renders the whole row itself on every page now, and the
 *     account cluster reads everything it needs from context.
 *
 * Pages render `<PageShell>{content}</PageShell>` and declare no header, no
 * footer, no container and no max-w of their own. Reading columns constrain
 * measure inside the shell (`max-w-[68ch]` on prose), never the shell itself.
 *
 * No `use client`: the marketing and blog pages are server components, and this
 * has to work there. The interactive parts of the header are client components
 * rendered from here, which a server component may do.
 */
export function PageShell({
  children,
  wide,
  onBrandClick,
}: {
  children: React.ReactNode;
  /**
   * Admin only, and the one defensible difference between pages. Dense tables
   * genuinely need more than 1152px; nothing else does.
   */
  wide?: boolean;
  /**
   * Extra work on the brand click, for the homepage.
   *
   * CLAUDE.md: "Header logo is always clickable — returns user to homepage from
   * any state." A plain <Link href="/"> satisfies that everywhere except the
   * homepage itself, where navigating to the route you are already on clears
   * nothing, so results would survive the click. The homepage passes its reset.
   */
  onBrandClick?: () => void;
}) {
  const width = wide ? 'max-w-7xl' : 'max-w-6xl';
  return (
    <div className="flex min-h-screen flex-col">
      {/* One rule, viewport-wide, under the lockup row on every page. The
          homepage used to draw its own inside the container instead, so the
          same hairline stopped at the container edge there and ran edge to
          edge everywhere else. Main's pt-8 is what keeps the lockup from
          floating above a gap: the page's first line sits close beneath.
          `py-4`: the row was `pt-5 pb-3` (20/12px), neither a spacing step,
          and the lockup sat 4px low of centre in the same 80px band. */}
      <header className="border-b border-border">
        <div
          className={`mx-auto flex w-full ${width} items-center gap-2 px-6 py-4 sm:gap-3`}
        >
          <BrandLockup size="header" onClick={onBrandClick} priority />
          <div className="ml-auto">
            {/* Chip, Buy credits, theme, account: the avatar ends the row.
                The theme control is a three-option segmented at 132px, which
                is more than a phone can give it. Below `sm` it renders in the
                footer instead, which is on every page and has room. Exactly
                one is ever on screen. */}
            <AccessBanner
              trailing={
                <div className="hidden sm:block">
                  <ThemeToggle />
                </div>
              }
            />
          </div>
        </div>
      </header>

      <main className={`mx-auto w-full flex-1 ${width} px-6 pt-8 pb-12`}>
        {children}
      </main>

      <SiteFooter />
    </div>
  );
}
