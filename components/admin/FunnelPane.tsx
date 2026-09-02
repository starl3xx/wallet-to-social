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
import { PACKS, isPackId } from '@/lib/packs';
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
 *
 * ## The stages that are not funnel steps are labelled as rails
 *
 * Signups (no session to place), onchain sales (no modal, no checkout) and
 * the API (spends credits already bought) each sit beside the funnels rather
 * than inside them, because drawing them as steps would fabricate an order
 * the data does not record.
 */

type WindowDays = '7' | '28' | '90';

/**
 * 28, not 30, for the middle window. The pane compares every window against
 * the one before it, and 28 days is four whole weeks: both sides of the
 * comparison hold the same weekday mix, where a 30-day pair starts two
 * weekdays apart and the delta partly measures the calendar.
 */
const WINDOWS: SegmentedOption<WindowDays>[] = [
  { value: '7', label: 'Last 7 days', content: '7d' },
  { value: '28', label: 'Last 28 days', content: '28d' },
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

interface GateConversion {
  ok: boolean;
  gates: Array<{
    trigger: string;
    opens: number;
    sessions: number;
    checkoutSessions: number;
  }>;
}

interface AcquisitionSources {
  ok: boolean;
  sessions: Array<{
    source: string;
    sessions: number;
    ranLookup: number;
    sawPricing: number;
    startedCheckout: number;
  }>;
  signups: Array<{ source: string; signups: number; bought: number }>;
}

interface Purchases {
  ok: boolean;
  byPack: Array<{
    pack: string;
    rail: string;
    count: number;
    amountCents: number;
  }>;
}

interface AgentRail {
  ok: boolean;
  totalKeys: number;
  activeKeys: number;
  oauthKeys: number;
  callers: number;
  requests: number;
  creditsUsed: number;
  onchainSales: number;
  onchainCents: number;
}

interface Rates {
  pricingToPaid: number | null;
  lookupToPaid: number | null;
}

interface Journey {
  days: number;
  events: EventFunnel;
  sessions: SessionFunnel;
  gates: GateMetrics;
  gateConversion: GateConversion;
  sources: AcquisitionSources;
  purchases: Purchases;
  agents: AgentRail;
  rates: Rates;
  previous: { events: EventFunnel; sessions: SessionFunnel; rates: Rates };
}

const pct = (n: number | null) => (n === null ? 'n/a' : `${n.toFixed(1)}%`);

/** Whole dollars stay whole; anything with cents keeps both digits ($2.50, not $2.5). */
const money = (cents: number) =>
  (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });

/** A pack id shown by its selling name; anything else shown as recorded. */
const packName = (pack: string) => (isPackId(pack) ? PACKS[pack].name : pack);

/**
 * The previous-window delta beside a headline figure, in the same dress the
 * lookup dashboard uses. `null` renders nothing at all: a comparison against
 * an unmeasured or empty previous window is not a small delta, it is no
 * delta, and the LookupDashboard idiom of calling a zero baseline "+100%" is
 * deliberately not copied. `pp` marks a difference between two rates, `%` a
 * relative change in a count; both tiles rise when things improve, so green
 * is up on each.
 */
function Delta({ value, unit }: { value: number | null; unit: '%' | 'pp' }) {
  if (value === null) return null;
  return (
    <span
      className={`text-xs tabular-nums ${value >= 0 ? 'text-attested' : 'text-caution'}`}
    >
      {value >= 0 ? '+' : ''}
      {value.toFixed(1)}
      {unit} vs prev
    </span>
  );
}

