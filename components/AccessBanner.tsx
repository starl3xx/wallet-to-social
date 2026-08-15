'use client';

import { useState } from 'react';
import { Lightning as Zap, Crown, Sparkle as Sparkles, SignIn as LogIn, SignOut as LogOut, CaretDown as ChevronDown, Rocket, Key as KeyRound } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { TIER_LIMITS } from '@/lib/access';
import { AuthModal } from '@/components/AuthModal';
import { ApiKeysModal } from '@/components/ApiKeysModal';
import { useAuth } from '@/components/AuthProvider';

interface AccessBannerProps {
  tier: 'free' | 'starter' | 'pro' | 'unlimited';
  isWhitelisted?: boolean;
  walletsRemaining?: number | null;
  onUpgradeClick?: () => void;
}

export function AccessBanner({
  tier,
  isWhitelisted,
  walletsRemaining,
  onUpgradeClick,
}: AccessBannerProps) {
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [apiKeysOpen, setApiKeysOpen] = useState(false);
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
            className="flex items-center gap-1 sm:gap-1.5 px-1.5 sm:px-2 py-1 rounded-lg text-xs sm:text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          >
            <span className="max-w-[80px] sm:max-w-[150px] truncate">{user.email}</span>
            <ChevronDown className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
          </button>

          {showDropdown && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setShowDropdown(false)}
              />
              <div className="absolute right-0 top-full mt-1 z-50 bg-popover border rounded-lg shadow-lg py-1 min-w-[160px]">
                {/* Shown to every signed-in account, not just the tiers that
                    have API access. For Free the modal explains what the API
                    does and routes to plans, which is a better answer than
                    hiding the entrance entirely. */}
                <button
                  onClick={() => {
                    setShowDropdown(false);
                    setApiKeysOpen(true);
                  }}
                  className="flex items-center gap-2 w-full px-3 py-2 text-sm text-left hover:bg-muted transition-colors"
                >
                  <KeyRound className="h-4 w-4" />
                  API keys
                </button>
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
          className="h-6 sm:h-7 px-1.5 sm:px-2 text-xs sm:text-sm gap-1 sm:gap-1.5"
          onClick={() => setAuthModalOpen(true)}
        >
          <LogIn className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
          <span className="hidden sm:inline">Sign in</span>
          <span className="sm:hidden">Login</span>
        </Button>
        <AuthModal open={authModalOpen} onOpenChange={setAuthModalOpen} />
      </>
    );
  };

  // Tier badge content
  const TierBadge = () => {
    /**
     * The tiers are a ladder, so they read as one hue at increasing weight
     * rather than four unrelated colours. Whitelisted keeps amber because it is
     * a state rather than a rung, and green is deliberately absent: it now means
     * attestation everywhere in the product, and Starter is not more attested
     * than Pro.
     */
    if (isWhitelisted) {
      return (
        <div className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg bg-caution-tint text-xs sm:text-sm">
          <Sparkles className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-caution" />
          <span className="font-medium text-caution">Whitelisted</span>
        </div>
      );
    }

    if (tier === 'unlimited') {
      return (
        <div className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg bg-accent-brand-hover text-xs sm:text-sm">
          <Crown className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-accent-brand-foreground" />
          <span className="font-medium text-accent-brand-foreground">
            Unlimited
          </span>
        </div>
      );
    }

    if (tier === 'starter') {
      return (
        <div className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg bg-accent-brand-tint text-xs sm:text-sm">
          <Rocket className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-accent-brand" />
          <span className="font-medium text-accent-brand">Starter</span>
          <span className="text-muted-foreground hidden sm:inline">
            {walletsRemaining !== null && walletsRemaining !== undefined
              ? `${walletsRemaining.toLocaleString()} left`
              : '10,000 total'}
          </span>
        </div>
      );
    }

    if (tier === 'pro') {
      return (
        <div className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg bg-accent-brand text-xs sm:text-sm">
          <Zap className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-accent-brand-foreground" />
          <span className="font-medium text-accent-brand-foreground">Pro</span>
          <span className="text-accent-brand-foreground/75 hidden sm:inline">
            {TIER_LIMITS.pro.toLocaleString()} wallets
          </span>
        </div>
      );
    }

    // Free tier - show upgrade CTA
    return (
      <div className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg bg-muted/50 border text-xs sm:text-sm">
        <span className="text-muted-foreground">
          <span className="sm:hidden">Free</span>
          <span className="hidden sm:inline">Free ({TIER_LIMITS.free.toLocaleString()} wallets)</span>
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-5 sm:h-6 px-1.5 sm:px-2 text-xs"
          onClick={onUpgradeClick}
        >
          <Zap className="h-3 w-3 mr-0.5 sm:mr-1" />
          <span className="hidden sm:inline">Upgrade</span>
          <span className="sm:hidden">+</span>
        </Button>
      </div>
    );
  };

  return (
    <div className="flex items-center gap-3 flex-shrink-0">
      <TierBadge />
      <AuthSection />
      {/* Rendered outside AuthSection: that component returns early while the
          session is loading, which would unmount an open modal mid-use. */}
      <ApiKeysModal
        open={apiKeysOpen}
        onOpenChange={setApiKeysOpen}
        tier={tier}
        onUpgradeClick={onUpgradeClick}
      />
    </div>
  );
}
