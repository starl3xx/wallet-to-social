'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { AuthModal } from '@/components/AuthModal';
import { useAuth } from '@/components/AuthProvider';
import { BalancePanel } from '@/components/dashboard/BalancePanel';
import { ClaimedAddresses } from '@/components/dashboard/ClaimedAddresses';
import { DeveloperPanel } from '@/components/dashboard/DeveloperPanel';
import { LookupHistory } from '@/components/LookupHistory';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageShell } from '@/components/ui/page-shell';
import { useCredits } from '@/lib/use-credits';
import type { UserTier } from '@/lib/access';

/**
 * The account surface.
 *
 * ## What this page is for
 *
 * A signed-in user owns lookups, credit packs, claimed addresses, API keys and
 * connected applications, and until now there was no page that showed any of
 * it. Everything lived in state inside the homepage, in a modal with no URL, or
 * nowhere: three finished, session-authorized endpoints were reachable by no
 * button at all.
 *
 * A dashboard monitors, it does not explore. Each thing the account owns gets a
 * summary that answers "where do I stand", and the working surface for it stays
 * where it already is. That is why there is no results table here, no activity
 * feed and no chart: a chart answers "how has this been going", which is a
 * different question and a different page.
 *
 * ## Why there is no upload widget
 *
 * The upload block and its submit handler live inside `app/page.tsx` and are
 * entangled with its state machine, so mounting the same control here means
 * lifting them out first. Until that happens two submit paths would have to
 * agree about `canSubmit`, `maxWallets`, the anonymous gate and the
 * save-to-history semantics, and a second one that disagreed would be worse
 * than a link. The page carries one primary action pointing at the homepage
 * instead, which is honest about where the work happens.
 *
 * ## Why opening a lookup leaves the page
 *
 * There is no URL that opens a saved lookup: results are in-app state on the
 * homepage. Carrying a selection across would mean lifting that state machine
 * out too, so a row sends you to the homepage's own list. This is the known
 * deferral, named rather than quietly dropped.
 *
 * ## Signed out
 *
 * Rendered inline, never as a redirect, and the loading branch is separate from
 * the signed-out one: "not answered yet" is not "answered no", and showing the
 * signed-out card during the session fetch tells a signed-in person to sign in.
 */
export default function DashboardPage() {
  const { user, isLoading: authLoading } = useAuth();
  const credits = useCredits(!!user);
  const router = useRouter();
  const [authOpen, setAuthOpen] = useState(false);

  /**
   * Saved results arrive here already fetched, and this page has nowhere to
   * put them. Sending the reader to the homepage's list is the honest move
   * until a saved lookup has a URL of its own.
   */
  const handleLoadLookup = useCallback(() => {
    router.push('/#my-lookups');
  }, [router]);

  if (authLoading) {
    return (
      <PageShell>
        <p className="text-sm text-muted-foreground">One moment…</p>
      </PageShell>
    );
  }

  if (!user) {
    return (
      <PageShell>
        <div className="space-y-6">
          <h1 className="text-2xl font-light tracking-[var(--tracking-title)] text-foreground">
            Dashboard
          </h1>
          <Card>
            <CardHeader>
              <CardTitle>Sign in to see your account</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Your lookups, credits, claimed addresses and API keys live here.
              </p>
              {/* Soft, not filled: the header already carries this page's one
                  filled action and a sign-in of its own, and two filled violet
                  buttons in one view makes neither of them the action. */}
              <Button
                size="sm"
                variant="soft"
                onClick={() => setAuthOpen(true)}
              >
                Sign in
              </Button>
            </CardContent>
          </Card>
        </div>
        <AuthModal open={authOpen} onOpenChange={setAuthOpen} />
      </PageShell>
    );
  }

  const tier: UserTier = user.tier ?? 'free';

  return (
    <PageShell>
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-2">
            <h1 className="text-2xl font-light tracking-[var(--tracking-title)] text-foreground">
              Dashboard
            </h1>
            {/* An email address is machine data in its own element, so it is
              mono. It is not the heading: a heading that changes per account
              gives the page no stable name. */}
            <p className="font-mono text-sm break-words text-muted-foreground">
              {user.email}
            </p>
          </div>
          {/* The one primary action of the view, at the scale that makes it one. */}
          <Button size="hero" asChild>
            <Link href="/">Run a lookup</Link>
          </Button>
        </div>

        <BalancePanel credits={credits} />

        <LookupHistory
          onLoadLookup={handleLoadLookup}
          entitled={credits.entitled}
          emptyState={
            <p className="text-sm text-muted-foreground">
              Nothing saved yet. Run a lookup and it will be here.
            </p>
          }
        />

        <ClaimedAddresses />

        <DeveloperPanel tier={tier} credits={credits} />
      </div>
    </PageShell>
  );
}
