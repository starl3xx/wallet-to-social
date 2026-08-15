'use client';

import { useState } from 'react';
import { Lightning as Zap, Crown, User, SignIn as LogIn, SignOut as LogOut, CaretDown as ChevronDown, Rocket, Key as KeyRound } from '@phosphor-icons/react';
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
          {/* An avatar, not the address. A full email spends header width on
              something the person already knows, and truncating it to
              "jakebo..." spends the width and tells them nothing. The address
              still opens with the menu, where it identifies which account is
              signed in at the moment that actually matters. */}
          <button
            onClick={() => setShowDropdown(!showDropdown)}
            aria-label={`Account: ${user.email}`}
            title={user.email ?? undefined}
            className="transition-control flex h-10 w-10 items-center justify-center rounded-full bg-accent-brand-tint text-accent-brand hover:bg-accent-brand hover:text-accent-brand-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <User className="h-4 w-4" aria-hidden />
          </button>

          {showDropdown && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setShowDropdown(false)}
              />
              <div className="absolute right-0 top-full mt-1 z-50 bg-popover border rounded-lg shadow-lg py-1 min-w-[160px]">
                <div className="truncate border-b border-border px-3 pb-2 pt-1 font-mono text-xs text-muted-foreground">
                  {user.email}
                </div>
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
     * The tiers are a ladder, so they read as one hue at increasing weight rather
     * than four unrelated colours.
     *
     * Whitelisted is green. It was amber, and I argued for that on the grounds
     * that it is a state rather than a rung, which put good news in the hue
     * reserved for truncation, staleness and limits. Under the sharpened rule
     * green marks a measured fact, and having access is one.
     */
    if (isWhitelisted) {
      return (
        <div className="flex items-center gap-1.5 rounded-sm bg-attested-tint px-2 py-1 text-xs sm:gap-2 sm:px-2.5 sm:text-sm">
          <span className="h-1.5 w-1.5 flex-none rounded-full bg-attested" aria-hidden />
          <span className="font-medium text-attested">Whitelisted</span>
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
