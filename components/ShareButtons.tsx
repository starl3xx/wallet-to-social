'use client';

import { memo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { MenuItem } from '@/components/ui/overflow-menu';
import { XMark, FarcasterMark } from '@/components/ui/brand-marks';
import { Analytics } from '@/lib/client-analytics';
import type { ResultCounts } from '@/lib/result-counts';

interface ShareButtonsProps {
  /**
   * The whole count set, not four loose numbers.
   *
   * It used to take `twitterCount`, `farcasterCount`, `totalWallets` and
   * `reachableCount`, each computed by the caller with its own filter. Both
   * of this component's recorded defects are that shape: the first published
   * `(twitter + farcaster) / total`, which double-counts everyone holding
   * both; the second inherited the caller's `r.twitter_handle || r.farcaster`
   * predicate, which is exactly what the match gate strips, so a gated lookup
   * shared a rate lower than the product achieved.
   *
   * Handing over the derivation instead of its results is what stops a third.
   */
  counts: ResultCounts;
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
  counts,
  asMenuItems,
}: ShareButtonsProps) {
  const { total, found, twitter, farcaster, matchRate } = counts;

  /**
   * What the lookup FOUND, which on a gated run is not what is on screen.
   *
   * Two things had to be true here and only one was. The rate must count each
   * wallet once, not once per platform: the first version published
   * `(twitter + farcaster) / total` and turned a real 30.8% result into "49%
   * match rate", an outward overstatement of the number this product is sold
   * on. And it must count the rows the gate withheld: the second version
   * filtered on the identity fields the gate strips, so somebody who hit the
   * gate posted a rate LOWER than the product achieved, to the surface that
   * brings other people here. A gate that quietly cuts the product's own
   * social proof is the worst place for this particular bug to live.
   *
   * `countResults` answers both. Nothing is recomputed in this file.
   */
  const rate = Math.round(Number(matchRate));

  const shareText = `Just resolved ${total.toLocaleString()} wallets with walletlink.social: ${found.toLocaleString()} found (${rate}%), ${twitter.toLocaleString()} on X and ${farcaster.toLocaleString()} on Farcaster`;

  const handleShareTwitter = useCallback(() => {
    Analytics.exportClicked('share_twitter', total);
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent('https://walletlink.social')}`;
    window.open(url, '_blank', 'noopener,noreferrer,width=550,height=420');
  }, [shareText, total]);

  const handleShareFarcaster = useCallback(() => {
    Analytics.exportClicked('share_farcaster', total);
    const url = `https://warpcast.com/~/compose?text=${encodeURIComponent(shareText + '\n\nhttps://walletlink.social')}`;
    window.open(url, '_blank', 'noopener,noreferrer,width=550,height=420');
  }, [shareText, total]);

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
        title="Share results on X"
      >
        <XMark className="h-4 w-4" />
        Share
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={handleShareFarcaster}
        title="Share results on Farcaster"
      >
        <FarcasterMark className="h-4 w-4" />
        Share
      </Button>
    </div>
  );
});
