'use client';

import { Zap, Crown, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TIER_LIMITS } from '@/lib/access';

interface AccessBannerProps {
  tier: 'free' | 'pro' | 'unlimited';
  isWhitelisted?: boolean;
  onUpgradeClick?: () => void;
}

export function AccessBanner({
  tier,
  isWhitelisted,
  onUpgradeClick,
}: AccessBannerProps) {
  if (isWhitelisted) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-500/10 text-sm">
        <Sparkles className="h-4 w-4 text-amber-500" />
        <span className="font-medium text-amber-600 dark:text-amber-400">
          Whitelisted
        </span>
      </div>
    );
  }

  if (tier === 'unlimited') {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-purple-50 dark:bg-purple-500/10 text-sm">
        <Crown className="h-4 w-4 text-purple-500" />
        <span className="font-medium text-purple-600 dark:text-purple-400">
          Unlimited
        </span>
      </div>
    );
  }

  if (tier === 'pro') {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-500/10 text-sm">
        <Zap className="h-4 w-4 text-blue-500" />
        <span className="font-medium text-blue-600 dark:text-blue-400">
          Pro
        </span>
        <span className="text-muted-foreground">
          {TIER_LIMITS.pro.toLocaleString()} wallets
        </span>
      </div>
    );
  }

  // Free tier - show upgrade CTA
  return (
    <div className="flex items-center gap-3 px-3 py-1.5 rounded-full bg-muted/50 border text-sm whitespace-nowrap flex-shrink-0">
      <span className="text-muted-foreground">
        Free ({TIER_LIMITS.free.toLocaleString()} wallets)
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-2 text-xs"
        onClick={onUpgradeClick}
      >
        <Zap className="h-3 w-3 mr-1" />
        Upgrade
      </Button>
    </div>
  );
}
