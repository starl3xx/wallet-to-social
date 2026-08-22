'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Check,
  CircleNotch as Loader2,
  Crown,
  Lightning as Zap,
} from '@phosphor-icons/react';
import { TIER_LIMITS, type UserTier } from '@/lib/access';

type VerificationState = 'verifying' | 'success' | 'error';

function SuccessContent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session_id');

  const [state, setState] = useState<VerificationState>('verifying');
  const [tier, setTier] = useState<UserTier | null>(null);
  /**
   * A pack purchase, which has no tier.
   *
   * Separate state rather than a widened `tier`, because they are different
   * things: a tier is a permanent entitlement and a pack is a credit balance.
   * Collapsing them is what showed a whitelisted account "Unlimited Plan" after
   * a $29 Trial, since `getUserAccess` reports whitelist access as `unlimited`.
   */
  const [pack, setPack] = useState<{
    name: string;
    matchesGranted: number;
    balance: number;
    /** Whether this browser is already signed in as the buyer. */
    signedInAsBuyer: boolean;
  } | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setError('No session ID provided');
      setState('error');
      return;
    }

    // Show the localStorage email immediately if we have one, purely so the
    // card isn't blank while polling. The authoritative address comes back
    // from the verified Stripe session below and overwrites it.
    const storedEmail = localStorage.getItem('user_email');
    if (storedEmail) {
      setEmail(storedEmail);
    }

    // Poll for access update
    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 30; // 30 seconds max
    const pollInterval = 1000;

    const checkAccess = async () => {
      if (cancelled) return;

      try {
        // Keyed on the Stripe session id, not an email. The session id is
        // unguessable and only Stripe hands it to the buyer, so this can't be
        // used to ask about anyone else's account.
        const response = await fetch(
          `/api/auth/checkout-status?session_id=${encodeURIComponent(sessionId)}`
        );
        const data = await response.json();
        if (cancelled) return;

        if (data.email) {
          setEmail(data.email);
        }

        // Packs first: a session carries one or the other, never both.
        if (data.pack) {
          setPack({
            name: data.packName,
            matchesGranted: data.matchesGranted,
            balance: data.balance,
            signedInAsBuyer: !!data.signedInAsBuyer,
          });
          setState('success');
          return;
        }

        if (data.tier && data.tier !== 'free') {
          setTier(data.tier);
          setState('success');
          return;
        }

        attempts++;
        if (attempts >= maxAttempts) {
          setError(
            'Payment verification is taking longer than expected. Your access will be updated shortly.'
          );
          setState('error');
          return;
        }

        // Keep polling
        setTimeout(checkAccess, pollInterval);
      } catch {
        if (cancelled) return;
        attempts++;
        if (attempts >= maxAttempts) {
          setError('Failed to verify payment. Please contact support.');
          setState('error');
        } else {
          setTimeout(checkAccess, pollInterval);
        }
      }
    };

    checkAccess();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const TierIcon = tier === 'unlimited' ? Crown : Zap;
  const tierColor = tier === 'unlimited' ? 'text-caution' : 'text-accent-brand';

  return (
    /* Deliberately NOT on PageShell. This is a post-payment interstitial, not a
       document: a single decision, reached once, with one way onward. Wrapping it
       in a header and a four-column navigation footer would invite people to
       wander off a confirmation screen, which is the opposite of its job. It still
       takes the tokens, because Card and Button are the same primitives everywhere
       else. Consistency is the design language applying, not every page having the
       same furniture. */
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          {state === 'verifying' && (
            <>
              <div className="flex justify-center mb-4">
                <Loader2 className="h-12 w-12 animate-spin text-muted-foreground" />
              </div>
              <CardTitle>Verifying payment...</CardTitle>
            </>
          )}

          {state === 'success' && (
            <>
              <div className="flex justify-center mb-4">
                <div className="rounded-full bg-accent-brand/10 p-3">
                  <Check className="h-12 w-12 text-accent-brand" />
                </div>
              </div>
              <CardTitle className="text-2xl">Payment successful!</CardTitle>
            </>
          )}

          {state === 'error' && (
            <>
              <div className="flex justify-center mb-4">
                <div className="rounded-full bg-caution/10 p-3">
                  <Loader2 className="h-12 w-12 text-caution" />
                </div>
              </div>
              <CardTitle>Verification pending</CardTitle>
            </>
          )}
        </CardHeader>

        <CardContent className="space-y-4">
          {state === 'verifying' && (
            <p className="text-center text-muted-foreground">
              Please wait while we confirm your payment...
            </p>
          )}

          {state === 'success' && pack && (
            <>
              <div className="flex items-center justify-center gap-2 rounded-lg bg-muted py-4">
                <Zap className="h-6 w-6 text-accent-brand" />
                <span className="text-lg font-semibold">{pack.name} pack</span>
              </div>

              <div className="space-y-2 text-sm">
                <p className="text-center text-muted-foreground">
                  {pack.matchesGranted.toLocaleString()} matches added. Your
                  balance is{' '}
                  <span className="font-medium text-foreground">
                    {pack.balance.toLocaleString()}
                  </span>
                  .
                </p>
                <ul className="space-y-1">
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-accent-brand" />
                    You are charged only for wallets we resolve
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-accent-brand" />
                    All seven chains, uncapped CSV export
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-accent-brand" />
                    API access, drawing the same credits
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-accent-brand" />
                    Credits last 12 months
                  </li>
                </ul>
              </div>

              {email && (
                <p className="text-center text-sm text-muted-foreground">
                  Credits added to: <span className="font-medium">{email}</span>
                </p>
              )}

              {/* Checkout does not require an account, so most buyers arrive
                  here signed out, holding credits on an account they have no
                  way into. Saying so is the point: the alternative was a button
                  back to a signed-out app with no explanation. */}
              {!pack.signedInAsBuyer && (
                <div className="rounded-lg border border-accent-brand bg-accent-brand-tint p-4">
                  <p className="text-sm">
                    <span className="font-medium">
                      Check your email to sign in.
                    </span>{' '}
                    We sent a link to {email || 'your address'}. Your credits
                    are waiting on that account.
                  </p>
                </div>
              )}

              <Button asChild className="w-full">
                <Link href="/">
                  {pack.signedInAsBuyer
                    ? 'Start Using walletlink.social'
                    : 'Back to walletlink.social'}
                </Link>
              </Button>
            </>
          )}

          {state === 'success' && tier && !pack && (
            <>
              <div className="flex items-center justify-center gap-2 py-4 bg-muted rounded-lg">
                <TierIcon className={`h-6 w-6 ${tierColor}`} />
                <span className="text-lg font-semibold capitalize">
                  {tier} Plan
                </span>
              </div>

              <div className="space-y-2 text-sm">
                <p className="text-center text-muted-foreground">
                  You now have access to:
                </p>
                <ul className="space-y-1">
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-accent-brand" />
                    {tier === 'unlimited'
                      ? 'Unlimited wallets'
                      : `Up to ${TIER_LIMITS[tier].toLocaleString()} wallets`}
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-accent-brand" />
                    All data sources
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-accent-brand" />
                    FC follower counts & priority scoring
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-accent-brand" />
                    Deep scan with onchain ENS
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-accent-brand" />
                    Twitter list export
                  </li>
                </ul>
              </div>

              {email && (
                <p className="text-center text-sm text-muted-foreground">
                  Access linked to: <span className="font-medium">{email}</span>
                </p>
              )}

              <Button asChild className="w-full">
                <Link href="/">Start Using walletlink.social</Link>
              </Button>
            </>
          )}

          {state === 'error' && (
            <>
              <p className="text-center text-muted-foreground">{error}</p>
              {email && (
                <p className="text-center text-sm text-muted-foreground">
                  Check your email: <span className="font-medium">{email}</span>
                </p>
              )}
              <div className="flex gap-2">
                <Button variant="outline" asChild className="flex-1">
                  <Link href="/">Go to App</Link>
                </Button>
                <Button
                  className="flex-1"
                  onClick={() => {
                    setState('verifying');
                    window.location.reload();
                  }}
                >
                  Retry
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function SuccessPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <SuccessContent />
    </Suspense>
  );
}
