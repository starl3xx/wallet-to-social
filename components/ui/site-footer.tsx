import Image from 'next/image';
import Link from 'next/link';
import { XMark, FarcasterMark, GithubMark, ExternalMark } from './brand-marks';

const REPO = 'https://github.com/starl3xx/wallet-to-social';

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
 */
export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto w-full max-w-6xl px-6 py-12">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.5fr_0.9fr_1fr_1.1fr_1.2fr]">
          <div>
            <Link href="/" className="flex items-center gap-2.5">
              <Image src="/icon.png" alt="" width={30} height={30} className="rounded-mark" />
              <span className="text-xl font-semibold tracking-[var(--tracking-title)]">
                <span className="text-accent-brand">walletlink</span>
                <span className="text-muted-foreground">.social</span>
              </span>
            </Link>
            <p className="mt-3 max-w-[34ch] text-sm text-muted-foreground">
              Wallet addresses to the identities their owners published. Attested,
              never inferred.
            </p>
            <div className="mt-4 flex gap-2">
              <a href="https://x.com/walletlinkETH" target="_blank" rel="noopener noreferrer"
                aria-label="walletlink.social on X"
                className="transition-control flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted-foreground hover:border-accent-brand hover:text-accent-brand">
                <XMark className="h-3.5 w-3.5" />
              </a>
              <a href={REPO} target="_blank" rel="noopener noreferrer"
                aria-label="walletlink.social on GitHub"
                className="transition-control flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted-foreground hover:border-accent-brand hover:text-accent-brand">
                <GithubMark className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>

          <FooterColumn title="Product">
            {/* "/" is the wallet-to-social lookup. Reverse lookup is the
                handle-to-wallet flow *on* that page, not a separate destination, and
                naming the link after it hands people the wrong model of the product. */}
            <FooterLink href="/">Wallet lookup</FooterLink>
            <FooterLink href="/blog">Blog</FooterLink>
          </FooterColumn>

          {/* Five real pages that nothing linked to. They are also the highest-intent
              organic entry points the product has: someone searching "addressable
              alternative" is further down the funnel than anyone reading the blog. */}
          <FooterColumn title="Compare">
            <FooterLink href="/vs/addressable">vs Addressable</FooterLink>
            <FooterLink href="/vs/blaze">vs Blaze</FooterLink>
            <FooterLink href="/vs/holder">vs Holder</FooterLink>
            <FooterLink href="/vs/cookie">vs Cookie</FooterLink>
            <FooterLink href="/vs/airstack">vs Airstack</FooterLink>
          </FooterColumn>

          <FooterColumn title="Developers">
            <FooterLink href="https://docs.walletlink.social" external>Documentation</FooterLink>
            <FooterLink href="https://docs.walletlink.social/api-reference/introduction" external>
              API reference
            </FooterLink>
            <FooterLink href={REPO} external>GitHub</FooterLink>
          </FooterColumn>

          <FooterColumn title="Project">
            <FooterLink href={`${REPO}/blob/main/CHANGELOG.md`} external>Changelog</FooterLink>
            <FooterLink href="mailto:help@walletlink.social">help@walletlink.social</FooterLink>
          </FooterColumn>
        </div>

        <div className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5 text-xs text-muted-foreground">
          <span>© {new Date().getFullYear()} walletlink.social</span>
          <a href="https://x.com/starl3xx" target="_blank" rel="noopener noreferrer"
            className="transition-control hover:text-foreground">
            made with 🌠 by <span className="font-medium text-foreground">@starl3xx</span>
          </a>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      {/* The one label style: mono, uppercase, 0.14em. */}
      <h2 className="font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">
        {title}
      </h2>
      {children}
    </div>
  );
}

function FooterLink({
  href, children, external,
}: { href: string; children: React.ReactNode; external?: boolean }) {
  const className =
    'transition-control inline-flex items-center gap-1.5 text-sm text-foreground/80 hover:text-accent-brand';
  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
        {children}
        <ExternalMark className="h-2.5 w-2.5 text-muted-foreground" />
      </a>
    );
  }
  return href.startsWith('mailto:') ? (
    <a href={href} className={className}>{children}</a>
  ) : (
    <Link href={href} className={className}>{children}</Link>
  );
}
