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
  /** Rendered between the tier chip and the account control. */
  trailing?: React.ReactNode;
}

/**
 * Every tier state is the same object: a badge, not a control.
 *
 * These were five hand-rolled divs with `py-1 sm:py-1.5`, so their height came
 * from padding and landed somewhere near 28px in a row of 40px controls. A status
 * chip should not compete with the things you can press, which is what the badge
 * treatment already encodes: uppercase mono, chip radius, tint fill, no border.
 */
const CHIP = 'inline-flex h-8 items-center gap-1.5 rounded-sm px-2.5 font-mono text-xs uppercase tracking-[0.14em]';

export function AccessBanner({
  tier,
  isWhitelisted,
  walletsRemaining,
  onUpgradeClick,
  trailing,
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
        <div className={`${CHIP} bg-attested-tint text-attested`}>
          <span className="h-1.5 w-1.5 flex-none rounded-full bg-attested" aria-hidden />
          <span className="font-medium text-attested">Whitelisted</span>
        </div>
      );
    }

    if (tier === 'unlimited') {
      return (
        <div className={`${CHIP} bg-accent-brand text-accent-brand-foreground`}>
          <Crown className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-accent-brand-foreground" />
          <span className="font-medium text-accent-brand-foreground">
            Unlimited
          </span>
        </div>
      );
    }

    if (tier === 'starter') {
      return (
        <div className={`${CHIP} bg-accent-brand-tint text-accent-brand`}>
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
        <div className={`${CHIP} bg-accent-brand text-accent-brand-foreground`}>
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
      <div className={`${CHIP} bg-muted text-muted-foreground`}>
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
    <div className="flex flex-shrink-0 items-center gap-2">
      <TierBadge />
      {/* The theme control sits between status and account: an avatar is the
          conventional end of a header row, and burying it mid-row makes the
          whole cluster read as three unrelated chips. */}
      {trailing}
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