export function FunnelPane({ password }: { password: string }) {
  const [days, setDays] = useState<WindowDays>('28');
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

  const {
    events,
    sessions,
    gates,
    gateConversion,
    sources,
    purchases,
    agents,
    rates,
    previous,
  } = data;

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

  /** Relative change against the previous window, `null` off a zero or a failed query. */
  const countDelta = (curr: number, prev: number, prevOk: boolean) =>
    prevOk && prev > 0 ? ((curr - prev) / prev) * 100 : null;
  /** Percentage-point difference between two rates, `null` when either is unmeasured. */
  const rateDelta = (
    curr: number | null,
    prev: number | null,
    prevOk: boolean
  ) => (prevOk && curr !== null && prev !== null ? curr - prev : null);

  const totalPurchases = purchases.byPack.reduce((sum, p) => sum + p.count, 0);
  const totalPurchaseCents = purchases.byPack.reduce(
    (sum, p) => sum + p.amountCents,
    0
  );

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
          appear. See `conversionRates` in lib/analytics.ts. The aside is the
          movement against the window of the same length before this one. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatTile
          label="Pricing → paid"
          value={pct(rates.pricingToPaid)}
          note="of everyone who was asked to pay"
          aside={
            <Delta
              value={rateDelta(
                rates.pricingToPaid,
                previous.rates.pricingToPaid,
                previous.events.ok
              )}
              unit="pp"
            />
          }
        />
        <StatTile
          label="Lookup → paid"
          value={pct(rates.lookupToPaid)}
          note="of everyone who used the product"
          aside={
            <Delta
              value={rateDelta(
                rates.lookupToPaid,
                previous.rates.lookupToPaid,
                previous.events.ok
              )}
              unit="pp"
            />
          }
        />
        <StatTile
          label="Engaged sessions"
          value={sessions.engaged.toLocaleString()}
          note={`of ${sessions.sessions.toLocaleString()} total`}
          aside={
            <Delta
              value={countDelta(
                sessions.engaged,
                previous.sessions.engaged,
                previous.sessions.ok
              )}
              unit="%"
            />
          }
        />
        <StatTile
          label="Signups"
          value={events.usersRegistered.toLocaleString()}
          /* Not a funnel step: the magic-link callback that creates the
             account is frequently a different browser from the one that asked
             for the link, so it has no session to place. */
          note="accounts created, no session to place"
          aside={
            <Delta
              value={countDelta(
                events.usersRegistered,
                previous.events.usersRegistered,
                previous.events.ok
              )}
              unit="%"
            />
          }
        />
      </div>
      <p className="text-xs text-muted-foreground">
        &ldquo;vs prev&rdquo; compares the {data.days} days before this window.
        Signups have been measured since 26 August 2026, so a previous window
        reaching past that date undercounts them and overstates their growth.
      </p>

      {/* Acquisition. The origin on the first page view of each session,
          written since 2026-08-25 and read here for the first time. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Where sessions came from ({data.days} days)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {sources.ok === false && (
            <p className="mb-4 text-sm text-caution">
              The source query failed, so the tables here are empty rather than
              measured. Check the server log for &ldquo;Acquisition sources
              error&rdquo;.
            </p>
          )}
          {sources.sessions.length === 0 ? (
            <Empty>No sessions with a recorded page view in the window</Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right">Sessions</TableHead>
                  <TableHead className="text-right">Ran a lookup</TableHead>
                  <TableHead className="text-right">Saw pricing</TableHead>
                  <TableHead className="text-right">Started checkout</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sources.sessions.map((r) => (
                  <TableRow key={r.source}>
                    <TableCell className="font-mono text-xs">
                      {r.source}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.sessions.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.ranLookup.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.sawPricing.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.startedCheckout.toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <p className="mt-4 border-t pt-4 text-xs text-muted-foreground">
            One row per session, keyed by the origin on its first page view in
            the window. <span className="font-mono">direct</span> is a
            measurement: that browser arrived with no referrer and no tag.{' '}
            <span className="font-mono">(untagged)</span> is the absence of one:
            first-touch capture shipped on 25 August 2026, so a window reaching
            further back reads low on every named source. Checkout is the last
            step a session carries; payments arrive with no session and cannot
            be placed in this table.
          </p>
        </CardContent>
      </Card>

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

      {/* Which gate opened the buy-credits modal, and which of those sessions
          went on to a checkout. The per-gate names shipped 2026-08-22; rows
          named 'limit' and 'feature' are the labels from before that. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Which gate asked for money
          </CardTitle>
        </CardHeader>
        <CardContent>
          {gateConversion.ok === false && (
            <p className="mb-4 text-sm text-caution">
              The gate conversion query failed, so the table here is empty
              rather than measured. Check the server log for &ldquo;Gate
              conversion error&rdquo;.
            </p>
          )}
          {gateConversion.gates.length === 0 ? (
            <Empty>No buy-credits modal opens in the window</Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Gate</TableHead>
                  <TableHead className="text-right">Opens</TableHead>
                  <TableHead className="text-right">Sessions</TableHead>
                  <TableHead className="text-right">Reached checkout</TableHead>
                  <TableHead className="text-right">Checkout rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {gateConversion.gates.map((t) => (
                  <TableRow key={t.trigger}>
                    <TableCell className="font-medium">{t.trigger}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {t.opens.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {t.sessions.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {t.checkoutSessions.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {t.sessions > 0 ? (
                        `${((t.checkoutSessions / t.sessions) * 100).toFixed(1)}%`
                      ) : (
                        <span title="No sessions carried this gate, so a rate cannot be computed">
                          n/a
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <p className="mt-4 border-t pt-4 text-xs text-muted-foreground">
            &ldquo;Reached checkout&rdquo; counts sessions that met this gate
            and started or reached a checkout in the same window. It is the
            honest bottom step per gate: a payment carries no session, so a
            per-gate &ldquo;paid&rdquo; would inherit the email-join floor the
            People funnel documents. A session that met two gates and checked
            out once credits both.
          </p>
        </CardContent>
      </Card>

      {/* The signup and purchase end of the source question: not the same
          rows as the session table above, because the account is created in
          whatever browser opened the magic link. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Signups and purchases by source ({data.days} days)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {sources.ok === false && (
            <p className="mb-4 text-sm text-caution">
              The source query failed, so the table here is empty rather than
              measured. Check the server log for &ldquo;Acquisition sources
              error&rdquo;.
            </p>
          )}
          {sources.signups.length === 0 ? (
            <Empty>No accounts were created in the window</Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right">Signups</TableHead>
                  <TableHead className="text-right">Bought</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sources.signups.map((r) => (
                  <TableRow key={r.source}>
                    <TableCell className="font-mono text-xs">
                      {r.source}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.signups.toLocaleString()}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums ${
                        r.bought > 0 ? 'text-attested' : ''
                      }`}
                    >
                      {r.bought.toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <p className="mt-4 border-t pt-4 text-xs text-muted-foreground">
            Accounts created in the window, keyed by the first touch stored at
            signup; capture began 25 August 2026, so older accounts read{' '}
            <span className="font-mono">(untagged)</span>. Accounts minted by an
            onchain payment are not signups and are excluded.
            &ldquo;Bought&rdquo; means the account has ever purchased a pack, as
            of now rather than inside the window, so a young cohort&rsquo;s
            zeros are pending rather than final.
          </p>
        </CardContent>
      </Card>

      {/* Purchases, from the settled record. This is the one card whose
          numbers deliberately disagree with the Revenue pane, and the footer
          says why. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Purchases ({data.days} days)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {purchases.ok === false && (
            <p className="mb-4 text-sm text-caution">
              The purchases query failed, so the figures here are empty rather
              than measured. Check the server log for &ldquo;Purchases
              error&rdquo;.
            </p>
          )}
          {purchases.byPack.length === 0 ? (
            <Empty>No packs were bought in the window</Empty>
          ) : (
            <>
              <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
                <Stat
                  label="Packs sold"
                  value={totalPurchases.toLocaleString()}
                  valueClassName="text-attested"
                />
                <Stat
                  label="Charged"
                  value={money(totalPurchaseCents)}
                  valueClassName="text-attested"
                  note="both rails, settled"
                />
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pack</TableHead>
                    <TableHead>Rail</TableHead>
                    <TableHead className="text-right">Sold</TableHead>
                    <TableHead className="text-right">Charged</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {purchases.byPack.map((p) => (
                    <TableRow key={`${p.pack}-${p.rail}`}>
                      <TableCell className="font-medium">
                        {packName(p.pack)}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {p.rail}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {p.count.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money(p.amountCents)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
          <p className="mt-4 border-t pt-4 text-xs text-muted-foreground">
            Settled credit lots from both rails, hand grants excluded, at the
            price charged when each lot was bought. The Revenue pane reads the
            card processor alone, so an onchain sale appears here and in the
            rail split above, and nowhere on that pane: the two totals are
            supposed to differ by exactly the onchain amount. A payment taken
            before packs existed (the tier era, through 15 August 2026) wrote no
            lot, so it counts in the funnels above and never here.
          </p>
        </CardContent>
      </Card>

      {/* The agent rail. A rail beside the funnels, never a step of them. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Agents and API ({data.days} days)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {agents.ok === false && (
            <p className="mb-4 text-sm text-caution">
              The agent rail query failed, so the counts below are zeros this
              panel produced rather than measured. Check the server log for
              &ldquo;Agent rail error&rdquo;.
            </p>
          )}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat
              label="Callers"
              value={agents.callers.toLocaleString()}
              note="distinct keys that called"
            />
            <Stat
              label="Requests"
              value={agents.requests.toLocaleString()}
              note={`${agents.creditsUsed.toLocaleString()} credits spent`}
            />
            {/* A settled sale is a real outcome, so it is green, same as the
                paid steps above. */}
            <Stat
              label="Onchain sales"
              value={agents.onchainSales.toLocaleString()}
              valueClassName="text-attested"
              note={money(agents.onchainCents)}
            />
            <Stat
              label="Active keys"
              value={agents.activeKeys.toLocaleString()}
              note={`of ${agents.totalKeys.toLocaleString()} created, ${agents.oauthKeys.toLocaleString()} from agent connections`}
            />
          </div>
          <p className="mt-4 border-t pt-4 text-xs text-muted-foreground">
            A rail beside the funnels, not a stage of them: an API call spends
            credits an account already bought, and an onchain sale mints an
            account with no session, no modal and no checkout event. Key counts
            are as of now; calls and sales are windowed. The onchain figures
            here are the same lots the Purchases card counts under the{' '}
            <span className="font-mono">x402</span> rail.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
