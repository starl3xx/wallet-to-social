'use client';

import { memo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Analytics } from '@/lib/client-analytics';

interface ShareButtonsProps {
  twitterCount: number;
  farcasterCount: number;
  totalWallets: number;
}

export const ShareButtons = memo(function ShareButtons({
  twitterCount,
  farcasterCount,
  totalWallets,
}: ShareButtonsProps) {
  const matchRate = totalWallets > 0
    ? Math.round(((twitterCount + farcasterCount) / totalWallets) * 100)
    : 0;

  const shareText = `Just resolved ${totalWallets.toLocaleString()} wallets into social profiles with walletlink.social — found ${twitterCount.toLocaleString()} Twitter + ${farcasterCount.toLocaleString()} Farcaster matches (${matchRate}% match rate)`;

  const handleShareTwitter = useCallback(() => {
    Analytics.exportClicked('share_twitter', totalWallets);
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent('https://walletlink.social')}`;
    window.open(url, '_blank', 'noopener,noreferrer,width=550,height=420');
  }, [shareText, totalWallets]);

  const handleShareFarcaster = useCallback(() => {
    Analytics.exportClicked('share_farcaster', totalWallets);
    const url = `https://warpcast.com/~/compose?text=${encodeURIComponent(shareText + '\n\nhttps://walletlink.social')}`;
    window.open(url, '_blank', 'noopener,noreferrer,width=550,height=420');
  }, [shareText, totalWallets]);

  return (
    <div className="flex gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={handleShareTwitter}
        title="Share results on Twitter/X"
        className="text-xs"
      >
        <svg
          className="w-3.5 h-3.5 mr-1.5"
          fill="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
        Share
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={handleShareFarcaster}
        title="Share results on Farcaster"
        className="text-xs text-purple-600 border-purple-200 hover:bg-purple-50 dark:text-purple-400 dark:border-purple-800 dark:hover:bg-purple-950"
      >
        <svg
          className="w-3.5 h-3.5 mr-1.5"
          fill="currentColor"
          viewBox="0 0 200 175"
          aria-hidden="true"
        >
          <path d="M200 0V23.6302H176.288V47.2404H183.553V47.2483H200V175H160.281L160.256 174.883L139.989 79.3143C138.057 70.2043 133 61.9616 125.751 56.0995C118.502 50.2376 109.371 47.0108 100.041 47.0108H99.9613C90.631 47.0108 81.5 50.2376 74.251 56.0995C67.0023 61.9616 61.9453 70.2073 60.013 79.3143L39.7223 175H0V47.2453H16.4475V47.2404H23.7114V23.6302H0V0H200Z" />
        </svg>
        Share
      </Button>
    </div>
  );
});
