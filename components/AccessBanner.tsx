'use client';

import { useState } from 'react';
import { Zap, Crown, Sparkles, LogIn, LogOut, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TIER_LIMITS } from '@/lib/access';
import { AuthModal } from '@/components/AuthModal';
import { useAuth } from '@/components/AuthProvider';

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
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const { user, isLoading, signOut } = useAuth();

  const handleSignOut = async () => {
    setShowDropdown(false);
    await signOut();
  };

  // Authenticated user UI (displayed alongside tier badge)
  const AuthSection = () => {
    if (isLoading) {
      return null;
    }

    if (user) {
      return (
        <div className="relative">
          <button
            onClick={() => setShowDropdown(!showDropdown)}
            className="flex items-center gap-1.5 px-2 py-1 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          >
            <span className="max-w-[150px] truncate">{user.email}</span>
            <ChevronDown className="h-3.5 w-3.5" />
          </button>

          {showDropdown && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setShowDropdown(false)}
              />
              <div className="absolute right-0 top-full mt-1 z-50 bg-popover border rounded-md shadow-lg py-1 min-w-[140px]">
                <button
                  onClick={handleSignOut}
                  className="flex items-center gap-2 w-full px-3 py-2 text-sm text-left hover:bg-muted transition-colors"
                >
                  <LogOut className="h-4 w-4" />
                  Sign out
                </button>
              </div>
            </>
          )}
        </div>
      );
    }

    // Not authenticated - show sign in button
    return (
      <>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-sm gap-1.5"
          onClick={() => setAuthModalOpen(true)}
        >
          <LogIn className="h-3.5 w-3.5" />
          Sign in
        </Button>
        <AuthModal open={authModalOpen} onOpenChange={setAuthModalOpen} />
      </>
    );
  };

  // Tier badge content
  const TierBadge = () => {
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
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/50 border text-sm">
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
  };

  return (
    <div className="flex items-center gap-3 flex-shrink-0">
      <TierBadge />
      <AuthSection />
    </div>
  );
}
