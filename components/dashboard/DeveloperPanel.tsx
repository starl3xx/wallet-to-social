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
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d?.totals) return;
        setTotals({
          total_requests: d.totals.total_requests ?? 0,
          total_credits: d.totals.total_credits ?? 0,
          total_wallets: d.totals.total_wallets ?? 0,
        });
      })
      .catch(() => {
        /* A missing usage read leaves the panel without totals, not broken. */
      });
    return () => {
      cancelled = true;
      // Forget this account's totals on the way out, so the next account to
      // sign in on the same tab cannot read the previous one's numbers while
      // its own fetch is in flight.
      setTotals(null);
    };
  }, [entitled]);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Developer</CardTitle>
          <CardDescription>
            {entitled && plan
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
          {entitled ? (
            totals ? (
              <dl className="flex flex-wrap gap-x-12 gap-y-4">
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
            ) : (
              <p className="text-sm text-muted-foreground">
                No API usage recorded this month.
              </p>
            )
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Buy a pack to get a key. Connected applications can be reviewed
                and disconnected either way.
              </p>
              <Button
                size="sm"
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
