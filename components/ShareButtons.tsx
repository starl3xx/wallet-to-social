'use client';

import { memo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { MenuItem } from '@/components/ui/overflow-menu';
import { XMark, FarcasterMark } from '@/components/ui/brand-marks';
import { Analytics } from '@/lib/client-analytics';

interface ShareButtonsProps {
  twitterCount: number;
  farcasterCount: number;
  totalWallets: number;
  /**
   * Distinct wallets reachable on any platform, which is NOT
   * `twitterCount + farcasterCount`: most people with a Farcaster account also
   * have an X handle, so adding the two counts each of them twice.
   *
   * This is the same figure the results header states, and it has to be passed
   * in rather than derived here, because the overlap is only knowable from the
   * rows themselves.
   */
  reachableCount: number;
  /**
   * Render as overflow-menu rows rather than standalone buttons.
   *
   * Sharing is a secondary action, so in the results header it lives in the menu
   * with everything past the third control. The share *logic* is the same either
   * way, which is why this is a prop rather than a second component.
   */
  asMenuItems?: boolean;
}

export const ShareButtons = memo(function ShareButtons({
  twitterCount,
  farcasterCount,
  totalWallets,
  reachableCount,
  asMenuItems,
}: ShareButtonsProps) {
  /**
   * Distinct reachable over total, matching the results header exactly.
   *
   * This was `(twitterCount + farcasterCount) / totalWallets`, which
   * double-counts everyone holding both accounts. On a real 1,057-wallet lookup
   * that published "49% match rate" for a result the product itself reported as
   * 30.8%: an outward-facing overstatement of the one number walletlink is sold
   * on, in the copy most likely to be read by a prospect.
   */
  const matchRate = totalWallets > 0
    ? Math.round((reachableCount / totalWallets) * 100)
    : 0;

  const shareText = `Just resolved ${totalWallets.toLocaleString()} wallets with walletlink.social: ${reachableCount.toLocaleString()} reachable (${matchRate}%), ${twitterCount.toLocaleString()} on X and ${farcasterCount.toLocaleString()} on Farcaster`;

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

  if (asMenuItems) {
    return (
      <>
        <MenuItem onClick={handleShareTwitter}>
          <XMark className="h-4 w-4" />
          Share on X
        </MenuItem>
        <MenuItem onClick={handleShareFarcaster}>
          <FarcasterMark className="h-4 w-4" />
          Share on Farcaster
        </MenuItem>
      </>
    );
  }

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
        className="text-xs text-accent-brand border-accent-brand hover:bg-accent-brand-tint dark:border-accent-brand dark:hover:bg-accent-brand-tint"
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
