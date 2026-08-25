'use client';

import { useEffect, useState, memo } from 'react';
import { Eyebrow } from '@/components/ui/eyebrow';
import { XMark, FarcasterMark } from '@/components/ui/brand-marks';
import { cn } from '@/lib/utils';

/**
 * Exactly one row, at every width, and no empty column in it.
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
 *
 * Each step is also capped at the number of wins in hand, indexed by count. A
 * fixed `lg:grid-cols-5` over four wins reserved a fifth column and left about
 * 220px of the shell blank at the right, which read as a tile that failed to
 * load. The strings stay literal so Tailwind can see them.
 */
const COLUMNS_BY_COUNT = [
  '',
  'grid-cols-1',
  'grid-cols-1 sm:grid-cols-2',
  'grid-cols-1 sm:grid-cols-2 md:grid-cols-3',
  'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4',
  'grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5',
];

/**
 * The breakpoint each card appears at, by index, matching the widest COLUMNS
 * entry exactly. A card past the column count is not rendered small, it is not
 * rendered at all, because a half-row is the thing being removed.
 */
const APPEARS_AT = [
  '',
  'hidden sm:block',
  'hidden md:block',
  'hidden lg:block',
  'hidden lg:block',
];

interface RecentWin {
  id: string;
  walletCount: number;
  twitterFound: number;
  farcasterFound: number;
  anySocialFound: number;
  socialRate: number;
  completedAt: string;
}

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

      <div
        className={cn(
          'grid gap-3 pt-1 pb-2 -mx-1 px-1 -mt-1',
          COLUMNS_BY_COUNT[Math.min(wins.length, APPEARS_AT.length)]
        )}
      >
        {wins.map((win, index) => {
          const totalFound = win.anySocialFound;
          return (
            <div
              key={win.id}
              className={cn(
                'min-w-0 rounded-lg border border-border p-4',
                APPEARS_AT[index]
              )}
              style={{
                // The token step, capped at four. An uncapped 80ms stagger meant
                // the sixth tile landed 400ms after the first had been read.
                animation:
                  'slideUp var(--duration-base) var(--ease-out-soft) forwards',
                animationDelay: `calc(var(--duration-stagger) * ${Math.min(index, 3)})`,
                opacity: 0,
              }}
            >
              {/* Header: Total found (hero number) + time. The figure is 200,
                  the one weight for a figure standing alone at 24px and up. */}
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
                {/* The one label style. This was a 9px arbitrary size under
                    the 12px eyebrow above it: the same label at two sizes in
                    one block. */}
                <Eyebrow as="span" className="whitespace-nowrap">
                  {formatTime(win.completedAt)}
                </Eyebrow>
              </div>

              {/* Breakdown row. The marks come from brand-marks, not a local
                  copy: this file once carried its own X and Farcaster SVGs
                  beside the shared ones. Named, because the mark is the only
                  thing saying which platform the count belongs to. */}
              <div className="flex items-center gap-3 text-sm mb-3">
                <div
                  className="flex items-center gap-2"
                  title="X accounts found"
                >
                  <XMark
                    className="h-3.5 w-3.5 text-muted-foreground"
                    label="X"
                  />
                  <span className="font-medium tabular-nums text-muted-foreground">
                    {win.twitterFound.toLocaleString()}
                  </span>
                </div>
                <div
                  className="flex items-center gap-2"
                  title="Farcaster accounts found"
                >
                  <FarcasterMark className="h-3.5 w-3.5 text-muted-foreground" />
                  {/* FarcasterMark is always decorative, so the name goes in
                      text a screen reader gets and a sighted reader does not. */}
                  <span className="sr-only">Farcaster</span>
                  <span className="font-medium tabular-nums text-muted-foreground">
                    {win.farcasterFound.toLocaleString()}
                  </span>
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
