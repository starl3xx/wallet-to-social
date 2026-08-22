'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Segmented, type SegmentedOption } from '@/components/ui/segmented';
import { Sparkline } from './Sparkline';
import { shortId } from './format';
import { Stat, StatTile } from './Stat';
import { Meter } from './Meter';
import { RefreshButton } from './RefreshButton';
import { Empty, Loading } from './PaneState';
import {
  ArrowsClockwise as RefreshCw,
  CaretDown as ChevronDown,
  CaretUp as ChevronUp,
} from '@phosphor-icons/react';

type TimePeriod = 'today' | 'week' | 'month';

/**
 * Module scope, not inline: `Segmented` keeps the thumb position in arithmetic
 * over this array, and rebuilding it every render gives the memoised children a
 * new identity for no reason.
 */
const PERIODS: SegmentedOption<TimePeriod>[] = [
  { value: 'today', label: 'Today', content: 'Today' },
  { value: 'week', label: 'Week', content: 'Week' },
  { value: 'month', label: 'Month', content: 'Month' },
];

interface UsageMetrics {
  totalLookups: number;
  totalWallets: number;
  avgMatchRate: number;
  avgProcessingTime: number;
  lookupsChange: number;
  walletsChange: number;
  matchRateChange: number;
  processingTimeChange: number;
}

interface MatchAnalytics {
  twitterRate: number;
  farcasterRate: number;
  anyRate: number;
  trendData: {
    date: string;
    twitterRate: number;
    farcasterRate: number;
    anyRate: number;
  }[];
}

interface PerformanceMetrics {
  pendingJobs: number;
  runningJobs: number;
  successRate: number;
  failedCount: number;
  stageDistribution: {
    stage: string;
    percentage: number;
  }[];
}

interface RecentActivity {
  id: string;
  walletCount: number;
  twitterFound: number;
  farcasterFound: number;
  matchRate: number;
  completedAt: string;
}

interface DashboardData {
  usage: UsageMetrics;
  match: MatchAnalytics;
  performance: PerformanceMetrics;
  recentActivity: RecentActivity[];
}

interface LookupDashboardProps {
  password: string;
}

