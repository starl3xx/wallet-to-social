'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Segmented, type SegmentedOption } from '@/components/ui/segmented';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ArrowsClockwise as RefreshCw } from '@phosphor-icons/react';
import { Stat, StatTile } from './Stat';
import { FunnelStep } from './FunnelStep';
import { RefreshButton } from './RefreshButton';
import { Empty, Loading } from './PaneState';

/**
 * The funnel, in one place, over one window.
 *
 * Before this pane there were two funnels. The behaviour tab drew one over 7
 * days against a page-view denominator, the revenue tab drew another over 30
 * against a pricing-view denominator, and four steps appeared on both with
 * different numbers. A reader who clicked the Pulse conversion tile landed on
 * the second one, having been shown the first.
 *
 * ## Two funnels are still shown here, and that is deliberate
 *
 * They answer different questions and neither substitutes for the other.
 *
 * - **People** counts distinct sessions that reached each step. This is the one
 *   to read for "what share got through", because a ratio between two of its
 *   steps is a ratio between two groups of people.
 * - **Events** counts how many times each thing happened. One person opening
 *   the pricing modal six times is six here and one above. That is the right
 *   number for load and for the paywall work, and the wrong number for a rate.
 *
 * They are stacked rather than toggled so nobody can read one believing it is
 * the other.
 */

type WindowDays = '7' | '30' | '90';

const WINDOWS: SegmentedOption<WindowDays>[] = [
  { value: '7', label: 'Last 7 days', content: '7d' },
  { value: '30', label: 'Last 30 days', content: '30d' },
  { value: '90', label: 'Last 90 days', content: '90d' },
];

interface EventFunnel {
  ok: boolean;
  pageViews: number;
  csvUploads: number;
  lookupsStarted: number;
  lookupsCompleted: number;
  exportsClicked: number;
  historySaved: number;
  usersRegistered: number;
  upgradeModalViewed: number;
  checkoutStarted: number;
  checkoutRedirected: number;
  checkoutFailed: number;
  checkoutFailureReasons: Array<{ reason: string; count: number }>;
  paymentCompleted: number;
  paymentsByRail: Array<{ rail: string; count: number }>;
}

interface SessionFunnel {
  ok: boolean;
  sessions: number;
  engaged: number;
  ranLookup: number;
  gotResults: number;
  hitWall: number;
  sawPricing: number;
  startedCheckout: number;
  reachedStripe: number;
  paid: number;
  anonymous: number;
}

interface GateMetrics {
  ok: boolean;
  reverseUnlocked: number;
  reverseLocked: number;
  reverseLockedSessions: number;
  limitHits: number;
  limitHitSessions: number;
  contractImportBlocked: number;
  contractImportSuccess: number;
}

interface Journey {
  days: number;
  events: EventFunnel;
  sessions: SessionFunnel;
  gates: GateMetrics;
  triggers: Array<{ trigger: string; count: number }>;
  rates: { pricingToPaid: number | null; lookupToPaid: number | null };
}

const pct = (n: number | null) => (n === null ? 'n/a' : `${n.toFixed(1)}%`);

