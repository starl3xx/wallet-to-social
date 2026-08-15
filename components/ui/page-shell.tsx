import Image from 'next/image';
import Link from 'next/link';
import { SiteFooter } from './site-footer';

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
 *     navigated. One width now, owned here.
 *   - A brand lockup that was a different object on the homepage (40px mark at
 *     10px radius beside a 30px two-tone bold h1) than on the seven other pages
 *     (24px mark at 4px radius beside a 14px muted span). The most repeated
 *     element on the site drifted the most.
 *   - ThemeToggle existed only on the homepage, so a dark-mode visitor on /vs had
 *     no way to switch back.
 *
 * Pages render `<PageShell>{content}</PageShell>` and declare no header, no
 * footer, no container and no max-w of their own. Reading columns constrain
 * measure inside the shell (`max-w-[68ch]` on prose), never the shell itself.
 *
 * No `use client`: the marketing and blog pages are server components, and this
 * has to work there. Interactive controls are passed in through `actions`.
 */
export function PageShell({
  children,
  actions,
  below,
  wide,
  onBrandClick,
}: {
  children: React.ReactNode;
  /** Interactive header controls. The homepage passes tier, upgrade and theme. */
  actions?: React.ReactNode;
  /** Full-bleed content directly under the header rule, inside the shell width. */
  below?: React.ReactNode;
  /** Admin only. Dense tables genuinely need more than 1152px. */
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
      <header className="border-b border-border">
        <div className={`mx-auto flex w-full ${width} items-center gap-3 px-6 py-4`}>
          <Link
            href="/"
            onClick={onBrandClick}
            className="transition-control flex items-center gap-2.5 hover:opacity-80"
          >
            <Image src="/icon.png" alt="" width={36} height={36} priority className="rounded-mark" />
            {/* The brand sits on the name, not the suffix. ".social" is the
                address; "walletlink" is the thing. */}
            <span className="text-2xl font-semibold tracking-tight sm:text-[2rem]">
              <span className="text-accent-brand">walletlink</span>
              <span className="text-muted-foreground">.social</span>
            </span>
          </Link>
          {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
        </div>
        {below ? (
          <div className={`mx-auto w-full ${width} px-6 pb-4`}>{below}</div>
        ) : null}
      </header>

      <main className={`mx-auto w-full flex-1 ${width} px-6 py-12`}>{children}</main>

      <SiteFooter />
    </div>
  );
}
