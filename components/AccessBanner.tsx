'use client';

import { useState } from 'react';
import {
  Lightning as Zap,
  Crown,
  User,
  SignIn as LogIn,
  SignOut as LogOut,
  Key as KeyRound,
} from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { TIER_LIMITS, type UserTier } from '@/lib/access';
import { FREE_MATCHES_PER_WINDOW } from '@/lib/packs';
import { useCredits } from '@/lib/use-credits';
import { AuthModal } from '@/components/AuthModal';
import { ApiKeysModal } from '@/components/ApiKeysModal';
import { useAuth } from '@/components/AuthProvider';
import { cn } from '@/lib/utils';

interface AccessBannerProps {
  tier: UserTier;
  isWhitelisted?: boolean;
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
 *
 * **Every call site goes through `cn`, never a template string.** CHIP opens
 * with `inline-flex`, and a caller that adds `hidden` does not win: both are
 * plain `display` utilities of equal specificity, so the one
 * Tailwind emits later decides, and that is `.inline-flex`. Measured in Chrome,
 * `class="inline-flex hidden"` computes to `inline-flex`. The chip stayed
 * visible, and the 61px it was supposed to return to a 320px header did not
 * come back.
 *
 * `cn` runs tailwind-merge, which resolves same-variant conflicts by keeping the
 * last one, so `hidden` wins at the base and `sm:inline-flex` still applies from
 * `sm`. A concatenated class string cannot express "override", only "append".
 */
const CHIP =
  'inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 font-mono text-xs uppercase tracking-[var(--tracking-label)]';

export function AccessBanner({
  tier,
  isWhitelisted,
  onUpgradeClick,
  trailing,
}: AccessBannerProps) {
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [apiKeysOpen, setApiKeysOpen] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const { user, isLoading, signOut } = useAuth();
  /**
   * The balance, and whether paid features are unlocked.
   *
   * Both come from the one hook rather than a fetch here, so the chip, the API
   * keys modal and every gate on the page agree. `tier` cannot answer either
   * question: a pack buyer's tier is `free`.
   */
  const credits = useCredits(!!user);

  const handleSignOut = async () => {
    setShowDropdown(false);
    await signOut();
  };

  // Authenticated user UI (displayed alongside the status chip). A render
  // helper called as a function, not a component declared inside render: a
  // component created here would be a new type on every render and reset its
  // subtree's state each time.
  const renderAuthSection = () => {
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
            className="transition-control flex h-control w-control items-center justify-center rounded-full bg-accent-brand-tint text-accent-brand hover:bg-accent-brand hover:text-accent-brand-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
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
                {/* Shown to every signed-in account, not only the ones with
                    credits. Without them the modal explains what the API does
                    and routes to the packs, which is a better answer than
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
          /* No height override. size="sm" supplies the control height, and this
             was pinning the one control a signed-out visitor sees to 24px in a
             row of 34px ones. */
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

  // Status chip content. Same shape as renderAuthSection, for the same reason.
  const renderTierBadge = () => {
    /**
     * One hue family rather than four unrelated colours. The two legacy chips
     * take the brand fill; they are not for sale, so the chip is the only
     * place those names still appear to the account that holds them.
     *
     * Whitelisted is green. It was amber, and I argued for that on the grounds
     * that it is a state rather than a rung, which put good news in the hue
     * reserved for truncation, staleness and limits. Under the sharpened rule
     * green marks a measured fact, and having access is one.
     */
    if (isWhitelisted) {
      return (
        <div className={cn(CHIP, 'bg-attested-tint text-attested')}>
          <span
            className="h-1.5 w-1.5 flex-none rounded-full bg-attested"
            aria-hidden
          />
          <span className="font-medium text-attested">Whitelisted</span>
        </div>
      );
    }

    /**
     * The two legacy chips. Each is true only for the account that holds it:
     * never metered, no expiry. The `title` says so, because the product now
     * meters matches and a bare tier name or wallet cap would read as a rung
     * on a ladder that no longer exists.
     */
    if (tier === 'unlimited') {
      return (
        <div
          className={cn(CHIP, 'bg-accent-brand text-accent-brand-foreground')}
          title="Legacy Unlimited account: never metered, no expiry"
        >
          <Crown className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-accent-brand-foreground" />
          <span className="font-medium text-accent-brand-foreground">
            Unlimited
          </span>
        </div>
      );
    }

    if (tier === 'pro') {
      return (
        <div
          className={cn(CHIP, 'bg-accent-brand text-accent-brand-foreground')}
          title={`Legacy Pro account: up to ${TIER_LIMITS.pro.toLocaleString()} wallets per lookup, never metered`}
        >
          <Zap className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-accent-brand-foreground" />
          <span className="font-medium text-accent-brand-foreground">Pro</span>
          {/* The unit is spelt out. "5,000 wallets" alone read as a balance
              next to a product that counts matches; this is the per-lookup cap
              that account was sold, and it never goes down. */}
          <span className="text-accent-brand-foreground/75 hidden sm:inline">
            {TIER_LIMITS.pro.toLocaleString()} wallets per lookup
          </span>
        </div>
      );
    }

    // No legacy tier: the balance, and the way to add to it. This is everyone
    // who is not one of the two legacy accounts, pack holders included.
    // Deliberately NOT wrapped in CHIP. This is the only state containing an
    // action, and CHIP is a label treatment: its font-mono, tracking and muted
    // colour inherit straight into the Button and turn the one revenue CTA in the
    // header into muted label type. A balance readout and its CTA are a label and
    // an action, and those never share a treatment.
    return (
      <div className="flex items-center gap-2">
        {/* Desktop only, and not purely for room. This is the one state whose
            chip tells a visitor nothing they want: someone with no account does
            not need a badge saying so, they need the way in. The legacy chips
            stay at every width, because there the chip is the only thing
            saying the account is paid, and those rows are shorter anyway: no
            Buy credits button, and an avatar instead of "Sign in".

            It is also 61px of a header that measured 401px against a 375px
            screen, which is what made the choice worth making rather than
            merely arguable. */}
        {/* Matches, not wallets, and per rolling window rather than per
            lookup. It read "500 left" from TIER_LIMITS.free, which is the old
            per-lookup wallet cap: a number that never decreased however much
            somebody used, and that now describes nothing the product sells. */}
        <span
          className={cn(
            CHIP,
            'bg-muted text-muted-foreground',
            // A paid balance stays at every width (docs/DESIGN-LANGUAGE.md):
            // it is the one number a buyer came back to check. The free chip
            // goes below sm, because a visitor does not need a badge saying so.
            credits.entitled ? 'inline-flex' : 'hidden sm:inline-flex'
          )}
        >
          {credits.available === null
            ? `Free · ${FREE_MATCHES_PER_WINDOW} matches`
            : `${credits.available.toLocaleString()} matches`}
        </span>
        {/* "Buy credits", matching the modal it opens and what is actually
            sold. "Upgrade" named a tier ladder that no longer exists, and a
            control is labelled by function. */}
        <Button size="sm" className="btn-shine" onClick={onUpgradeClick}>
          <Zap className="h-3.5 w-3.5" weight="fill" />
          <span className="hidden sm:inline">Buy credits</span>
          <span className="sm:hidden">+</span>
        </Button>
      </div>
    );
  };

  return (
    <div className="flex flex-shrink-0 items-center gap-2">
      {renderTierBadge()}
      {/* The theme control sits between status and account: an avatar is the
          conventional end of a header row, and burying it mid-row makes the
          whole cluster read as three unrelated chips. */}
      {trailing}
      {renderAuthSection()}
      {/* Rendered outside renderAuthSection: that helper returns early while
          the session is loading, which would unmount an open modal mid-use. */}
      {/* Credits unlock a key, not a tier. `entitled` excludes the free
          allowance deliberately: those features were never part of free. */}
      <ApiKeysModal
        entitled={credits.entitled}
        open={apiKeysOpen}
        onOpenChange={setApiKeysOpen}
        tier={tier}
        onUpgradeClick={onUpgradeClick}
      />
    </div>
  );
}
