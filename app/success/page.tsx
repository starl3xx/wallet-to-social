'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Check, Loader2, Crown, Zap } from 'lucide-react';
import { TIER_LIMITS, type UserTier } from '@/lib/access';

type VerificationState = 'verifying' | 'success' | 'error';

function SuccessContent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session_id');

  const [state, setState] = useState<VerificationState>('verifying');
  const [tier, setTier] = useState<UserTier | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setError('No session ID provided');
      setState('error');
      return;
    }

    // Get email from localStorage (set during checkout)
    const storedEmail = localStorage.getItem('user_email');
    if (storedEmail) {
      setEmail(storedEmail);
    }

    // Poll for access update
    let attempts = 0;
    const maxAttempts = 30; // 30 seconds max
    const pollInterval = 1000;

    const checkAccess = async () => {
      if (!storedEmail) {
        setError('Email not found. Please check your payment confirmation email.');
        setState('error');
        return;
      }

      try {
        const response = await fetch(
          `/api/auth/check-access?email=${encodeURIComponent(storedEmail)}`
        );
        const data = await response.json();

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
  }, [sessionId]);

  const TierIcon = tier === 'unlimited' ? Crown : Zap;
  const tierColor = tier === 'unlimited' ? 'text-yellow-500' : 'text-blue-500';

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          {state === 'verifying' && (
            <>
              <div className="flex justify-center mb-4">
                <Loader2 className="h-12 w-12 animate-spin text-muted-foreground" />
              </div>
              <CardTitle>Verifying Payment...</CardTitle>
            </>
          )}

          {state === 'success' && (
            <>
              <div className="flex justify-center mb-4">
                <div className="rounded-full bg-green-500/10 p-3">
                  <Check className="h-12 w-12 text-green-500" />
                </div>
              </div>
              <CardTitle className="text-2xl">Payment Successful!</CardTitle>
            </>
          )}

          {state === 'error' && (
            <>
              <div className="flex justify-center mb-4">
                <div className="rounded-full bg-yellow-500/10 p-3">
                  <Loader2 className="h-12 w-12 text-yellow-500" />
                </div>
              </div>
              <CardTitle>Verification Pending</CardTitle>
            </>
          )}
        </CardHeader>

        <CardContent className="space-y-4">
          {state === 'verifying' && (
            <p className="text-center text-muted-foreground">
              Please wait while we confirm your payment...
            </p>
          )}

          {state === 'success' && tier && (
            <>
              <div className="flex items-center justify-center gap-2 py-4 bg-muted rounded-lg">
                <TierIcon className={`h-6 w-6 ${tierColor}`} />
                <span className="text-lg font-semibold capitalize">{tier} Plan</span>
              </div>

              <div className="space-y-2 text-sm">
                <p className="text-center text-muted-foreground">
                  You now have access to:
                </p>
                <ul className="space-y-1">
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-green-500" />
                    {tier === 'unlimited'
                      ? 'Unlimited wallets'
                      : `Up to ${TIER_LIMITS[tier].toLocaleString()} wallets`}
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-green-500" />
                    All data sources
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-green-500" />
                    FC follower counts & priority scoring
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-green-500" />
                    ENS onchain lookups
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-green-500" />
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
