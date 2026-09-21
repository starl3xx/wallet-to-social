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
import {
  API_PLANS,
  CREDIT_API_PLAN,
  apiPlanForAccount,
  ladderedPlanId,
} from '@/lib/api-plans';
import type { CreditsView } from '@/lib/use-credits';

/**
 * The developer surface: plan, usage and the way into keys.
 *
 * ## There is no longer an access gate to compute first
 *
 * `requireDeveloperAccess` used to default `requireApiTier` to true, so one
 * 403 covered listing keys and reading usage as well as minting, and an
 * account inside its free window was refused all three. This panel therefore
 * decided access from `entitled` before making a request, to avoid being
 * handed a refusal body where it expects a payload.
 *
 * That refusal is gone (2026-09-21, see `lib/api-plans.ts`): every signed-in
 * account holds a plan, and the free allowance decides what a key can draw
 * rather than whether one exists. So the usage read runs for everybody, and
 * `entitled` is back to meaning what its name says, which is whether a pack
 * is backing the account.
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
  /**
   * The plan actually serving this account, not the one tier and entitlement
   * imply.
   *
   * `apiPlanForAccount` maps every pack holder to the Developer preset, and a
   * live Scale or Index pack is served higher ceilings at request time
   * (`PACK_API_PLAN`). Stating the Developer numbers as fact therefore told a
   * Scale buyer the wrong limits. The keys dialog cannot do better, because it
   * knows only tier and entitlement; this card knows the lots, so it ladders
   * the plan up the way the server does.
   *
   * It can still only ladder DOWN-wards-safe: `getBalance` returns lots with
   * credits remaining, while the server's ladder counts any unexpired pack,
   * so an account that has spent its Scale pack but not outlived it reads as
   * Developer here. That is why the qualifying sentence below stays on the
   * Developer case rather than being deleted as solved.
   */
  const basePlanId = apiPlanForAccount(tier);
  const planId = ladderedPlanId(
    basePlanId,
    (credits.lots ?? []).map((l) => l.pack)
  );
  const plan = planId ? API_PLANS[planId] : null;

  useEffect(() => {
    // No guard: the route answers every signed-in account now. Nothing is
    // cleared here either, because a setState in an effect body is the
    // cascading render React objects to; the cleanup below forgets instead.
    let cancelled = false;
    fetch('/api/developer/usage?period=month')
      .then((r) => {
        /**
         * A 404 here is an answer, not a failure.
         *
         * The route answers 404 with "No API keys found for this user" when
         * the account holds none, which any account that has not minted one
         * yet is in. Treating every non-2xx as a failed read told
         * that account we could not reach its usage, when the truthful answer
         * is that it has not spent anything. Zeros say that; a failure notice
         * says something false about the request.
         */
        if (r.status === 404) return null;
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
  }, []);

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
            {/* Said rather than guessed, the same qualification the keys
                dialog carries: the lots above can raise this plan but cannot
                see a pack that is spent and still unexpired, which the server
                counts. */}
            {entitled && plan && planId === CREDIT_API_PLAN && (
              <>
                {' '}
                These are the starting limits. A live Scale or Index pack is
                served higher ones; /v1/usage reports the limits serving you.
              </>
            )}
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
