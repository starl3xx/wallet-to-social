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
import { Sparkline } from './Sparkline';
import {
  Loader2,
  RefreshCw,
  Search,
  Wallet,
  Percent,
  Clock,
  ChevronDown,
  ChevronUp,
  Layers,
  CheckCircle,
  XCircle,
} from 'lucide-react';

type TimePeriod = 'today' | 'week' | 'month';

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
        <Button variant="outline" onClick={fetchDashboard}>
          <RefreshCw className="h-4 w-4 mr-2" />
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
        <h2 className="text-lg font-semibold">Usage metrics</h2>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border overflow-hidden">
            {(['today', 'week', 'month'] as TimePeriod[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                  period === p
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background hover:bg-muted'
                }`}
              >
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>
          <Button variant="ghost" size="sm" onClick={fetchDashboard} disabled={loading}>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Usage metrics cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <Search className="h-3 w-3" />
              <span>Lookups</span>
            </div>
            <div className="flex items-end justify-between">
              <span className="text-2xl font-bold">{usage.totalLookups}</span>
              <span
                className={`text-xs ${usage.lookupsChange >= 0 ? 'text-green-500' : 'text-red-500'}`}
              >
                {formatChange(usage.lookupsChange)} vs prev
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <Wallet className="h-3 w-3" />
              <span>Wallets</span>
            </div>
            <div className="flex items-end justify-between">
              <span className="text-2xl font-bold">{usage.totalWallets.toLocaleString()}</span>
              <span
                className={`text-xs ${usage.walletsChange >= 0 ? 'text-green-500' : 'text-red-500'}`}
              >
                {formatChange(usage.walletsChange)} vs prev
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <Percent className="h-3 w-3" />
              <span>Match rate</span>
            </div>
            <div className="flex items-end justify-between">
              <span className="text-2xl font-bold">{usage.avgMatchRate.toFixed(1)}%</span>
              <span
                className={`text-xs ${usage.matchRateChange >= 0 ? 'text-green-500' : 'text-red-500'}`}
              >
                {formatChange(usage.matchRateChange)} vs prev
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <Clock className="h-3 w-3" />
              <span>Avg time</span>
            </div>
            <div className="flex items-end justify-between">
              <span className="text-2xl font-bold">{formatTime(usage.avgProcessingTime)}</span>
              <span
                className={`text-xs ${usage.processingTimeChange <= 0 ? 'text-green-500' : 'text-red-500'}`}
              >
                {formatChange(usage.processingTimeChange, true)}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Match analytics section */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Match analytics</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-6">
            {/* Platform rates */}
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">Platform rates</div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm">Twitter/X</span>
                  <span className="text-sm font-medium">{match.twitterRate.toFixed(1)}%</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full transition-all"
                    style={{ width: `${Math.min(match.twitterRate, 100)}%` }}
                  />
                </div>

                <div className="flex items-center justify-between mt-3">
                  <span className="text-sm">Farcaster</span>
                  <span className="text-sm font-medium">{match.farcasterRate.toFixed(1)}%</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-purple-500 rounded-full transition-all"
                    style={{ width: `${Math.min(match.farcasterRate, 100)}%` }}
                  />
                </div>

                <div className="flex items-center justify-between mt-3">
                  <span className="text-sm">Any social</span>
                  <span className="text-sm font-medium">{match.anyRate.toFixed(1)}%</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-green-500 rounded-full transition-all"
                    style={{ width: `${Math.min(match.anyRate, 100)}%` }}
                  />
                </div>
              </div>
            </div>

            {/* 7-day trend */}
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">7-day trend</div>
              {match.trendData.length > 1 ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1">
                      <div className="w-3 h-0.5 bg-blue-500 rounded" />
                      <span className="text-xs text-muted-foreground">Twitter</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="w-3 h-0.5 bg-purple-500 rounded" />
                      <span className="text-xs text-muted-foreground">Farcaster</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <Sparkline
                        data={match.trendData.map((d) => d.twitterRate)}
                        width={200}
                        height={40}
                        color="rgb(59, 130, 246)"
                      />
                    </div>
                    <div className="flex-1">
                      <Sparkline
                        data={match.trendData.map((d) => d.farcasterRate)}
                        width={200}
                        height={40}
                        color="rgb(168, 85, 247)"
                      />
                    </div>
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>7 days ago</span>
                    <span>Today</span>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center h-20 text-muted-foreground text-sm">
                  Not enough data for trend
                </div>
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
              <div className="flex items-center gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <Layers className="h-4 w-4 text-yellow-500" />
                    <span className="text-sm">Pending</span>
                  </div>
                  <span className="text-2xl font-bold">{performance.pendingJobs}</span>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
                    <span className="text-sm">Running</span>
                  </div>
                  <span className="text-2xl font-bold">{performance.runningJobs}</span>
                </div>
              </div>
            </div>

            {/* Success rate */}
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">Success rate ({periodLabels[period]})</div>
              <div className="flex items-center gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    <span className="text-sm">Success</span>
                  </div>
                  <span className="text-2xl font-bold">{performance.successRate.toFixed(1)}%</span>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <XCircle className="h-4 w-4 text-red-500" />
                    <span className="text-sm">Failed</span>
                  </div>
                  <span className="text-2xl font-bold">{performance.failedCount}</span>
                </div>
              </div>
            </div>

            {/* Stage distribution */}
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">Stage distribution</div>
              {performance.stageDistribution.length > 0 ? (
                <div className="space-y-2">
                  {performance.stageDistribution.slice(0, 4).map((stage) => (
                    <div key={stage.stage} className="flex items-center gap-2">
                      <span className="text-xs w-16 truncate">{stage.stage}</span>
                      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary rounded-full transition-all"
                          style={{ width: `${Math.min(stage.percentage, 100)}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground w-10 text-right">
                        {stage.percentage.toFixed(0)}%
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">No stage data</div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Recent activity (collapsible) */}
      <Card>
        <CardHeader className="pb-2">
          <button
            onClick={() => setShowRecentActivity(!showRecentActivity)}
            className="flex items-center justify-between w-full text-left"
          >
            <CardTitle className="text-base">Recent activity ({recentActivity.length})</CardTitle>
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
              <p className="text-center text-muted-foreground py-4">No recent activity</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>Wallets</TableHead>
                      <TableHead>Twitter</TableHead>
                      <TableHead>Farcaster</TableHead>
                      <TableHead>Match rate</TableHead>
                      <TableHead>Time</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentActivity.map((activity) => (
                      <TableRow key={activity.id}>
                        <TableCell className="font-mono text-xs">
                          {activity.id.slice(0, 8)}...
                        </TableCell>
                        <TableCell>{activity.walletCount.toLocaleString()}</TableCell>
                        <TableCell>{activity.twitterFound}</TableCell>
                        <TableCell>{activity.farcasterFound}</TableCell>
                        <TableCell>{activity.matchRate.toFixed(1)}%</TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {formatTimeAgo(activity.completedAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  );
}
