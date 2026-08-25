import Link from 'next/link';
import { ArrowSquareOut, GithubLogo } from '@phosphor-icons/react/dist/ssr';
import { XMark, FarcasterMark, BrandLockup } from './brand-marks';
import { Eyebrow } from './eyebrow';
import { ThemeToggle } from '@/components/ThemeToggle';
import { LEGAL_ENTITY } from '@/lib/site-url';

const REPO = 'https://github.com/starl3xx/wallet-to-social';

// One question, asked of each assistant that accepts a prefill parameter. The
// phrasing is deliberately open: the assistants read /llms.txt and the public
// pages, so the answer is theirs to give, and a leading question ("why is X
// great") would read as astroturf the moment the answer hedged.
const ASK_AI_PROMPT = encodeURIComponent(
  'What is walletlink.social? What does it do, who is it for, and what does it cost?'
);

const ASK_AI = [
  { label: 'ChatGPT', href: `https://chatgpt.com/?q=${ASK_AI_PROMPT}` },
  { label: 'Claude', href: `https://claude.ai/new?q=${ASK_AI_PROMPT}` },
  {
    label: 'Perplexity',
    href: `https://www.perplexity.ai/search?q=${ASK_AI_PROMPT}`,
  },
  // Venice takes no prefill, so this is the one link in the row that opens an
  // empty composer and leaves the visitor to type. Its chat reads no question
  // out of the URL: ?prompt=, ?q=, ?message=, ?text= and ?input= all render the
  // placeholder, checked 2026-08-23 against the rendered app rather than the
  // docs, which describe only the API. Shipping a fourth link with a parameter
  // nobody reads would have looked identical in the diff and done nothing.
  // Venice is worth the row anyway: it is the assistant that needs no account
  // and keeps the conversation in the browser, so it is the one an audience
  // that cares about wallet privacy is most likely to already be in.
  { label: 'Venice.ai', href: 'https://venice.ai/chat' },
];

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
                href="https://farcaster.xyz/walletlink"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="walletlink.social on Farcaster"
                className={SOCIAL}
              >
                <FarcasterMark className="h-4 w-4" />
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
            <FooterLink href="/holders">Holder reports</FooterLink>
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
            <FooterLink href="/privacy">Privacy</FooterLink>
            <FooterLink href="mailto:help@walletlink.social">
              help@walletlink.social
            </FooterLink>
          </FooterColumn>
        </div>

        {/* The AI answer engines are an acquisition channel like search, and
            /llms.txt is already written for them; these links put a visitor
            one click from asking about the product in their own assistant,
            with the question pre-filled. Text links, not provider logos: the
            footer's icon rule is that a glyph carries information, and four
            brand marks here would carry none the words do not. */}
        <div className="mt-12 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-4 text-xs text-muted-foreground">
          <span>Ask AI about walletlink.social</span>
          {ASK_AI.map((t) => (
            <a
              key={t.label}
              href={t.href}
              target="_blank"
              rel="noopener noreferrer"
              className="transition-control inline-flex items-center gap-1 hover:text-accent-brand"
            >
              {t.label}
              <ArrowSquareOut className="h-3 w-3" aria-hidden />
            </a>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
          <span className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {/* The site is the product; the copyright is the company that owns it. */}
            <span>
              © {new Date().getFullYear()} {LEGAL_ENTITY}
            </span>
            {/* A route handler, so a plain anchor rather than Link; it serves
                text and exists to be found, by crawlers and by the people who
                check for it. */}
            <a
              href="/llms.txt"
              className="transition-control hover:text-foreground"
            >
              llms.txt
            </a>
          </span>
          {/* The 🌠 emoji, deliberately: the brand (starl3xx is the star),
              and the one emoji on the site, by Jake's explicit call
              (2026-08-22). An earlier cleanup swapped it for a Phosphor
              heart on vector-discipline grounds and lost the pun; a later
              fix tried Phosphor's ShootingStar and was overruled. Platform
              emoji fonts announce it as "shooting star", so the sentence
              reads whole without any sr-only text. */}
          <a
            href="https://starl3xx.fun"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-control inline-flex items-center gap-1 hover:text-foreground"
          >
            made with
            <span>🌠</span>
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
