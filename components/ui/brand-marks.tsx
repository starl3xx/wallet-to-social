/**
 * The two platform marks, in one place.
 *
 * These were duplicated across RecentWins, ShareButtons, the homepage footer and
 * five /vs footers, which is how the 𝕏 mark ended up at three different sizes.
 *
 * Neither can be a text character. Söhne has no U+1D54F, so a literal 𝕏 falls back
 * to whatever face the browser finds and renders as a missing-glyph box on the
 * share cards, where Satori has no fallback chain at all. Farcaster has no
 * character to begin with.
 *
 * No `use client`: these are pure SVG, so server components can render them.
 */

/**
 * `label` turns a decorative mark into a named one. Inside running copy the mark
 * stands in for the word, so aria-hidden would have a screen reader announce
 * "the and Farcaster accounts" with the platform missing. Alongside visible text
 * it stays decorative, because naming it would double the announcement.
 */
export function XMark({ className = 'h-4 w-4', label }: { className?: string; label?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}
      role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

export function FarcasterMark({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 175" fill="currentColor" className={className} aria-hidden="true">
      <path d="M200 0V23.6302H176.288V47.2404H183.553V47.2483H200V175H160.281L160.256 174.883L139.989 79.3143C138.057 70.2043 133 61.9616 125.751 56.0995C118.502 50.2376 109.371 47.0108 100.041 47.0108H99.9613C90.631 47.0108 81.5 50.2376 74.251 56.0995C67.0023 61.9616 61.9453 70.2073 60.013 79.3143L39.7223 175H0V47.2453H16.4475V47.2404H23.7114V23.6302H0V0H200Z" />
    </svg>
  );
}

export function GithubMark({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.2.5-2.3 1.3-3.1-.2-.4-.6-1.6.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.7 1.6.2 2.8.1 3.2.8.8 1.3 1.9 1.3 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3Z" />
    </svg>
  );
}

/** An arrow that means, and only means, this link leaves the site. */
export function ExternalMark({ className = 'h-3 w-3' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}