export function FunnelPane({ password }: { password: string }) {
  const [days, setDays] = useState<WindowDays>('30');
  const [data, setData] = useState<Journey | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/analytics/journey?days=${days}`, {
        headers: { 'x-admin-password': password },
      });
      if (!res.ok) throw new Error('Failed to fetch funnel data');
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [password, days]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading && !data) return <Loading />;

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-destructive mb-4">{error}</p>
        <Button variant="outline" onClick={fetchData}>
          <RefreshCw className="h-4 w-4" aria-hidden />
          Retry
        </Button>
      </div>
    );
  }

  if (!data) return null;

  const { events, sessions, gates, triggers, rates } = data;

  /**
   * Share of sessions, `null` when there were none.
   *
   * Never `|| 1`. The behaviour pane divided by `pageViews || 1` for months and
   * reported 3400% lookups, because page views were not being recorded at all.
   * A missing measurement has to read as missing.
   */
  const sessionRate = (n: number) =>
    sessions.sessions > 0 ? (n / sessions.sessions) * 100 : null;
  const eventRate = (n: number) =>
    events.pageViews > 0 ? (n / events.pageViews) * 100 : null;

  const noSessions =
    'No sessions were recorded in this window, so a share cannot be computed';
  const noPageViews =
    'No page views were recorded in this window, so a share cannot be computed';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-2xl font-light tracking-[var(--tracking-title)]">
          Funnel
        </h2>
        <div className="flex items-center gap-2">
          <Segmented
            ariaLabel="Time window"
            value={days}
            onChange={setDays}
            options={WINDOWS}
          />
          <RefreshButton onClick={fetchData} loading={loading} />
        </div>
      </div>

      {(sessions.ok === false || events.ok === false) && (
        <p className="text-sm text-caution">
          A funnel query failed, so the counts below are zeros this panel
          produced rather than measured. Check the server log for &ldquo;funnel
          error&rdquo;.
        </p>
      )}

      {/* The two rates, named, with the same definition everywhere they
          appear. See `conversionRates` in lib/analytics.ts. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatTile
          label="Pricing → paid"
          value={pct(rates.pricingToPaid)}
          note="of everyone who was asked to pay"
        />
        <StatTile
          label="Lookup → paid"
          value={pct(rates.lookupToPaid)}
          note="of everyone who used the product"
        />
        <StatTile
          label="Engaged sessions"
          value={sessions.engaged.toLocaleString()}
          note={`of ${sessions.sessions.toLocaleString()} total`}
        />
        <StatTile
          label="Signups"
          value={events.usersRegistered.toLocaleString()}
          /* Not a funnel step: the magic-link callback that creates the
             account is frequently a different browser from the one that asked
             for the link, so it has no session to place. */
          note="accounts created, no session to place"
        />
      </div>

      {/* People */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">People ({data.days} days)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4 md:grid-cols-5 lg:grid-cols-9">
            <FunnelStep
              label="Sessions"
              count={sessions.sessions}
              rate={sessions.sessions > 0 ? 100 : null}
              rateTitle={noSessions}
            />
            <FunnelStep
              label="Engaged"
              count={sessions.engaged}
              rate={sessionRate(sessions.engaged)}
              rateTitle={noSessions}
            />
            <FunnelStep
              label="Ran a lookup"
              count={sessions.ranLookup}
              rate={sessionRate(sessions.ranLookup)}
              rateTitle={noSessions}
            />
            <FunnelStep
              label="Got results"
              count={sessions.gotResults}
              rate={sessionRate(sessions.gotResults)}
              rateTitle={noSessions}
            />
            <FunnelStep
              label="Hit the wall"
              count={sessions.hitWall}
              rate={sessionRate(sessions.hitWall)}
              rateTitle={noSessions}
            />
            <FunnelStep
              label="Saw pricing"
              count={sessions.sawPricing}
              rate={sessionRate(sessions.sawPricing)}
              rateTitle={noSessions}
            />
            <FunnelStep
              label="Started checkout"
              count={sessions.startedCheckout}
              rate={sessionRate(sessions.startedCheckout)}
              rateTitle={noSessions}
            />
            <FunnelStep
              label="Reached Stripe"
              count={sessions.reachedStripe}
              rate={sessionRate(sessions.reachedStripe)}
              rateTitle={noSessions}
            />
            {/* A payment is a real outcome, so it is green. */}
            <FunnelStep
              label="Paid"
              count={sessions.paid}
              rate={sessionRate(sessions.paid)}
              rateTitle={noSessions}
              valueClassName="text-attested"
            />
          </div>
          <div className="mt-4 space-y-1 border-t pt-4 text-xs text-muted-foreground">
            <p>
              One session counted once per step. The last four steps are forced
              to fall rather than rise, because the buy-credits modal is the
              only way into a Stripe checkout, so a session that started one did
              see the pricing whether or not the event reached us. The steps
              above are reported as measured, so &ldquo;saw pricing&rdquo; can
              legitimately exceed &ldquo;got results&rdquo;: pricing is
              reachable from the marketing pages without running anything.
            </p>
            <p>
              &ldquo;Paid&rdquo; counts sessions, not sales. A payment arrives
              from the Stripe webhook with no session, so it is joined back by
              account email and credited to the sessions of that account which
              reached checkout: one buyer who checked out across two visits
              counts twice, and an onchain sale, which has no checkout events at
              all, counts nowhere. Read the rail split on the event funnel below
              for the sales themselves.{' '}
              <span className="tabular-nums">
                {sessions.anonymous.toLocaleString()}
              </span>{' '}
              of these sessions were never signed in and cannot be joined to an
              account at all.
            </p>
            {/* The middle of this funnel is younger than the window it is
                drawn over, and a reader who does not know that will read a
                tracking gap as a product collapse. */}
            <p>
              &ldquo;Ran a lookup&rdquo; and &ldquo;got results&rdquo; depend on
              the browser session reaching the job row, which only started on 25
              August 2026. Any window that reaches back past that date
              undercounts both steps; the event funnel below counts every lookup
              regardless of session and is the number to compare against.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Events */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Events ({data.days} days)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4 md:grid-cols-4 lg:grid-cols-8">
            <FunnelStep
              label="Page views"
              count={events.pageViews}
              rate={events.pageViews > 0 ? 100 : null}
              rateTitle={noPageViews}
            />
            <FunnelStep
              label="CSV uploads"
              count={events.csvUploads}
              rate={eventRate(events.csvUploads)}
              rateTitle={noPageViews}
            />
            <FunnelStep
              label="Lookups started"
              count={events.lookupsStarted}
              rate={eventRate(events.lookupsStarted)}
              rateTitle={noPageViews}
            />
            <FunnelStep
              label="Lookups done"
              count={events.lookupsCompleted}
              rate={eventRate(events.lookupsCompleted)}
              rateTitle={noPageViews}
            />
            <FunnelStep
              label="Saved"
              count={events.historySaved}
              rate={eventRate(events.historySaved)}
              rateTitle={noPageViews}
            />
            <FunnelStep
              label="Exports"
              count={events.exportsClicked}
              rate={eventRate(events.exportsClicked)}
              rateTitle={noPageViews}
            />
            <FunnelStep
              label="Saw pricing"
              count={events.upgradeModalViewed}
              rate={eventRate(events.upgradeModalViewed)}
              rateTitle={noPageViews}
            />
            <FunnelStep
              label="Paid"
              count={events.paymentCompleted}
              rate={eventRate(events.paymentCompleted)}
              rateTitle={noPageViews}
              valueClassName="text-attested"
            />
          </div>

          {events.checkoutFailed > 0 && (
            <p className="mt-4 text-sm text-caution">
              {events.checkoutFailed} checkout
              {events.checkoutFailed === 1 ? ' failure' : ' failures'}:{' '}
              {events.checkoutFailureReasons
                .map((r) => `${r.reason} (${r.count})`)
                .join(', ')}
            </p>
          )}

          {events.paymentsByRail.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              Payments by rail:{' '}
              {events.paymentsByRail
                .map((r) => `${r.rail} (${r.count})`)
                .join(', ')}
              . An onchain sale is granted without the modal or a Stripe
              redirect, so it reaches the last step having skipped the three
              before it.
            </p>
          )}
        </CardContent>
      </Card>

      {/* The gates. Every figure here comes from an event that was already
          being written and was read by nothing. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Gates ({data.days} days)</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Same rule as the funnels above: a failed query renders as a full
              set of zeros, and a quiet window and a broken query look identical
              unless one of them says so. */}
          {gates.ok === false && (
            <p className="mb-4 text-sm text-caution">
              The gate query failed, so the counts below are zeros this panel
              produced rather than measured. Check the server log for
              &ldquo;Gate metrics error&rdquo;.
            </p>
          )}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat
              label="Free allowance refusals"
              value={gates.limitHits.toLocaleString()}
              note={`${gates.limitHitSessions.toLocaleString()} session${
                gates.limitHitSessions === 1 ? '' : 's'
              }`}
            />
            <Stat
              label="Reverse lookups answered"
              value={gates.reverseUnlocked.toLocaleString()}
              note="wallets returned"
            />
            <Stat
              label="Reverse lookups gated"
              value={gates.reverseLocked.toLocaleString()}
              note={`count only, ${gates.reverseLockedSessions.toLocaleString()} session${
                gates.reverseLockedSessions === 1 ? '' : 's'
              }`}
            />
            <Stat
              label="Contract imports"
              value={gates.contractImportSuccess.toLocaleString()}
              note={`${gates.contractImportBlocked.toLocaleString()} blocked`}
            />
          </div>
        </CardContent>
      </Card>

      {/* Which gate opened the buy-credits modal. The per-gate names shipped
          2026-08-22; rows named 'limit' and 'feature' are the labels from
          before that. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Which gate asked for money
          </CardTitle>
        </CardHeader>
        <CardContent>
          {triggers.length === 0 ? (
            <Empty>No buy-credits modal opens in the window</Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Gate</TableHead>
                  <TableHead className="text-right">Opens</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {triggers.map((t) => (
                  <TableRow key={t.trigger}>
                    <TableCell className="font-medium">{t.trigger}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {t.count}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
