'use client';

import { useUpgradeModal } from '@/components/UpgradeModalProvider';
import { Badge } from '@/components/ui/badge';
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
import { Progress } from '@/components/ui/progress';
import { CREDIT_LIFETIME_MONTHS, isPackId, PACKS } from '@/lib/packs';
import type { CreditsView } from '@/lib/use-credits';

/**
 * Balance, packs and expiry.
 *
 * ## Why this is the headline module
 *
 * `/api/credits` has always returned the lots, the free-window usage and the
 * reset date, and nothing rendered any of it: the header showed one aggregate
 * number that linked nowhere, and the admin console showed a customer's packs
 * to staff while the customer had no surface for them at all. This is the
 * clearest case of state the product already holds and hides.
 *
 * ## The rules this module is written against
 *
 * A progress bar needs a denominator and a reset. The free window has both, so
 * a bar is honest there. A credit pack is a stock with a deadline: it gets a
 * count and an expiry date and never a bar, because a draining bar turns a
 * balance into an emergency.
 *
 * `attested` green marks a measured fact and is not spent on a balance.
 * `caution` marks approaching a limit, which is what a lot about to lapse is.
 * `accent-brand` is the affordance, so it goes on the one action.
 *
 * An unmetered account is sent no numbers at all and gets a sentence rather
 * than a zero: a legacy tier was sold before credits existed and showing it a
 * meter would imply one it never agreed to.
 */

/**
 * How near a lapse reads as caution. Not a published figure: it is a display
 * threshold, and the date beside it is always the real answer.
 */
const LAPSE_SOON_DAYS = 30;

const DATE = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'an unknown date' : DATE.format(d);
}

function daysUntil(iso: string): number | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86_400_000);
}

/** Free text, not a `PackId`: a support grant writes `grant`, the agent rail writes `agent`. */
function packName(pack: string): string {
  return isPackId(pack) ? PACKS[pack].name : pack;
}

export function BalancePanel({ credits }: { credits: CreditsView }) {
  const upgradeModal = useUpgradeModal();

  const buy = (
    <Button size="sm" onClick={() => upgradeModal.open(undefined, 'dashboard')}>
      Buy credits
    </Button>
  );

  if (credits.loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Balance</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">One moment…</p>
        </CardContent>
      </Card>
    );
  }

  // A legacy or whitelisted account. No numbers, no meter, and nothing for
  // sale: those tiers were sold once, before credits existed.
  if (credits.unmetered) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Balance</CardTitle>
          <CardDescription>
            This account is not metered, so there is no balance to spend and
            nothing expires.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const lots = credits.lots ?? [];
  const hasLots = lots.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Balance</CardTitle>
        <CardDescription>
          {hasLots
            ? `Credits are bought once and last ${CREDIT_LIFETIME_MONTHS} months. They are spent oldest first, by expiry.`
            : 'A match is a wallet resolved to an X handle or a Farcaster account. Misses cost nothing.'}
        </CardDescription>
        <CardAction>{buy}</CardAction>
      </CardHeader>

      <CardContent className="space-y-6">
        <dl className="flex flex-wrap gap-x-12 gap-y-4">
          <Figure
            value={(credits.available ?? 0).toLocaleString()}
            label="Matches left"
          />
          {credits.maxWallets !== null && (
            <Figure
              value={credits.maxWallets.toLocaleString()}
              label="Wallets you can submit now"
            />
          )}
        </dl>

        {/* The free window: a denominator and a reset, so a bar is honest. */}
        {credits.onFreeAllowance && credits.freeAllowance !== null && (
          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-sm text-muted-foreground">Free window</span>
              <span className="font-mono text-sm tabular-nums text-foreground">
                {(credits.freeUsedThisWindow ?? 0).toLocaleString()} of{' '}
                {credits.freeAllowance.toLocaleString()} used
              </span>
            </div>
            <Progress
              value={Math.min(
                100,
                ((credits.freeUsedThisWindow ?? 0) / credits.freeAllowance) *
                  100
              )}
            />
            <p className="text-sm text-muted-foreground">
              {credits.freeWindowResetsAt
                ? /* Rolling, so it returns in pieces. Saying it "resets" on a
                     date would describe a window this product does not have. */
                  `The allowance returns as matches age out. The next of them returns on ${formatDate(credits.freeWindowResetsAt)}.`
                : 'Nothing spent in this window yet.'}
            </p>
          </div>
        )}

        {hasLots && (
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-foreground">Your packs</h3>
            <ul className="space-y-2">
              {lots.map((lot, i) => {
                const left = lot.expiresAt ? daysUntil(lot.expiresAt) : null;
                const soon = left !== null && left <= LAPSE_SOON_DAYS;
                return (
                  <li
                    key={`${lot.pack}-${lot.expiresAt ?? 'none'}-${i}`}
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg border border-border px-4 py-3"
                  >
                    <span className="text-sm font-medium text-foreground">
                      {packName(lot.pack)}
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="font-mono text-sm tabular-nums text-foreground">
                        {lot.remaining.toLocaleString()} left
                      </span>
                      {lot.expiresAt ? (
                        <Badge tone={soon ? 'caution' : 'muted'}>
                          Expires {formatDate(lot.expiresAt)}
                        </Badge>
                      ) : (
                        <Badge tone="muted">No expiry</Badge>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {!hasLots && !credits.onFreeAllowance && (
          <p className="text-sm text-muted-foreground">
            No live credits. Buy a pack to keep running lookups.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
