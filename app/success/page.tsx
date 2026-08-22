'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Check,
  CircleNotch,
  Crown,
  Lightning,
  Warning,
} from '@phosphor-icons/react';
import type { UserTier } from '@/lib/access';
import { CREDIT_LIFETIME_MONTHS } from '@/lib/packs';
import { CHAIN_COUNT_WORD } from '@/lib/public-figures';

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

  const TierIcon = tier === 'unlimited' ? Crown : Lightning;
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
        {/* One title size for the three states. Success was text-2xl while the
            other two inherited 16px, so the card's heading changed size with its
            mood. 20px takes the title tracking.

            The three header icons sit at h-10, the display step, in duotone,
            the display weight. A completed payment is a real outcome, which is
            what green marks; it was violet, the colour of something you can act
            on. Pending verification is a caution, with the Warning glyph the
            reachability checker uses for the same state; it was a CircleNotch
            that did not spin, a spinner with no motion reading as a broken
            spinner. Both tints at full token opacity: `/10` on the solid hue
            was a second, unnamed tint beside the `-tint` tokens that exist for
            exactly this. */}
        <CardHeader className="text-center">
          {state === 'verifying' && (
            <>
              <div className="flex justify-center mb-4">
                <CircleNotch className="h-10 w-10 animate-spin text-muted-foreground" />
              </div>
              <CardTitle className="text-xl tracking-[var(--tracking-title)]">
                Verifying payment...
              </CardTitle>
            </>
          )}

          {state === 'success' && (
            <>
              <div className="flex justify-center mb-4">
                <div className="rounded-full bg-attested-tint p-3">
                  <Check
                    weight="duotone"
                    className="h-10 w-10 text-attested"
                    aria-hidden
                  />
                </div>
              </div>
              <CardTitle className="text-xl tracking-[var(--tracking-title)]">
                Payment successful!
              </CardTitle>
            </>
          )}

          {state === 'error' && (
            <>
              <div className="flex justify-center mb-4">
                <div className="rounded-full bg-caution-tint p-3">
                  <Warning
                    weight="duotone"
                    className="h-10 w-10 text-caution"
                    aria-hidden
                  />
                </div>
              </div>
              <CardTitle className="text-xl tracking-[var(--tracking-title)]">
                Verification pending
              </CardTitle>
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
                <Lightning className="h-5 w-5 text-accent-brand" aria-hidden />
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
                    All {CHAIN_COUNT_WORD} chains, uncapped CSV export
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-accent-brand" />
                    API access, drawing the same credits
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-accent-brand" />
                    Credits last {CREDIT_LIFETIME_MONTHS} months
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
                // `p-4` is the inset step: this callout sits inside the Card,
                // which already carries the p-6 card padding.
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

              {/* One label for one action. A signed-in buyer's next step is
                  the lookup, and "Run a lookup" is what that action is called
                  on /vs, /check and the blog; this said "Start using
                  walletlink.social" here, "Start your first lookup" on /vs
                  and "Go to App" in the error branch, six names for one
                  destination. A signed-out buyer is leaving, not starting,
                  so that branch keeps "Back to walletlink.social". */}
              <Button asChild className="w-full">
                <Link href="/">
                  {pack.signedInAsBuyer
                    ? 'Run a lookup'
                    : 'Back to walletlink.social'}
                </Link>
              </Button>
            </>
          )}

          {/* A tier without a pack. Nothing sold today produces one: the
              checkout route only accepts a pack id. It still arrives on the
              legacy path (a session carrying tier metadata) and whenever
              checkout-status falls through to `getUserAccess`, which reports a
              legacy or whitelisted account as its tier. What is true of every
              one of those accounts is that no meter runs, so that is all this
              says: no "Plan", and no wallet cap, because neither is the
              product any more. */}
          {state === 'success' && tier && !pack && (
            <>
              <div className="flex items-center justify-center gap-2 py-4 bg-muted rounded-lg">
                <TierIcon className={`h-5 w-5 ${tierColor}`} aria-hidden />
                <span className="text-lg font-semibold capitalize">
                  {tier} account
                </span>
              </div>

              <p className="text-center text-sm text-muted-foreground">
                This account is not metered. There are no credits to count and
                nothing expires.
              </p>

              {email && (
                <p className="text-center text-sm text-muted-foreground">
                  Access linked to: <span className="font-medium">{email}</span>
                </p>
              )}

              <Button asChild className="w-full">
                <Link href="/">Run a lookup</Link>
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
              {/* One primary action, with the alternate as an outline pill
                  beneath it rather than a sibling of equal width. Retry is the
                  action the state is asking for; leaving is the fallback. The
                  label for "/" is the signed-out one from the success branch,
                  because an unverified buyer is in the same position. */}
              <div className="flex flex-col gap-2">
                <Button
                  className="w-full"
                  onClick={() => {
                    setState('verifying');
                    window.location.reload();
                  }}
                >
                  Retry
                </Button>
                <Button variant="outline" asChild className="w-full">
                  <Link href="/">Back to walletlink.social</Link>
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
          <CircleNotch className="h-10 w-10 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <SuccessContent />
    </Suspense>
  );
}