export function LookupDashboard({ password }: LookupDashboardProps) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<TimePeriod>('today');
  const [showRecentActivity, setShowRecentActivity] = useState(false);

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/admin/dashboard?period=${period}`, {
        headers: { 'x-admin-password': password },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch dashboard data');
      }

      const dashboardData = await response.json();
      setData(dashboardData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [password, period]);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  const formatChange = (value: number, isTime = false) => {
    const sign = value >= 0 ? '+' : '';
    if (isTime) {
      return `${sign}${value.toFixed(1)}s`;
    }
    return `${sign}${value.toFixed(1)}${!isTime ? '%' : ''}`;
  };

  const formatTime = (seconds: number) => {
    if (seconds < 60) return `${seconds.toFixed(1)}s`;
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}m ${secs.toFixed(0)}s`;
  };

  const formatTimeAgo = (isoString: string) => {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  const periodLabels: Record<TimePeriod, string> = {
    today: 'Today',
    week: 'Last 7 days',
    month: 'Last 30 days',
  };

  if (loading && !data) {
    return <Loading />;
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-destructive mb-4">{error}</p>
        <Button variant="outline" onClick={fetchDashboard}>
          <RefreshCw className="h-4 w-4" aria-hidden />
          Retry
        </Button>
      </div>
    );
  }

  if (!data) return null;

  const { usage, match, performance, recentActivity } = data;

  return (
    <div className="space-y-6">
      {/* Header with period toggle */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-light tracking-[var(--tracking-title)]">
          Lookup metrics
        </h2>
        <div className="flex items-center gap-2">
          <Segmented
            ariaLabel="Time period"
            value={period}
            onChange={setPeriod}
            options={PERIODS}
          />
          <RefreshButton onClick={fetchDashboard} loading={loading} />
        </div>
      </div>

      {/* Usage metrics cards. The delta against the previous period sits at
          the figure's baseline; green when it moved the right way, caution
          when it did not, and for processing time the right way is down. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatTile
          label="Lookups"
          value={usage.totalLookups}
          aside={
            <span
              className={`text-xs tabular-nums ${usage.lookupsChange >= 0 ? 'text-attested' : 'text-caution'}`}
            >
              {formatChange(usage.lookupsChange)} vs prev
            </span>
          }
        />
        <StatTile
          label="Wallets"
          value={usage.totalWallets.toLocaleString()}
          aside={
            <span
              className={`text-xs tabular-nums ${usage.walletsChange >= 0 ? 'text-attested' : 'text-caution'}`}
            >
              {formatChange(usage.walletsChange)} vs prev
            </span>
          }
        />
        <StatTile
          label="Match rate"
          value={`${usage.avgMatchRate.toFixed(1)}%`}
          aside={
            <span
              className={`text-xs tabular-nums ${usage.matchRateChange >= 0 ? 'text-attested' : 'text-caution'}`}
            >
              {formatChange(usage.matchRateChange)} vs prev
            </span>
          }
        />
        <StatTile
          label="Avg time"
          value={formatTime(usage.avgProcessingTime)}
          aside={
            <span
              className={`text-xs tabular-nums ${usage.processingTimeChange <= 0 ? 'text-attested' : 'text-caution'}`}
            >
              {formatChange(usage.processingTimeChange, true)}
            </span>
          }
        />
      </div>

      {/* Match analytics section */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Match analytics</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-6">
            {/* Platform rates, as figures. They were fill bars, and a 12%
                rate drawn as a bar reads as 88% unfinished; a rate is a
                number with a label, and each is a measured fact, so it
                carries the attested dot. */}
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">
                Platform rates
              </div>
              <div className="grid grid-cols-3 gap-4">
                <Stat
                  label="X"
                  value={`${match.twitterRate.toFixed(1)}%`}
                  attested
                />
                <Stat
                  label="Farcaster"
                  value={`${match.farcasterRate.toFixed(1)}%`}
                  attested
                />
                <Stat
                  label="Any social"
                  value={`${match.anyRate.toFixed(1)}%`}
                  attested
                />
              </div>
            </div>

            {/* 7-day trend */}
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">7-day trend</div>
              {match.trendData.length > 1 ? (
                <div className="space-y-3">
                  {/* Two sparklines sit side by side and are already labelled
                      under each chart, so the legend does not need colour to
                      tell them apart. It previously used two hues that the
                      sweep collapsed into one, leaving a key where both
                      swatches matched and neither matched its line. Solid
                      versus outlined distinguishes them without reintroducing
                      a second brand colour for a purely decorative job. */}
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1">
                      <div className="w-3 h-0.5 rounded-sm bg-accent-brand" />
                      <span className="text-xs text-muted-foreground">X</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="w-3 h-0.5 rounded-sm bg-accent-brand/40" />
                      <span className="text-xs text-muted-foreground">
                        Farcaster
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <Sparkline
                        data={match.trendData.map((d) => d.twitterRate)}
                        width={200}
                        height={40}
                        color="var(--accent-brand)"
                      />
                    </div>
                    <div className="flex-1">
                      <Sparkline
                        data={match.trendData.map((d) => d.farcasterRate)}
                        width={200}
                        height={40}
                        color="color-mix(in oklch, var(--accent-brand) 40%, transparent)"
                      />
                    </div>
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>7 days ago</span>
                    <span>Today</span>
                  </div>
                </div>
              ) : (
                <Empty>Not enough data for trend</Empty>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Performance section */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Performance</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-3 gap-6">
            {/* Queue status */}
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">Queue</div>
              <div className="grid grid-cols-2 gap-4">
                <Stat label="Pending" value={performance.pendingJobs} />
                <Stat label="Running" value={performance.runningJobs} />
              </div>
            </div>

            {/* Success rate. A success rate is a measured outcome, so the
                figure carries the attested dot; the failed count beside it
                is a plain figure, not a destructive one, because destructive
                is for revoking and deleting. */}
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">
                Success rate ({periodLabels[period]})
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Stat
                  label="Success"
                  value={`${performance.successRate.toFixed(1)}%`}
                  attested
                />
                <Stat label="Failed" value={performance.failedCount} />
              </div>
            </div>

            {/* Stage distribution: a share of the whole, so a bar is the
                right shape here. */}
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">
                Stage distribution
              </div>
              {performance.stageDistribution.length > 0 ? (
                <div className="space-y-2">
                  {performance.stageDistribution.slice(0, 4).map((stage) => (
                    <div key={stage.stage} className="flex items-center gap-2">
                      <span className="text-xs w-16 truncate">
                        {stage.stage}
                      </span>
                      <Meter
                        className="flex-1"
                        value={stage.percentage / 100}
                      />
                      <span className="text-xs text-muted-foreground tabular-nums w-10 text-right">
                        {stage.percentage.toFixed(0)}%
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty>No stage data</Empty>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Recent activity (collapsible) */}
      <Card>
        <CardHeader className="pb-2">
          <button
            type="button"
            aria-expanded={showRecentActivity}
            onClick={() => setShowRecentActivity(!showRecentActivity)}
            className="flex items-center justify-between w-full text-left"
          >
            <CardTitle className="text-base">
              Recent activity ({recentActivity.length})
            </CardTitle>
            {showRecentActivity ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
        </CardHeader>
        {showRecentActivity && (
          <CardContent className="pt-0">
            {recentActivity.length === 0 ? (
              <Empty>No recent activity</Empty>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead className="text-right">Wallets</TableHead>
                    <TableHead className="text-right">X</TableHead>
                    <TableHead className="text-right">Farcaster</TableHead>
                    <TableHead className="text-right">Match rate</TableHead>
                    <TableHead>Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentActivity.map((activity) => (
                    <TableRow key={activity.id}>
                      <TableCell className="font-mono text-xs">
                        {shortId(activity.id)}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {activity.walletCount.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {activity.twitterFound}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {activity.farcasterFound}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {activity.matchRate.toFixed(1)}%
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {formatTimeAgo(activity.completedAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  );
}
