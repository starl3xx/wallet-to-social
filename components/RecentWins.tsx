'use client';

import { useEffect, useState } from 'react';

interface RecentWin {
  id: string;
  walletCount: number;
  twitterFound: number;
  farcasterFound: number;
  socialRate: number;
  completedAt: string;
}

// Farcaster logo SVG (2025 rebrand - arch/gateway shape)
const FarcasterIcon = ({ className }: { className?: string }) => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="#855DCD"
    className={className}
  >
    <path d="M5 22V12C5 8.13401 8.13401 5 12 5C15.866 5 19 8.13401 19 12V22H15V12C15 10.3431 13.6569 9 12 9C10.3431 9 9 10.3431 9 12V22H5Z" />
  </svg>
);

export function RecentWins() {
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

  if (loading || wins.length === 0) {
    return null; // Don't show if loading or no wins
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-muted-foreground">
        Recently processed
      </h3>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {wins.map((win, index) => (
          <div
            key={win.id}
            className="flex-shrink-0 w-44 p-4 bg-muted/50 rounded-lg border border-border/50
                       border-l-2 border-l-green-500/60
                       hover:scale-[1.02] hover:shadow-md hover:border-border/80
                       transition-all duration-150 ease-out cursor-default
                       origin-left"
            style={{
              animation: 'slideUp 0.3s ease-out forwards',
              animationDelay: `${index * 100}ms`,
              opacity: 0,
            }}
          >
            <p className="font-semibold text-sm">
              {win.walletCount.toLocaleString()} wallets
            </p>
            <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
              <span title="Twitter" className="flex items-center gap-1">
                <span className="text-foreground">𝕏</span> {win.twitterFound}
              </span>
              <span title="Farcaster" className="flex items-center gap-1">
                <FarcasterIcon /> {win.farcasterFound}
              </span>
            </div>
            <div className="flex items-center justify-between mt-2">
              <span className="text-xs font-medium text-green-600 dark:text-green-400">
                {win.socialRate}% social
              </span>
              <span className="text-xs text-muted-foreground">
                {formatTime(win.completedAt)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
