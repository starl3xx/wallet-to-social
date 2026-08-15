'use client';

import { useState, useEffect } from 'react';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalDescription,
} from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Check, Lightning as Zap, Crown, CircleNotch as Loader2, Rocket } from '@phosphor-icons/react';
import { TIER_LIMITS, TIER_PRICES, type PaidTier } from '@/lib/access';
import { apiAllowanceLabel } from '@/lib/api-plans';
import { Analytics } from '@/lib/client-analytics';

interface UpgradeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentTier?: string;
  walletCount?: number;
}

const FEATURES = {
  free: [
    'Up to 500 wallets/lookup',
    'Basic data sources',
    'Basic CSV export',
    'Twitter/Farcaster handles',
    '1 saved lookup',
  ],
  pro: [
    'Up to 5,000 wallets/lookup',
    'Import from contract address',
    `API access (${apiAllowanceLabel('pro')})`,
    'Reverse lookup: 𝕏 handle or Farcaster username → wallets',
    'All data sources',
    'Deep scan with onchain ENS',
    'Farcaster follower counts',
    'Priority score ranking',
    'Twitter list export',
    'Full lookup history',
  ],
  unlimited: [
    'Unlimited wallets/lookup',
    'Import from contract address',
    `API access (${apiAllowanceLabel('unlimited')})`,
    'Reverse lookup: 𝕏 handle or Farcaster username → wallets',
    'All data sources',
    'Deep scan with onchain ENS',
    'Farcaster follower counts',
    'Priority score ranking',
    'Twitter list export',
    'Full lookup history',
    'Grow a saved lookup, and see what is new since you last opened it',
    'Mass Farcaster DMs',
    'Priority support',
  ],
};

