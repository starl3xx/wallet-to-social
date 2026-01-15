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

// Farcaster logo SVG (2025 rebrand)
const FarcasterIcon = ({ className }: { className?: string }) => (
  <svg
    width="14"
    height="12"
    viewBox="0 0 200 175"
    fill="#855DCD"
    className={className}
  >
    <path d="M200 0V23.6302H176.288V47.2404H183.553V47.2483H200V175H160.281L160.256 174.883L139.989 79.3143C138.057 70.2043 133 61.9616 125.751 56.0995C118.502 50.2376 109.371 47.0108 100.041 47.0108H99.9613C90.631 47.0108 81.5 50.2376 74.251 56.0995C67.0023 61.9616 61.9453 70.2073 60.013 79.3143L39.7223 175H0V47.2453H16.4475V47.2404H23.7114V23.6302H0V0H200Z" />
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
