'use client';

import { useState, useEffect, useCallback } from 'react';
import { CardActivator } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Sparkline } from './Sparkline';
import { StatTile } from './Stat';
import { RefreshButton } from './RefreshButton';
import { Loading } from './PaneState';
import type { AdminTab } from './AdminNav';
import {
  ArrowsClockwise as RefreshCw,
  TrendUp as TrendingUp,
  TrendDown as TrendingDown,
  Minus,
} from '@phosphor-icons/react';

interface PulseData {
  lookupsToday: number;
  lookupsTrend: number[];
  activeUsers7d: number;
  activeUsersTrend: 'up' | 'down' | 'flat';
  /** Payments over pricing views, 7 days. `null` when nobody saw pricing. */
  pricingToPaid: number | null;
  revenueMTD: number;
  revenueVsLastMonth: number;
  errorRate: number;
  errorStatus: 'green' | 'yellow' | 'red';
  queueDepth: number;
}

interface ExecutivePulseProps {
  password: string;
  /**
   * `AdminTab`, not `string`. The page used to match the incoming value against
   * four string literals and do nothing for anything else, so renaming a
   * destination compiled cleanly and left the tile inert. A tab that no longer
   * exists is now a type error here, at the tile that names it.
   */
  onMetricClick?: (tab: AdminTab) => void;
}

export function ExecutivePulse({
  password,
  onMetricClick,
}: ExecutivePulseProps) {
  const [data, setData] = useState<PulseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPulse = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/admin/analytics/pulse', {
        headers: { 'x-admin-password': password },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch pulse data');
      }

      const pulseData = await response.json();
      setData(pulseData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [password]);

  useEffect(() => {
    fetchPulse();
  }, [fetchPulse]);

  // A trend is a measured outcome, so it is green or amber, never violet: violet
  // marks something you can act on, and a number that went up is not that. Down
  // is caution rather than destructive, which is reserved for failed jobs and
  // for revoking and deleting.
  const TrendIcon = ({ trend }: { trend: 'up' | 'down' | 'flat' }) => {
    switch (trend) {
      case 'up':
        return <TrendingUp className="h-4 w-4 text-attested" />;
      case 'down':
        return <TrendingDown className="h-4 w-4 text-caution" />;
      default:
        return <Minus className="h-4 w-4 text-muted-foreground" />;
    }
  };

  // The key is literally `green`, so the dot is `attested`: the API measured a
  // low error rate and is stating it as a fact.
  const StatusIndicator = ({
    status,
  }: {
    status: 'green' | 'yellow' | 'red';
  }) => {
    const colors = {
      green: 'bg-attested',
      yellow: 'bg-caution',
      red: 'bg-destructive',
    };
    // No margin of its own: the figure it sits in is a flex row with a gap,
    // and a gap plus a child margin silently add.
    return (
      <span
        className={`inline-block w-2 h-2 rounded-full ${colors[status]}`}
        aria-hidden
      />
    );
  };

  if (loading && !data) {
    return <Loading />;
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-destructive mb-4">{error}</p>
        <Button variant="outline" onClick={fetchPulse}>
          <RefreshCw className="h-4 w-4" aria-hidden />
          Retry
        </Button>
      </div>
    );
  }

  if (!data) return null;

  // The tile label carries no icon: the affordance table gives a label none,
  // and the six glyphs that sat here repeated what the words already said.
  const tile = 'hover:border-accent-brand transition-control';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-light tracking-[var(--tracking-title)]">
          Executive pulse
        </h2>
        <RefreshButton onClick={fetchPulse} loading={loading} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatTile
          className={tile}
          label="Lookups today"
          value={data.lookupsToday}
          aside={
            <Sparkline
              data={data.lookupsTrend}
              width={60}
              height={20}
              color="var(--accent-brand)"
            />
          }
        >
          {onMetricClick && (
            <CardActivator
              label="Lookups today: open the records tab"
              onClick={() => onMetricClick('records')}
            />
          )}
        </StatTile>

        <StatTile
          className={tile}
          label="Active users (7d)"
          value={data.activeUsers7d}
          aside={<TrendIcon trend={data.activeUsersTrend} />}
        >
          {onMetricClick && (
            <CardActivator
              label="Active users: open the growth tab"
              onClick={() => onMetricClick('growth')}
            />
          )}
        </StatTile>

        {/* Named, and pointed at the pane that computes it.
            This tile said "Conversion rate" and divided payments by lookups,
            while the revenue pane it linked to divided payments by pricing
            views: one word over two definitions, and the link was the one
            journey that put them side by side. Both panes now read the same
            helper, and the tile says which of the two rates it is. */}
        <StatTile
          className={tile}
          label="Pricing → paid"
          value={
            data.pricingToPaid === null
              ? 'n/a'
              : `${data.pricingToPaid.toFixed(1)}%`
          }
        >
          {onMetricClick && (
            <CardActivator
              label="Pricing to paid: open the funnel tab"
              onClick={() => onMetricClick('funnel')}
            />
          )}
        </StatTile>

        <StatTile
          className={tile}
          /* "Booked", not net. This reads `daily_stats.revenue_cents`, which
             sums what was charged and knows nothing about refunds; the revenue
             pane reads Stripe and is net of them. The two are allowed to
             differ, so each says which it is rather than both saying
             "revenue". */
          label="Revenue (MTD, booked)"
          value={`$${data.revenueMTD.toLocaleString()}`}
          aside={
            <span
              className={`text-xs tabular-nums ${
                data.revenueVsLastMonth >= 0 ? 'text-attested' : 'text-caution'
              }`}
            >
              {data.revenueVsLastMonth >= 0 ? '+' : ''}
              {data.revenueVsLastMonth}%
            </span>
          }
        >
          {onMetricClick && (
            <CardActivator
              label="Revenue this month: open the revenue tab"
              onClick={() => onMetricClick('revenue')}
            />
          )}
        </StatTile>

        <StatTile
          className={tile}
          label="Error rate (24h)"
          value={
            <>
              <StatusIndicator status={data.errorStatus} />
              {data.errorRate.toFixed(1)}%
            </>
          }
        >
          {onMetricClick && (
            <CardActivator
              label="Error rate: open the health tab"
              onClick={() => onMetricClick('health')}
            />
          )}
        </StatTile>

        <StatTile
          className={tile}
          label="Queue depth"
          value={data.queueDepth}
          /* Two tiers, matching the two labels that differ. There was a
             destructive tier at > 50, tested after > 10 and so never
             reached; it is gone rather than reordered, because a backlog
             is a metric and destructive is for revoking and deleting. */
          aside={
            <span
              className={`text-xs ${
                data.queueDepth > 10 ? 'text-caution' : 'text-attested'
              }`}
            >
              {data.queueDepth === 0
                ? 'idle'
                : data.queueDepth <= 10
                  ? 'normal'
                  : 'busy'}
            </span>
          }
        >
          {onMetricClick && (
            <CardActivator
              label="Queue depth: open the records tab"
              onClick={() => onMetricClick('records')}
            />
          )}
        </StatTile>
      </div>
    </div>
  );
}
