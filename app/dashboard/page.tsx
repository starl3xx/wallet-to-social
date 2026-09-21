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
 * The results view is a 13k-row virtualized working surface entangled with
 * `app/page.tsx`, and a dashboard that also renders it would be two products
 * sharing a URL. So a row opens `/?lookup=<id>` and the existing view renders
 * it there.
 *
 * That query parameter is what made this page's list worth having. It used to
 * push `/#my-lookups`, an anchor on the homepage's own copy of this card, so a
 * row scrolled you to the same list on a different page. The homepage card is
 * gone and this is the only one; a saved lookup has an address now, which is
 * the deferral this closes rather than restates.
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
   * Open the lookup, rather than send somebody to a list of them.
   *
   * This used to push `/#my-lookups`, an anchor on the homepage's own copy of
   * this card, which meant clicking a row here scrolled you to the same list
   * somewhere else. That card is gone and a saved lookup has a URL now, so a
   * row goes to the thing it names.
   *
   * This takes the id and nothing else, through `onSelectLookup`, so the row
   * does not fetch the rows it would immediately throw away. That is not a
   * spared request: `GET /api/history/[id]` marks the lookup viewed, and
   * `enrichedWallets` is measured from that timestamp, so fetching here and
   * again on arrival would compare "new since last look" against a moment ago
   * and the paid new-match highlights would never appear. The row would spend
   * the feature it is advertising.
   */
  const handleSelectLookup = useCallback(
    (lookupId: string) => {
      router.push(`/?lookup=${encodeURIComponent(lookupId)}`);
    },
    [router]
  );

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
        {/* The round trip comes back here rather than to the home page. This
            is the account surface, so signing in from it is its normal entry,
            and `/dashboard` is one of the three literals
            `isAllowedReturnPath` accepts. */}
        <AuthModal
          open={authOpen}
          onOpenChange={setAuthOpen}
          next="/dashboard"
        />
      </PageShell>
    );
  }

  const tier: UserTier = user.tier ?? 'free';

  return (
    <PageShell>
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          {/* `min-w-0` so the flex item may actually shrink. Without it the
              item's min-content width is the longest unbreakable run in the
              address, and a long one pushes the row past a 320px viewport
              however the text is allowed to wrap. */}
          <div className="min-w-0 space-y-2">
            <h1 className="text-2xl font-light tracking-[var(--tracking-title)] text-foreground">
              Dashboard
            </h1>
            {/* An email address is machine data in its own element, so it is
                mono. It is not the heading: a heading that changes per account
                gives the page no stable name. `break-all`, because an address
                has no spaces to break at and `break-words` only helps where
                there is already a word boundary. */}
            <p className="font-mono text-sm break-all text-muted-foreground">
              {user.email}
            </p>
          </div>
          {/* The one primary action of the view, at the scale that makes it one. */}
          <Button size="hero" asChild>
            <Link href="/">Run a lookup</Link>
          </Button>
        </div>

        <BalancePanel credits={credits} />

        {/* Held until the balance settles.
            `entitled` is false while the credits read is in flight and false
            again if it fails, and this card spends that flag on two claims: it
            shows one saved lookup instead of ten, and it offers the
            buy-credits pitch. Both are assertions about what the account has
            paid for, so making them from a flag that only means "not answered
            yet" tells a paying account it has not paid. The balance and
            developer cards refuse to make that claim and this one now refuses
            with them. */}
        {credits.loading ? (
          <Card>
            <CardHeader>
              <CardTitle>
                <h2 className="leading-none font-semibold">My lookups</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">One moment…</p>
            </CardContent>
          </Card>
        ) : credits.failed ? (
          <Card>
            <CardHeader>
              <CardTitle>
                <h2 className="leading-none font-semibold">My lookups</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                We could not confirm your plan just now, so your saved lookups
                are not shown here. Nothing has changed; reload to try again.
              </p>
            </CardContent>
          </Card>
        ) : (
          <LookupHistory
            /* Required by the component, and unreachable here: passing
               `onSelectLookup` short-circuits before it. */
            onLoadLookup={() => {}}
            onSelectLookup={handleSelectLookup}
            entitled={credits.entitled}
            emptyState={
              <p className="text-sm text-muted-foreground">
                Nothing saved yet. Run a lookup and it will be here.
              </p>
            }
          />
        )}

        <ClaimedAddresses />

        <DeveloperPanel tier={tier} credits={credits} />
      </div>
    </PageShell>
  );
}
