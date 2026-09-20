'use client';

import { useEffect, useState } from 'react';

import { ApiKeysModal } from '@/components/ApiKeysModal';
import { useUpgradeModal } from '@/components/UpgradeModalProvider';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Figure } from '@/components/ui/figure';
import type { UserTier } from '@/lib/access';
import { API_PLANS, apiPlanForAccount } from '@/lib/api-plans';
import type { CreditsView } from '@/lib/use-credits';

/**
 * The developer surface: plan, usage and the way into keys.
 *
 * ## Compute access first, fetch second
 *
 * `requireDeveloperAccess` defaults `requireApiTier` to true and no call site
 * overrides it, so the 403 covers listing keys and reading usage, not just
 * minting. An account inside its free window is refused all of them. Fetching
 * anyway would hand this panel a refusal body where it expects a payload, so
 * access is decided from `entitled` before a request is made. That is the
 * same order `ApiKeysModal` uses.
 *
 * ## Connected applications are not a paid feature
 *
 * `/api/oauth/connections` is deliberately not behind that guard: somebody on
 * the free allowance can connect an assistant, so they must be able to
 * disconnect it. The keys dialog renders connections outside its access
 * branch for exactly that reason, which is why the button that opens it is
 * offered to every signed-in account here rather than only to paying ones.
 * Putting it inside a paid-only section would reintroduce the defect that
 * comment describes.
 *
 * ## No chart
 *
 * `/api/developer/usage` carries a per-day series and this renders totals
 * instead. A chart answers "how has this been going"; this page answers
 * "where do I stand". The series is there when a reporting surface wants it.
 */

interface UsageTotals {
  total_requests: number;
  total_credits: number;
  total_wallets: number;
}

export function DeveloperPanel({
  tier,
  credits,
}: {
  tier: UserTier;
  credits: CreditsView;
}) {
  const upgradeModal = useUpgradeModal();
  const [keysOpen, setKeysOpen] = useState(false);
  const [totals, setTotals] = useState<UsageTotals | null>(null);
  // Three states, not one. `totals === null` alone cannot tell "still asking"
  // from "we could not ask" from "genuinely nothing this month", and only the
  // last of those is a fact about the account. Loading is derived rather than
  // stored, because storing it means writing it from the effect body, which is
  // the cascading render React objects to.
  const [usageFailed, setUsageFailed] = useState(false);

  const entitled = credits.entitled;
  const planId = apiPlanForAccount(tier, entitled);
  const plan = planId ? API_PLANS[planId] : null;

  useEffect(() => {
    // The gate is the reason for the guard, not an optimization: without it
    // this asks a route that answers 403 for a free-allowance account.
    // Nothing is cleared here, because a setState in an effect body is the
    // cascading render React objects to; the cleanup below forgets instead.
    if (!entitled) return;
    let cancelled = false;
    fetch('/api/developer/usage?period=month')
      .then((r) => {
        if (!r.ok) throw new Error(`usage read failed: ${r.status}`);
        return r.json();
      })
      .then((d) => {
        if (cancelled) return;
        setTotals({
          total_requests: d?.totals?.total_requests ?? 0,
          total_credits: d?.totals?.total_credits ?? 0,
          total_wallets: d?.totals?.total_wallets ?? 0,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setUsageFailed(true);
      });
    return () => {
      cancelled = true;
      // Forget this account's totals on the way out, so the next account to
      // sign in on the same tab cannot read the previous one's numbers while
      // its own fetch is in flight.
      setTotals(null);
      setUsageFailed(false);
    };
  }, [entitled]);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="leading-none font-semibold">Developer</h2>
          </CardTitle>
          <CardDescription>
            {/* Neutral while the balance is still loading. The upsell used to
                render during the credits fetch and again if it failed, so a
                paying account was told to buy a pack it already owns. */}
            {credits.loading || credits.failed
              ? 'API access comes with credits, and draws on the same balance.'
              : entitled && plan
                ? `The ${plan.name} plan: ${plan.requestsPerMinute.toLocaleString()} requests a minute and up to ${plan.maxBatchSize.toLocaleString()} addresses a batch.`
                : 'API access comes with credits, and draws on the same balance.'}
          </CardDescription>
          <CardAction>
            {/* Offered to every signed-in account, because the dialog is also
                where connected applications are disconnected. */}
            <Button variant="soft" size="sm" onClick={() => setKeysOpen(true)}>
              Keys and apps
            </Button>
          </CardAction>
        </CardHeader>

        <CardContent className="space-y-4">
          {credits.loading ? (
            <p className="text-sm text-muted-foreground">One moment…</p>
          ) : credits.failed ? (
            <p className="text-sm text-muted-foreground">
              We could not read your account just now. Connected applications
              are still reachable from keys and apps.
            </p>
          ) : entitled ? (
            usageFailed ? (
              <p className="text-sm text-muted-foreground">
                We could not read your API usage just now. Your keys are
                unaffected.
              </p>
            ) : totals === null ? (
              <p className="text-sm text-muted-foreground">One moment…</p>
            ) : (
              <dl className="flex flex-wrap gap-x-4 gap-y-4 sm:gap-x-8">
                <Figure
                  variant="stat"
                  value={totals.total_requests.toLocaleString()}
                  label="Requests this month"
                />
                <Figure
                  variant="stat"
                  value={totals.total_credits.toLocaleString()}
                  label="Credits spent"
                />
                <Figure
                  variant="stat"
                  value={totals.total_wallets.toLocaleString()}
                  label="Wallets resolved"
                />
              </dl>
            )
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Buy a pack to get a key. Connected applications can be reviewed
                and disconnected either way.
              </p>
              <Button
                size="sm"
                variant="soft"
                onClick={() => upgradeModal.open(undefined, 'dashboard-api')}
              >
                Buy credits
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <ApiKeysModal
        entitled={entitled}
        open={keysOpen}
        onOpenChange={setKeysOpen}
        tier={tier}
        onUpgradeClick={() => {
          setKeysOpen(false);
          upgradeModal.open(undefined, 'dashboard-api-modal');
        }}
      />
    </>
  );
}
