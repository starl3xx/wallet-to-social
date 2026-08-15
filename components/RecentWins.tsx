'use client';

import { useEffect, useState, memo } from 'react';
import { Eyebrow } from '@/components/ui/eyebrow';
import { cn } from '@/lib/utils';

/**
 * Exactly one row, at every width.
 *
 * The grid was `repeat(auto-fill, minmax(11rem, 1fr))` against a fixed request
 * for six. At the full 1152px shell that packs five columns, so the sixth card
 * dropped onto a second row on its own and the strip stopped reading as a strip.
 * auto-fill cannot know how many items it was given, so the count and the
 * columns have to be stated together, here.
 *
 * The steps come from the card's own minimum. Its widest line is the footer,
 * "2,000 in" beside "29% hit rate", both `whitespace-nowrap`, which needs about
 * 177px inside `p-4`. Two columns therefore do not fit until roughly 414px, so
 * the first step is `sm` rather than the 360px `xs`: below that it is one card,
 * which is honest, rather than two clipped ones.
 */
const COLUMNS = 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5';

/**
 * The breakpoint each card appears at, by index, matching COLUMNS exactly. A
 * card past the column count is not rendered small, it is not rendered at all,
 * because a half-row is the thing being removed.
 */
const APPEARS_AT = ['', 'hidden sm:block', 'hidden md:block', 'hidden lg:block', 'hidden lg:block'];

interface RecentWin {
  id: string;
  walletCount: number;
  twitterFound: number;
  farcasterFound: number;
  anySocialFound: number;
  socialRate: number;
  completedAt: string;
}

// X/Twitter icon SVG
const XIcon = ({ className }: { className?: string }) => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
  >
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

// Farcaster logo SVG
const FarcasterIcon = ({ className }: { className?: string }) => (
  <svg
    width="14"
    height="12"
    viewBox="0 0 200 175"
    fill="currentColor"
    className={className}
  >
    <path d="M200 0V23.6302H176.288V47.2404H183.553V47.2483H200V175H160.281L160.256 174.883L139.989 79.3143C138.057 70.2043 133 61.9616 125.751 56.0995C118.502 50.2376 109.371 47.0108 100.041 47.0108H99.9613C90.631 47.0108 81.5 50.2376 74.251 56.0995C67.0023 61.9616 61.9453 70.2073 60.013 79.3143L39.7223 175H0V47.2453H16.4475V47.2404H23.7114V23.6302H0V0H200Z" />
  </svg>
);

// Pulsing dot indicator
/* A steady opacity pulse. animate-ping expands a halo outward, which reads as a
   notification arriving rather than a system running, and it was the larger of
   the two infinite animations that reduced-motion was not stopping. */
const LiveDot = () => (
  <span
    aria-hidden
    className="inline-flex h-[7px] w-[7px] flex-none rounded-full bg-attested motion-safe:animate-pulse"
  />
);

export const RecentWins = memo(function RecentWins() {
  const [wins, setWins] = useState<RecentWin[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchWins() {
      try {
        // Five, because five is the most columns the widest row has.
        const res = await fetch(`/api/wins?limit=${APPEARS_AT.length}`);
        if (res.ok) {
          const data = await res.json();
          setWins(data.wins);
        }
      } catch (error) {
        console.error('Failed to fetch wins:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchWins();

    // Poll every 3 minutes
    const interval = setInterval(fetchWins, 3 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Format relative time
  const formatTime = (dateStr: string) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  };

  if (loading || wins.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <LiveDot />
        {/* "Wins", not "activity". The feed is filtered to lookups above an 8%
            hit rate, deliberately, because it is social proof. Calling it
            activity promised a complete record it was never showing: thirteen of
            the last twenty-five lookups sat below that line, so a day with
            twelve of them looked like a day with none. The filter is right; the
            word was wrong. */}
        <Eyebrow as="h3">Recent wins</Eyebrow>
      </div>

      <div className={cn('grid gap-3 pt-1 pb-2 -mx-1 px-1 -mt-1', COLUMNS)}>
        {wins.map((win, index) => {
          const totalFound = win.anySocialFound;
          return (
            <div
              key={win.id}
              className={cn('min-w-0 rounded-lg border border-border p-4', APPEARS_AT[index])}
              style={{
                // The token step, capped at four. An uncapped 80ms stagger meant
                // the sixth tile landed 400ms after the first had been read.
                animation: 'slideUp var(--duration-base) var(--ease-out-soft) forwards',
                animationDelay: `calc(var(--duration-stagger) * ${Math.min(index, 3)})`,
                opacity: 0,
              }}
            >
              {/* Header: Total found (hero number) + time */}
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <p className="text-2xl font-extralight tabular-nums tracking-[var(--tracking-title)] text-foreground">
                    {totalFound.toLocaleString()}
                  </p>
                  {/* "wallets reached", not "socials found": this is now the unique
                      wallet count, so the two platform figures below it can legitimately
                      sum higher, and that difference is the overlap. */}
                  <p className="text-xs text-muted-foreground -mt-0.5">
                    wallets reached
                  </p>
                </div>
                <span className="whitespace-nowrap font-mono text-[0.5625rem] uppercase tracking-[var(--tracking-label)] text-muted-foreground">
                  {formatTime(win.completedAt)}
                </span>
              </div>

              {/* Breakdown row */}
              <div className="flex items-center gap-3 text-sm mb-3">
                <div className="flex items-center gap-1.5" title="Twitter/X found">
                  <XIcon className="text-muted-foreground" />
                  <span className="font-medium tabular-nums text-muted-foreground">{win.twitterFound.toLocaleString()}</span>
                </div>
                <div className="flex items-center gap-1.5" title="Farcaster found">
                  <FarcasterIcon className="text-muted-foreground" />
                  <span className="font-medium tabular-nums text-muted-foreground">{win.farcasterFound.toLocaleString()}</span>
                </div>
              </div>

              {/* Footer: wallet count + consistent "win" badge */}
              <div className="pt-2 border-t border-border flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground tabular-nums">
                  {win.walletCount.toLocaleString()} in
                </span>
                {/* Green because a hit rate is a measured outcome, not an affordance.
                    The tick is gone: green already carries the claim, and a leading
                    glyph on something unpressable is what makes a label look like a
                    control. */}
                <span className="whitespace-nowrap font-medium tabular-nums text-attested">
                  {win.socialRate}% hit rate
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});
