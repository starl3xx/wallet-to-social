import Link from 'next/link';
import {
  ArrowSquareOut,
  GithubLogo,
  Heart,
} from '@phosphor-icons/react/dist/ssr';
import { XMark, BrandLockup } from './brand-marks';
import { Eyebrow } from './eyebrow';
import { ThemeToggle } from '@/components/ThemeToggle';

const REPO = 'https://github.com/starl3xx/wallet-to-social';

const SOCIAL =
  'transition-control flex size-control items-center justify-center rounded-full border border-input text-muted-foreground hover:border-accent-brand hover:text-accent-brand';

/**
 * One footer for every page.
 *
 * It replaced eight hand-rolled copies under three spacing recipes, none of which
 * carried any product navigation: they were a maker credit and four social links.
 * `docs.walletlink.social` was linked twice in the whole app and GitHub not at
 * all, on a public repo.
 *
 * Every destination here exists. A footer that links to a Pricing page nobody has
 * built is a roadmap wearing a design's clothes.
 *
 * Icons carry information rather than decoration: an arrow means the link leaves
 * the site, so Documentation, API reference, GitHub and Changelog are marked and
 * Blog is not. That is the only rule needed to stop a footer becoming a field of
 * glyphs.
 *
 * The arrow and the GitHub mark are Phosphor, through the SSR entrypoint because
 * this renders in server components. They were local SVGs in brand-marks.tsx,
 * which left "this link leaves the site" with two drawings: a Lucide-shaped
 * box-and-arrow here and `ArrowSquareOut` in the API keys dialog and admin.
 * Farcaster is the one mark Phosphor lacks (docs/DESIGN-LANGUAGE.md, Icons).
 */
export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto w-full max-w-6xl px-6 py-12">
        {/* Every gap here is a spacing step. The grid was gap-10 (40px), the
            phone theme toggle mt-5 (20px), the bottom row mt-10 pt-5
            (40/20px) and the column links gap-2.5 (10px): five values the
            nine-step scale does not have, each replaced with its nearest
            step (48, 16, 48/16, 12). */}
        <div className="grid gap-12 sm:grid-cols-2 lg:grid-cols-[1.5fr_0.9fr_1fr_1.1fr_1.2fr]">
          <div>
            {/* The same object as the header's, at the phone-header size. It
                was a third hand-written lockup (30px mark, 20px wordmark),
                matching neither header pair. */}
            <BrandLockup size="footer" />
            <p className="mt-3 max-w-[34ch] text-sm text-muted-foreground">
              Wallet addresses to the identities their owners published.
              Attested, never inferred.
            </p>
            {/* Below `sm` only, because above it the control is in the header.
                The header row wants 606px and cannot shrink, and this control is
                132px of that, so a phone gets it here where there is room. The
                two are mutually exclusive: there is never a second one on
                screen, which is the whole reason this carries `sm:hidden`
                rather than simply existing. */}
            <div className="mt-4 sm:hidden">
              <ThemeToggle />
            </div>
            {/* The round 34px icon control, the same object as the overflow
                trigger and the header avatar: `size-control`, and `border-input`
                because a control's edge needs 3:1 and `--border` is the quiet
                decorative hairline (docs/DESIGN-LANGUAGE.md, Contrast). These
                were 32px with the decorative edge, so in dark mode the ring was
                barely there and the two glyphs read as loose marks. */}
            <div className="mt-4 flex gap-2">
              <a
                href="https://x.com/walletlinkETH"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="walletlink.social on X"
                className={SOCIAL}
              >
                <XMark className="h-4 w-4" />
              </a>
              <a
                href={REPO}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="walletlink.social on GitHub"
                className={SOCIAL}
              >
                <GithubLogo className="h-4 w-4" weight="fill" aria-hidden />
              </a>
            </div>
          </div>

          <FooterColumn title="Product">
            {/* "/" is the wallet-to-social lookup. Reverse lookup is the
                handle-to-wallet flow *on* that page, not a separate destination, and
                naming the link after it hands people the wrong model of the product. */}
            <FooterLink href="/">Wallet lookup</FooterLink>
            <FooterLink href="/pricing">Pricing</FooterLink>
            <FooterLink href="/blog">Blog</FooterLink>
          </FooterColumn>

          {/* The comparison pages are the highest-intent organic entry points
              the product has: someone searching "addressable alternative" is
              further down the funnel than anyone reading the blog. Only the
              live competitors are listed. /vs/blaze and /vs/airstack stay
              published for the searches that still land on them, but neither
              service takes customers any more (decided 2026-08-22), and a
              footer that offers a comparison with a dead product tells a
              visitor we have not looked lately. */}
          <FooterColumn title="Compare">
            <FooterLink href="/vs/addressable">vs Addressable</FooterLink>
            <FooterLink href="/vs/holder">vs Holder</FooterLink>
            <FooterLink href="/vs/cookie3">vs Cookie3</FooterLink>
            <FooterLink href="/vs/formo">vs Formo</FooterLink>
          </FooterColumn>

          <FooterColumn title="Developers">
            <FooterLink href="https://docs.walletlink.social" external>
              Documentation
            </FooterLink>
            <FooterLink
              href="https://docs.walletlink.social/api-reference/introduction"
              external
            >
              API reference
            </FooterLink>
            <FooterLink href={REPO} external>
              GitHub
            </FooterLink>
          </FooterColumn>

          <FooterColumn title="Project">
            <FooterLink href={`${REPO}/blob/main/CHANGELOG.md`} external>
              Changelog
            </FooterLink>
            <FooterLink href="mailto:help@walletlink.social">
              help@walletlink.social
            </FooterLink>
          </FooterColumn>
        </div>

        <div className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-xs text-muted-foreground">
          {/* The site is the product; the copyright is the company that owns it. */}
          <span>© {new Date().getFullYear()} Starl3xx Labs LLC</span>
          {/* The credit's glyph is Phosphor, at the UI size, like every other
              icon. It was a colour emoji, the only one on the site: a bitmap
              from the platform's emoji font in a row of Söhne, drawn
              differently on every OS. The word goes to screen readers only,
              so the sentence still reads as one. */}
          <a
            href="https://starl3xx.fun"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-control inline-flex items-center gap-1 hover:text-foreground"
          >
            made with
            <Heart className="h-4 w-4" aria-hidden />
            <span className="sr-only">love</span>
            by <span className="font-medium text-foreground">@starl3xx</span>
          </a>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      {/* The one label style, through the primitive that owns the string. It
          re-typed the classes by hand, which is how a value stops being
          single. */}
      <Eyebrow as="h2">{title}</Eyebrow>
      {children}
    </div>
  );
}

function FooterLink({
  href,
  children,
  external,
}: {
  href: string;
  children: React.ReactNode;
  external?: boolean;
}) {
  const className =
    'transition-control inline-flex items-center gap-1.5 text-sm text-foreground/80 hover:text-accent-brand';
  if (external) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
      >
        {children}
        {/* The one external-link glyph, at the one size it takes everywhere
            (h-3 w-3, beside running text). At h-2.5 the old local drawing was
            a 10px speck after "Documentation". */}
        <ArrowSquareOut className="h-3 w-3 text-muted-foreground" aria-hidden />
      </a>
    );
  }
  return href.startsWith('mailto:') ? (
    <a href={href} className={className}>
      {children}
    </a>
  ) : (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}
