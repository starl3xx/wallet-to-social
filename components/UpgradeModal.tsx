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
import { Check, Zap, Crown, Loader2, Rocket } from 'lucide-react';
import { TIER_LIMITS, TIER_PRICES } from '@/lib/access';
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
    'Reverse lookup: handle → wallets',
    'All data sources',
    'ENS onchain lookups',
    'Farcaster follower counts',
    'Priority score ranking',
    'Twitter list export',
    'Full lookup history',
    'Add addresses to lookups',
  ],
  unlimited: [
    'Unlimited wallets/lookup',
    'Import from contract address',
    `API access (${apiAllowanceLabel('unlimited')})`,
    'Reverse lookup: handle → wallets',
    'All data sources',
    'ENS onchain lookups',
    'Farcaster follower counts',
    'Priority score ranking',
    'Twitter list export',
    'Full lookup history',
    'Add addresses to lookups',
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
  const [loading, setLoading] = useState<'starter' | 'pro' | 'unlimited' | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Track modal view when opened
  useEffect(() => {
    if (open) {
      const trigger = walletCount ? 'limit' : 'feature';
      Analytics.upgradeModalViewed(trigger, currentTier);
    }
  }, [open, walletCount, currentTier]);

  const handleUpgrade = async (tier: 'starter' | 'pro' | 'unlimited') => {
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
      <ModalContent className="max-w-4xl">
        <ModalHeader>
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

        <div className="space-y-4">
          {/* Email input */}
          <div className="space-y-2">
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
          <div className="grid gap-4 md:grid-cols-2">
            {/* Pro tier */}
            <div className="rounded-lg border p-4 space-y-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <div className="p-1.5 rounded-lg bg-blue-50 dark:bg-blue-500/10">
                    <Zap className="h-4 w-4 text-blue-500" />
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
              <ul className="space-y-2">
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
                className="w-full"
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
            <div className="rounded-lg border-2 border-accent-brand p-4 space-y-4 relative">
              <div className="absolute -top-3 left-4 bg-accent-brand text-accent-brand-foreground px-3 py-0.5 rounded-full text-xs font-medium">
                Best value
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <div className="p-1.5 rounded-lg bg-amber-50 dark:bg-amber-500/10">
                    <Crown className="h-4 w-4 text-amber-500" />
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
              <ul className="space-y-2">
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
                className="w-full"
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
