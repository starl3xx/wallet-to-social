'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardActivator, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Sparkline } from './Sparkline';
import {
  CircleNotch as Loader2,
  ArrowsClockwise as RefreshCw,
  TrendUp as TrendingUp,
  TrendDown as TrendingDown,
  Minus,
  MagnifyingGlass as Search,
  CurrencyDollar as DollarSign,
  WarningCircle as AlertCircle,
  Stack as Layers,
  Users,
  ChartBar as BarChart3,
} from '@phosphor-icons/react';

interface PulseData {
  lookupsToday: number;
  lookupsTrend: number[];
  activeUsers7d: number;
  activeUsersTrend: 'up' | 'down' | 'flat';
  conversionRate: number;
  revenueMTD: number;
  revenueVsLastMonth: number;
  errorRate: number;
  errorStatus: 'green' | 'yellow' | 'red';
  queueDepth: number;
}

interface ExecutivePulseProps {
  password: string;
  onMetricClick?: (metric: string) => void;
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
    return (
      <span
        className={`inline-block w-2 h-2 rounded-full ${colors[status]} mr-1`}
      />
    );
  };

  if (loading && !data) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Executive pulse</h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={fetchPulse}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="h-4 w-4" aria-hidden />
          )}
          <span className="sr-only">Refresh</span>
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {/* Lookups Today */}
        <Card className="relative hover:border-accent-brand transition-control">
          {onMetricClick && (
            <CardActivator
              label="Lookups today: open the jobs tab"
              onClick={() => onMetricClick('jobs')}
            />
          )}
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <Search className="h-3 w-3" />
              <span>Lookups today</span>
            </div>
            <div className="flex items-end justify-between">
              <span className="text-2xl font-extralight tabular-nums">
                {data.lookupsToday}
              </span>
              <Sparkline
                data={data.lookupsTrend}
                width={60}
                height={20}
                color="var(--accent-brand)"
              />
            </div>
          </CardContent>
        </Card>

        {/* Active Users */}
        <Card className="relative hover:border-accent-brand transition-control">
          {onMetricClick && (
            <CardActivator
              label="Active users: open the behaviour tab"
              onClick={() => onMetricClick('behavior')}
            />
          )}
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <Users className="h-3 w-3" />
              <span>Active users (7d)</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-2xl font-extralight tabular-nums">
                {data.activeUsers7d}
              </span>
              <TrendIcon trend={data.activeUsersTrend} />
            </div>
          </CardContent>
        </Card>

        {/* Conversion Rate */}
        <Card className="relative hover:border-accent-brand transition-control">
          {onMetricClick && (
            <CardActivator
              label="Conversion rate: open the revenue tab"
              onClick={() => onMetricClick('revenue')}
            />
          )}
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <BarChart3 className="h-3 w-3" />
              <span>Conversion rate</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-2xl font-extralight tabular-nums">
                {data.conversionRate.toFixed(1)}%
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Revenue MTD */}
        <Card className="relative hover:border-accent-brand transition-control">
          {onMetricClick && (
            <CardActivator
              label="Revenue this month: open the revenue tab"
              onClick={() => onMetricClick('revenue')}
            />
          )}
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <DollarSign className="h-3 w-3" />
              <span>Revenue (MTD)</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-2xl font-extralight tabular-nums">
                ${data.revenueMTD.toLocaleString()}
              </span>
              <span
                className={`text-xs ${
                  data.revenueVsLastMonth >= 0
                    ? 'text-attested'
                    : 'text-caution'
                }`}
              >
                {data.revenueVsLastMonth >= 0 ? '+' : ''}
                {data.revenueVsLastMonth}%
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Error Rate */}
        <Card className="relative hover:border-accent-brand transition-control">
          {onMetricClick && (
            <CardActivator
              label="Error rate: open the health tab"
              onClick={() => onMetricClick('health')}
            />
          )}
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <AlertCircle className="h-3 w-3" />
              <span>Error rate (24h)</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-2xl font-extralight tabular-nums">
                <StatusIndicator status={data.errorStatus} />
                {data.errorRate.toFixed(1)}%
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Queue Depth */}
        <Card className="relative hover:border-accent-brand transition-control">
          {onMetricClick && (
            <CardActivator
              label="Queue depth: open the jobs tab"
              onClick={() => onMetricClick('jobs')}
            />
          )}
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <Layers className="h-3 w-3" />
              <span>Queue depth</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-2xl font-extralight tabular-nums">
                {data.queueDepth}
              </span>
              {/* Two tiers, matching the two labels that differ. There was a
                  destructive tier at > 50, tested after > 10 and so never
                  reached; it is gone rather than reordered, because a backlog
                  is a metric and destructive is for revoking and deleting. */}
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
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