export function UpgradeModal({
  open,
  onOpenChange,
  currentTier = 'free',
  walletCount,
}: UpgradeModalProps) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState<PaidTier | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Track modal view when opened
  useEffect(() => {
    if (open) {
      const trigger = walletCount ? 'limit' : 'feature';
      Analytics.upgradeModalViewed(trigger, currentTier);
    }
  }, [open, walletCount, currentTier]);

  const handleUpgrade = async (tier: PaidTier) => {
    if (!email || !email.includes('@')) {
      setError('Please enter a valid email');
      return;
    }

    setLoading(tier);
    setError(null);

    // Track checkout started
    Analytics.checkoutStarted(tier);

    try {
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, tier }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Checkout failed');
      }

      // Store email for post-payment access check
      localStorage.setItem('user_email', email);

      // Only now do we know Stripe actually gave us a session
      Analytics.checkoutRedirected(tier);

      // Redirect to Stripe checkout
      window.location.href = data.url;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Checkout failed';
      Analytics.checkoutFailed(tier, message);
      setError(message);
      setLoading(null);
    }
  };

  // Pro cannot serve a list larger than its per-lookup ceiling. Offering it
  // anyway means someone pays $99 and is still blocked by the exact lookup that
  // opened this modal, so the card is disabled and says why.
  const proCoversList = !walletCount || walletCount <= TIER_LIMITS.pro;

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      {/* The two buttons are the point of this modal, and they cannot share one
          footer because each belongs to a plan. So the card owns the scroll:
          its feature list scrolls and its button stays pinned to its bottom
          edge, which keeps both choices on screen at any height. */}
      <ModalContent className="max-w-4xl">
        <ModalHeader className="flex-none">
          <ModalTitle className="text-2xl">Upgrade your plan</ModalTitle>
          <ModalDescription>
            {walletCount
              ? `Your file has ${walletCount.toLocaleString()} wallets. ${
                  !proCoversList
                    ? `Pro covers up to ${TIER_LIMITS.pro.toLocaleString()} per lookup, so this list needs Unlimited.`
                    : currentTier === 'free'
                      ? `Free tier is limited to ${TIER_LIMITS.free.toLocaleString()} wallets.`
                      : ''
                }`
              : 'Get access to more wallets and premium features.'}
          </ModalDescription>
        </ModalHeader>

        {/* Only from `md` does this claim the height. On a phone the cards are
            stacked, so letting them run to their natural height and scrolling
            the modal body is the better reading experience, and it keeps the
            chain of `flex-1` off a layout that does not want it. */}
        <div className="flex flex-col gap-4 md:min-h-0 md:flex-1">
          {/* Email input */}
          <div className="flex-none space-y-2">
            <label className="text-sm font-medium">Email address</label>
            <Input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (error) setError(null); // Only clear error if there was one
              }}
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          {/* Pricing cards */}
          {/* `minmax(0,1fr)` says out loud that this row may be smaller than its
              cards, which is what lets each card's list scroll inside it.

              Measured, it is not currently required: this grid is a flex item
              with `flex: 1 1 0%`, so flex hands it a *definite* height, and a
              grid container with a definite height stretches an auto row to fit
              rather than sizing it to max-content. Chrome behaves identically
              with and without it at 713/533/413px.

              It stays because relying on that distinction is precisely what went
              wrong one level up: the dialog's grid had only a `max-height`,
              which is not a definite height, so its auto row grew to max-content
              and nothing clipped. Two grids, the same markup shape, opposite
              behaviour. Stating the shrink beats depending on which case you are
              in. */}
          <div className="grid items-stretch gap-4 md:min-h-0 md:flex-1 md:grid-cols-2 md:grid-rows-[minmax(0,1fr)]">
            {/* Pro tier */}
            <div className="flex min-h-0 flex-col gap-4 rounded-lg border p-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <div className="p-1.5 rounded-lg bg-accent-brand-tint">
                    <Zap className="h-4 w-4 text-accent-brand" />
                  </div>
                  <h3 className="font-semibold">Pro</h3>
                </div>
                <div>
                  <span className="text-2xl font-bold">${TIER_PRICES.pro}</span>
                  <span className="text-sm text-muted-foreground ml-1">one-time</span>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                Up to {TIER_LIMITS.pro.toLocaleString()} wallets/lookup
              </p>
              {/* The one part that gives way. Below `md` the cards are stacked
                  and the modal body scrolls instead, so this stays natural. */}
              <ul className="space-y-2 md:min-h-0 md:flex-1 md:overflow-y-auto">
                {FEATURES.pro.map((feature) => (
                  <li key={feature} className="flex items-center gap-2 text-sm">
                    <div className="rounded-full bg-success-light p-0.5">
                      <Check className="h-3 w-3 text-success-foreground" />
                    </div>
                    {feature}
                  </li>
                ))}
              </ul>
              <Button
                className="w-full flex-none"
                onClick={() => handleUpgrade('pro')}
                disabled={loading !== null || !proCoversList}
                title={
                  proCoversList
                    ? undefined
                    : `Pro covers up to ${TIER_LIMITS.pro.toLocaleString()} wallets per lookup`
                }
              >
                {loading === 'pro' ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Processing...
                  </>
                ) : proCoversList ? (
                  'Upgrade to Pro'
                ) : (
                  'Too small for this list'
                )}
              </Button>
            </div>

            {/* Unlimited tier */}
            <div className="relative flex min-h-0 flex-col gap-4 rounded-lg border-2 border-accent-brand p-4">
              <div className="absolute -top-3 left-4 bg-accent-brand text-accent-brand-foreground px-3 py-0.5 rounded-full text-xs font-medium">
                Best value
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <div className="p-1.5 rounded-lg bg-caution-tint">
                    <Crown className="h-4 w-4 text-caution" />
                  </div>
                  <h3 className="font-semibold">Unlimited</h3>
                </div>
                <div>
                  <span className="text-2xl font-bold">${TIER_PRICES.unlimited}</span>
                  <span className="text-sm text-muted-foreground ml-1">one-time</span>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                Unlimited wallets forever
              </p>
              {/* The one part that gives way. Below `md` the cards are stacked
                  and the modal body scrolls instead, so this stays natural. */}
              <ul className="space-y-2 md:min-h-0 md:flex-1 md:overflow-y-auto">
                {FEATURES.unlimited.map((feature) => (
                  <li key={feature} className="flex items-center gap-2 text-sm">
                    <div className="rounded-full bg-success-light p-0.5">
                      <Check className="h-3 w-3 text-success-foreground" />
                    </div>
                    {feature}
                  </li>
                ))}
              </ul>
              <Button
                className="w-full flex-none"
                variant="default"
                onClick={() => handleUpgrade('unlimited')}
                disabled={loading !== null}
              >
                {loading === 'unlimited' ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  'Upgrade to Unlimited'
                )}
              </Button>
            </div>
          </div>

        </div>
      </ModalContent>
    </Modal>
  );
}
