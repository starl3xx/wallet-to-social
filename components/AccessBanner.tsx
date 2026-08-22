'use client';

import { useState } from 'react';
import {
  Lightning as Zap,
  User,
  SignIn as LogIn,
  SignOut as LogOut,
  Key as KeyRound,
} from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { OverflowMenu, MenuItem } from '@/components/ui/overflow-menu';
import { TIER_LIMITS, type UserTier } from '@/lib/access';
import { FREE_MATCHES_PER_WINDOW } from '@/lib/packs';
import { useCredits } from '@/lib/use-credits';
import { AuthModal } from '@/components/AuthModal';
import { ApiKeysModal } from '@/components/ApiKeysModal';
import { useAuth } from '@/components/AuthProvider';
import { useUpgradeModal } from '@/components/UpgradeModalProvider';
import { cn } from '@/lib/utils';

interface AccessBannerProps {
  /** Rendered between the tier chip and the account control. */
  trailing?: React.ReactNode;
}

/**
 * The account cluster in the header: tier or balance, Buy credits, the
 * account control. PageShell renders it on every page.
 *
 * It used to take `tier`, `isWhitelisted` and `onUpgradeClick` from the
 * homepage, which was the only page that rendered it, so a signed-in buyer on
 * /vs/holder saw no balance, no account and no way to buy. All three now come
 * from context: tier and whitelist from `useAuth`, the buy-credits modal from
 * `useUpgradeModal`, so the shell can render this with no props.
 *
 * Every tier state is the same object: a badge, not a control.
 *
 * These were five hand-rolled divs with `py-1 sm:py-1.5`, so their height came
 * from padding and landed somewhere near 28px in a row of 40px controls. A status
 * chip should not compete with the things you can press, which is what the Badge
 * primitive already encodes: uppercase mono, chip radius, tint fill, no border.
 * A local CHIP string restated it with different padding, and the two legacy
 * chips then added a solid brand fill and a leading icon, which are two of the
 * four axes that make a button a button (docs/DESIGN-LANGUAGE.md, Affordance):
 * the one chip that says "you are a paying account" looked like something to
 * press. Badge's `brand` tone is the tint the primitive already names for
 * things that are ours.
 *
 * **Every class override goes through `cn`, never a template string.** Badge
 * opens with `inline-flex`, and a caller that adds `hidden` does not win: both
 * are plain `display` utilities of equal specificity, so the one Tailwind emits
 * later decides, and that is `.inline-flex`. Measured in Chrome,
 * `class="inline-flex hidden"` computes to `inline-flex`. The chip stayed
 * visible, and the 61px it was supposed to return to a 320px header did not
 * come back. `cn` runs tailwind-merge, which resolves same-variant conflicts by
 * keeping the last one, so `hidden` wins at the base and `sm:inline-flex` still
 * applies from `sm`.
 */
