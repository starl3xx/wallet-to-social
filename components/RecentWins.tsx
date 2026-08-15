'use client';

import { useEffect, useState, memo } from 'react';

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
const LiveDot = () => (
  <span className="relative flex h-2 w-2">
    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-attested opacity-75" />
    <span className="relative inline-flex rounded-full h-2 w-2 bg-attested" />
  </span>
);

export const RecentWins = memo(function RecentWins() {
  const [wins, setWins] = useState<RecentWin[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchWins() {
      try {
        const res = await fetch('/api/wins?limit=6');
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

  // Check if recent (within 10 minutes)
  const isRecent = (dateStr: string) => {
    if (!dateStr) return false;
    const diffMs = Date.now() - new Date(dateStr).getTime();
    return diffMs < 10 * 60 * 1000;
  };

  if (loading || wins.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <LiveDot />
        <h3 className="font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">
          Recent activity
        </h3>
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3 pt-1 pb-2 -mx-1 px-1 -mt-1">
        {wins.map((win, index) => {
          const recent = isRecent(win.completedAt);
          const totalFound = win.anySocialFound;
          return (
            <div
              key={win.id}
              className={`
                min-w-0 p-4 rounded-lg
                bg-card border border-border
                hover:border-foreground/30
                transition-colors
                ${recent ? 'ring-1 ring-accent-brand/20' : ''}
              `}
              style={{
                animation: 'slideUp 0.4s ease-out forwards',
                animationDelay: `${index * 80}ms`,
                opacity: 0,
              }}
            >
              {/* Header: Total found (hero number) + time */}
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <p className="text-2xl font-bold tabular-nums tracking-[var(--tracking-title)] text-accent-brand">
                    {totalFound.toLocaleString()}
                  </p>
                  {/* "wallets reached", not "socials found": this is now the unique
                      wallet count, so the two platform figures below it can legitimately
                      sum higher, and that difference is the overlap. */}
                  <p className="text-xs text-muted-foreground -mt-0.5">
                    wallets reached
                  </p>
                </div>
                <span className={`
                  text-xs font-medium px-1.5 py-0.5 rounded-sm whitespace-nowrap
                  ${recent
                    ? 'bg-accent-brand/10 text-accent-brand'
                    : 'bg-muted text-muted-foreground'
                  }
                `}>
                  {formatTime(win.completedAt)}
                </span>
              </div>

              {/* Breakdown row */}
              <div className="flex items-center gap-3 text-sm mb-3">
                <div className="flex items-center gap-1.5" title="Twitter/X found">
                  <XIcon className="text-foreground/70" />
                  <span className="font-medium tabular-nums text-muted-foreground">{win.twitterFound.toLocaleString()}</span>
                </div>
                <div className="flex items-center gap-1.5" title="Farcaster found">
                  <FarcasterIcon className="text-accent-brand" />
                  <span className="font-medium tabular-nums text-muted-foreground">{win.farcasterFound.toLocaleString()}</span>
                </div>
              </div>

              {/* Footer: wallet count + consistent "win" badge */}
              <div className="pt-2 border-t border-border flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground tabular-nums">
                  {win.walletCount.toLocaleString()} wallets
                </span>
                {/* Green because a hit rate is a measured outcome, not an affordance.
                    The tick is gone: green already carries the claim, and a leading
                    glyph on something unpressable is what makes a label look like a
                    control. */}
                <span className="text-xs font-medium text-attested bg-attested-tint px-1.5 py-0.5 rounded-sm whitespace-nowrap tabular-nums">
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
