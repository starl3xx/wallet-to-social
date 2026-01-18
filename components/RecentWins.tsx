'use client';

import { useEffect, useState, memo } from 'react';

interface RecentWin {
  id: string;
  walletCount: number;
  twitterFound: number;
  farcasterFound: number;
  socialRate: number;
  completedAt: string;
}

// X/Twitter icon SVG
const XIcon = ({ className }: { className?: string }) => (
  <svg
    width="12"
    height="12"
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
    width="12"
    height="10"
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
    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
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
        <h3 className="text-sm font-medium text-muted-foreground tracking-wide uppercase">
          Live activity
        </h3>
      </div>

      <div className="flex gap-3 overflow-x-auto pt-1 pb-2 -mx-1 px-1 -mt-1">
        {wins.map((win, index) => {
          const recent = isRecent(win.completedAt);
          return (
            <div
              key={win.id}
              className={`
                flex-shrink-0 w-48 p-4 rounded-xl
                bg-gradient-to-br from-card to-muted/30
                border border-border/60
                shadow-sm
                hover:shadow-md hover:border-border
                hover:-translate-y-0.5
                transition-all duration-200 ease-out
                ${recent ? 'ring-1 ring-emerald-500/20' : ''}
              `}
              style={{
                animation: 'slideUp 0.4s ease-out forwards',
                animationDelay: `${index * 80}ms`,
                opacity: 0,
              }}
            >
              {/* Header: Wallet count + time */}
              <div className="flex items-start justify-between gap-2 mb-3">
                <div>
                  <p className="text-lg font-semibold tabular-nums tracking-tight">
                    {win.walletCount.toLocaleString()}
                  </p>
                  <p className="text-xs text-muted-foreground -mt-0.5">
                    wallets processed
                  </p>
                </div>
                <span className={`
                  text-[10px] font-medium px-1.5 py-0.5 rounded-md whitespace-nowrap
                  ${recent
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : 'bg-muted text-muted-foreground'
                  }
                `}>
                  {formatTime(win.completedAt)}
                </span>
              </div>

              {/* Stats row */}
              <div className="flex items-center gap-4 text-sm">
                <div className="flex items-center gap-1.5" title="Twitter/X found">
                  <XIcon className="text-foreground/70" />
                  <span className="font-medium tabular-nums">{win.twitterFound}</span>
                </div>
                <div className="flex items-center gap-1.5" title="Farcaster found">
                  <FarcasterIcon className="text-purple-500" />
                  <span className="font-medium tabular-nums">{win.farcasterFound}</span>
                </div>
              </div>

              {/* Match rate vs industry comparison */}
              <div className="mt-3 pt-3 border-t border-border/50 flex items-center justify-between">
                <span className="text-xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                  {win.socialRate}%
                </span>
                <span className="text-[10px] font-semibold text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/40 px-1.5 py-0.5 rounded whitespace-nowrap">
                  <span className="inline-block mr-0.5">&#9650;</span>
                  {Math.round(win.socialRate / 2.5)}x industry avg
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});
