'use client';

import { useState } from 'react';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalDescription,
} from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Check, Zap, Crown, Loader2 } from 'lucide-react';
import { TIER_LIMITS, TIER_PRICES } from '@/lib/access';

interface UpgradeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentTier?: string;
  walletCount?: number;
  onRestoreAccess?: (email: string) => void;
}

const FEATURES = {
  free: [
    'Up to 1,000 wallets',
    'Web3.bio API only',
    'Basic CSV export',
    'Twitter/Farcaster handles',
  ],
  pro: [
    'Up to 10,000 wallets',
    'All APIs (Web3.bio + Neynar)',
    'ENS onchain lookups',
    'FC follower counts',
    'Priority score ranking',
    'Twitter list export',
  ],
  unlimited: [
    'Unlimited wallets',
    'All APIs (Web3.bio + Neynar)',
    'ENS onchain lookups',
    'FC follower counts',
    'Priority score ranking',
    'Twitter list export',
    'Priority support',
  ],
};

export function UpgradeModal({
  open,
  onOpenChange,
  currentTier = 'free',
  walletCount,
  onRestoreAccess,
}: UpgradeModalProps) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState<'pro' | 'unlimited' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRestore, setShowRestore] = useState(false);

  const handleUpgrade = async (tier: 'pro' | 'unlimited') => {
    if (!email || !email.includes('@')) {
      setError('Please enter a valid email');
      return;
    }

    setLoading(tier);
    setError(null);

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

      // Redirect to Stripe checkout
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout failed');
      setLoading(null);
    }
  };

  const handleRestore = () => {
    if (!email || !email.includes('@')) {
      setError('Please enter a valid email');
      return;
    }

    localStorage.setItem('user_email', email);
    onRestoreAccess?.(email);
    onOpenChange(false);
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent className="max-w-3xl">
        <ModalHeader>
          <ModalTitle className="text-2xl">Upgrade Your Plan</ModalTitle>
          <ModalDescription>
            {walletCount
              ? `Your file has ${walletCount.toLocaleString()} wallets. ${currentTier === 'free' ? 'Free tier is limited to 1,000 wallets.' : ''}`
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
                setError(null);
              }}
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          {/* Pricing cards */}
          <div className="grid gap-4 md:grid-cols-2">
            {/* Pro tier */}
            <div className="rounded-lg border p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Zap className="h-5 w-5 text-blue-500" />
                  <h3 className="font-semibold">Pro</h3>
                </div>
                <span className="text-2xl font-bold">${TIER_PRICES.pro}</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Up to {TIER_LIMITS.pro.toLocaleString()} wallets
              </p>
              <ul className="space-y-2">
                {FEATURES.pro.map((feature) => (
                  <li key={feature} className="flex items-center gap-2 text-sm">
                    <Check className="h-4 w-4 text-green-500" />
                    {feature}
                  </li>
                ))}
              </ul>
              <Button
                className="w-full"
                onClick={() => handleUpgrade('pro')}
                disabled={loading !== null}
              >
                {loading === 'pro' ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  'Upgrade to Pro'
                )}
              </Button>
            </div>

            {/* Unlimited tier */}
            <div className="rounded-lg border-2 border-primary p-4 space-y-4 relative">
              <div className="absolute -top-3 left-4 bg-primary text-primary-foreground px-2 py-0.5 rounded text-xs font-medium">
                Best Value
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Crown className="h-5 w-5 text-yellow-500" />
                  <h3 className="font-semibold">Unlimited</h3>
                </div>
                <span className="text-2xl font-bold">${TIER_PRICES.unlimited}</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Unlimited wallets forever
              </p>
              <ul className="space-y-2">
                {FEATURES.unlimited.map((feature) => (
                  <li key={feature} className="flex items-center gap-2 text-sm">
                    <Check className="h-4 w-4 text-green-500" />
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

          {/* Restore access link */}
          <div className="text-center pt-2">
            {showRestore ? (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Enter the email you used for payment:
                </p>
                <Button variant="outline" size="sm" onClick={handleRestore}>
                  Restore Access
                </Button>
              </div>
            ) : (
              <button
                className="text-sm text-muted-foreground hover:text-foreground underline"
                onClick={() => setShowRestore(true)}
              >
                Already paid? Restore access
              </button>
            )}
          </div>
        </div>
      </ModalContent>
    </Modal>
  );
}