export function AccessBanner({ trailing }: AccessBannerProps) {
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [apiKeysOpen, setApiKeysOpen] = useState(false);
  const { user, isLoading, signOut } = useAuth();
  const upgradeModal = useUpgradeModal();
  const tier: UserTier = user?.tier ?? 'free';
  const isWhitelisted = user?.isWhitelisted ?? false;
  /**
   * The balance, and whether paid features are unlocked.
   *
   * Both come from the one hook rather than a fetch here, so the chip, the API
   * keys modal and every gate on the page agree. `tier` cannot answer either
   * question: a pack buyer's tier is `free`.
   */
  const credits = useCredits(!!user);

  // No list is in hand here, so no wallet count: the modal marks its default
  // pack. The in-flow buttons on the homepage pass the loaded list through
  // their own wrapper.
  const handleUpgradeClick = () => upgradeModal.open();

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
        /* The account menu is an OverflowMenu opened from the avatar, not a
           second dropdown. The hand-rolled one had no role="menu", no
           aria-expanded, no Escape, and a `fixed inset-0` click-catcher, which
           is the thing the Dialogs section says never to build a popover out
           of. One menu implementation, one set of keyboard and ARIA behaviour;
           the menu closes itself after any item is chosen. */
        <OverflowMenu
          trigger={
            /* An avatar, not the address. A full email spends header width on
               something the person already knows, and truncating it to
               "jakebo..." spends the width and tells them nothing. The address
               still opens with the menu, where it identifies which account is
               signed in at the moment that actually matters. */
            <button
              type="button"
              aria-label={`Account: ${user.email}`}
              title={user.email ?? undefined}
              className="transition-control flex size-control items-center justify-center rounded-full bg-accent-brand-tint text-accent-brand hover:bg-accent-brand hover:text-accent-brand-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <User className="h-4 w-4" aria-hidden />
            </button>
          }
        >
          {/* Which account is signed in. Not an item: it is read, never
              chosen, so it carries no menuitem role and sits above a hairline
              in the mono the product uses for an address in its own cell. */}
          <div
            role="presentation"
            className="mb-1 truncate border-b border-border px-2.5 pb-2 pt-1 font-mono text-xs text-muted-foreground"
          >
            {user.email}
          </div>
          {/* Shown to every signed-in account, not only the ones with
              credits. Without them the modal explains what the API does
              and routes to the packs, which is a better answer than
              hiding the entrance entirely. */}
          <MenuItem onClick={() => setApiKeysOpen(true)}>
            <KeyRound className="h-4 w-4" aria-hidden />
            API keys
          </MenuItem>
          <MenuItem onClick={() => void signOut()}>
            <LogOut className="h-4 w-4" aria-hidden />
            Sign out
          </MenuItem>
        </OverflowMenu>
      );
    }

    // Not authenticated: the way in. "Sign in" at every width. It read
    // "Login" below sm to save 8px while the AuthModal title, the My lookups
    // card and the rate-limit message all said "Sign in"; one control, one
    // word. The 8px comes back from Buy credits collapsing to its icon.
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
          <LogIn className="h-4 w-4" />
          Sign in
        </Button>
        <AuthModal open={authModalOpen} onOpenChange={setAuthModalOpen} />
      </>
    );
  };

  // Status chip content. Same shape as renderAuthSection, for the same reason.
  const renderTierBadge = () => {
    /**
     * One hue family rather than four unrelated colours. The two legacy chips
     * take the brand tint; they are not for sale, so the chip is the only
     * place those names still appear to the account that holds them.
     *
     * Whitelisted is green. It was amber, and I argued for that on the grounds
     * that it is a state rather than a rung, which put good news in the hue
     * reserved for truncation, staleness and limits. Under the sharpened rule
     * green marks a measured fact, and having access is one.
     */
    if (isWhitelisted) {
      // max-w-none: a fixed word plus the dot runs past the 12ch cap, and a
      // badge that says "WHITELISTE…" is worse than no badge.
      return (
        <Badge tone="attested" className="max-w-none">
          {/* inline-block, because Badge wraps its children in a truncating
              span and a flex-only dot would collapse inside it. */}
          <span
            className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-attested align-middle"
            aria-hidden
          />
          Whitelisted
        </Badge>
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
        <Badge
          tone="brand"
          title="Legacy Unlimited account: never metered, no expiry"
        >
          Unlimited
        </Badge>
      );
    }

    if (tier === 'pro') {
      return (
        <Badge
          tone="brand"
          // A fixed string, so the 12ch cap is lifted explicitly: the unit
          // is spelt out. "5,000 wallets" alone read as a balance next to a
          // product that counts matches; this is the per-lookup cap that
          // account was sold, and it never goes down.
          className="max-w-none"
          title={`Legacy Pro account: up to ${TIER_LIMITS.pro.toLocaleString()} wallets per lookup, never metered`}
        >
          Pro
          <span className="hidden sm:inline">
            {' '}
            · {TIER_LIMITS.pro.toLocaleString()} wallets per lookup
          </span>
        </Badge>
      );
    }

    // No legacy tier: the balance, and the way to add to it. This is everyone
    // who is not one of the two legacy accounts, pack holders included.
    // The balance is a Badge and the CTA is a Button: a label and an action,
    // and those never share a treatment.
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
        <Badge
          tone="muted"
          className={cn(
            // A fixed string, never user data, so the 12ch cap is lifted.
            'max-w-none',
            // A paid balance stays at every width (docs/DESIGN-LANGUAGE.md):
            // it is the one number a buyer came back to check. The free chip
            // goes below sm, because a visitor does not need a badge saying so.
            credits.entitled ? 'inline-flex' : 'hidden sm:inline-flex'
          )}
        >
          {credits.available === null
            ? `Free · ${FREE_MATCHES_PER_WINDOW} matches`
            : `${credits.available.toLocaleString()} matches`}
        </Badge>
        {/* "Buy credits", matching the modal it opens and what is actually
            sold. "Upgrade" named a tier ladder that no longer exists, and a
            control is labelled by function.

            Below sm it is the icon control the Button already defines, with
            its name in aria-label and title. It collapsed to a "+" beside the
            bolt, which gave the control an accessible name of "+" and read as
            "more power"; an icon inside a filled enclosure already reads as a
            control, and the round icon size is narrower than the pill was,
            which is what lets "Sign in" keep its word. */}
        <Button
          size="icon"
          className="btn-shine sm:hidden"
          onClick={handleUpgradeClick}
          aria-label="Buy credits"
          title="Buy credits"
        >
          <Zap className="h-4 w-4" weight="fill" />
        </Button>
        <Button
          size="sm"
          className="btn-shine hidden sm:inline-flex"
          onClick={handleUpgradeClick}
        >
          <Zap className="h-4 w-4" weight="fill" />
          Buy credits
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
        onUpgradeClick={handleUpgradeClick}
      />
    </div>
  );
}
