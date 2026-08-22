import Image from 'next/image';
import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * The two platform marks, and the brand lockup, in one place.
 *
 * These were duplicated across RecentWins, ShareButtons, the homepage footer and
 * five /vs footers, which is how the 𝕏 mark ended up at three different sizes.
 *
 * Neither can be a text character. Söhne has no U+1D54F, so a literal 𝕏 falls back
 * to whatever face the browser finds and renders as a missing-glyph box on the
 * share cards, where Satori has no fallback chain at all. Farcaster has no
 * character to begin with.
 *
 * Only these two. A GitHub mark and an external-link arrow lived here too, and
 * both are icons Phosphor owns (`GithubLogo`, `ArrowSquareOut`); keeping local
 * drawings gave "this link leaves the site" two shapes. Farcaster is the one
 * mark Phosphor lacks (docs/DESIGN-LANGUAGE.md, Icons).
 *
 * No `use client`: pure SVG plus next/image and next/link, so server components
 * can render all of it.
 */

/**
 * The brand lockup: mark beside wordmark, one object at two sizes.
 *
 * It was hand-written in the header and again in the footer, and the two had
 * drifted: a 28/36px mark beside a 20/32px wordmark at the top of the page and
 * a 30px mark beside a 20px wordmark at the bottom, with ".social" hidden on
 * a phone in one and always shown in the other. The most repeated object on
 * the site is the one that must not drift, so both now render this.
 *
 * `header` steps down as a unit below `sm`, mark and wordmark together, so it
 * stays one lockup rather than a shrunken word beside a full-size mark.
 * `footer` is the phone-header pair at every width, so on one phone screen the
 * two lockups are the same object. The header steps up to 30px at sm.
 *
 * No `hover:opacity-80`: the name is already `text-accent-brand`, and hover
 * changes colour only (docs/DESIGN-LANGUAGE.md, Motion). Opacity on a
 * two-colour lockup faded the muted suffix into the page.
 */
const LOCKUP = {
  header: {
    mark: 'h-7 w-7 sm:h-9 sm:w-9',
    // text-3xl (30px), not the 32px it was: 32 is not a step on the type
    // scale, and at 30px the tracking token is the title one, so both values
    // come from the system. The header row is 10px narrower for it.
    word: 'text-xl tracking-[var(--tracking-title)] sm:text-3xl',
  },
  footer: {
    mark: 'h-7 w-7',
    word: 'text-xl tracking-[var(--tracking-title)]',
  },
} as const;

export function BrandLockup({
  size,
  onClick,
  className,
  priority,
}: {
  size: keyof typeof LOCKUP;
  /** Extra work on the click; the link itself always goes home. */
  onClick?: () => void;
  className?: string;
  /** The header lockup is above the fold on every page; the footer one is not. */
  priority?: boolean;
}) {
  const { mark, word } = LOCKUP[size];
  return (
    <Link
      href="/"
      onClick={onClick}
      className={cn('flex items-center gap-2', className)}
    >
      <Image
        src="/icon.png"
        alt=""
        width={36}
        height={36}
        priority={priority}
        className={cn('rounded-mark', mark)}
      />
      {/* The brand sits on the name, not the suffix. ".social" is the
          address; "walletlink" is the thing, and the address is the one part
          a phone can spare: measured with Söhne loaded, dropping it returns
          46px to a header row that cannot shrink (docs/DESIGN-LANGUAGE.md,
          The header on a phone). The same rule applies in the footer so the
          two lockups stay one object. */}
      <span className={cn('font-semibold', word)}>
        <span className="text-accent-brand">walletlink</span>
        <span className="hidden text-muted-foreground sm:inline">.social</span>
      </span>
    </Link>
  );
}

/**
 * `label` turns a decorative mark into a named one. Inside running copy the mark
 * stands in for the word, so aria-hidden would have a screen reader announce
 * "the and Farcaster accounts" with the platform missing. Alongside visible text
 * it stays decorative, because naming it would double the announcement.
 */
export function XMark({
  className = 'h-4 w-4',
  label,
}: {
  className?: string;
  label?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

export function FarcasterMark({
  className = 'h-4 w-4',
}: {
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 200 175"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M200 0V23.6302H176.288V47.2404H183.553V47.2483H200V175H160.281L160.256 174.883L139.989 79.3143C138.057 70.2043 133 61.9616 125.751 56.0995C118.502 50.2376 109.371 47.0108 100.041 47.0108H99.9613C90.631 47.0108 81.5 50.2376 74.251 56.0995C67.0023 61.9616 61.9453 70.2073 60.013 79.3143L39.7223 175H0V47.2453H16.4475V47.2404H23.7114V23.6302H0V0H200Z" />
    </svg>
  );
}
