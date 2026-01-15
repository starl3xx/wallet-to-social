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

// Official Farcaster logo SVG
const FarcasterIcon = ({ className }: { className?: string }) => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 1000 1000"
    fill="#855DCD"
    className={className}
  >
    <path d="M257.778 155.556H742.222V844.445H671.111V528.889H670.414C662.554 441.677 589.258 373.333 500 373.333C410.742 373.333 337.446 441.677 329.586 528.889H328.889V844.445H257.778V155.556Z" />
    <path d="M128.889 253.333L157.778 351.111H182.222V746.667C169.949 746.667 160 756.616 160 768.889V795.556H155.556C143.283 795.556 133.333 805.505 133.333 817.778V844.445H382.222V817.778C382.222 805.505 372.273 795.556 360 795.556H355.556V768.889C355.556 756.616 345.606 746.667 333.333 746.667H306.667V253.333H128.889Z" />
    <path d="M675.556 746.667C663.283 746.667 653.333 756.616 653.333 768.889V795.556H648.889C636.616 795.556 626.667 805.505 626.667 817.778V844.445H875.556V817.778C875.556 805.505 865.606 795.556 853.333 795.556H848.889V768.889C848.889 756.616 838.94 746.667 826.667 746.667V351.111H851.111L880 253.333H702.222V746.667H675.556Z" />
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
                       transition-all duration-150 ease-out cursor-default"
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
