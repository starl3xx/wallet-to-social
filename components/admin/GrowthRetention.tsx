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
import {
  CircleNotch as Loader2,
  ArrowsClockwise as RefreshCw,
} from '@phosphor-icons/react';
import { Sparkline } from './Sparkline';

interface DailyStat {
  date: string;
  totalLookups: number;
  totalWalletsProcessed: number;
  uniqueUsers: number;
  newUsers: number;
  revenueCents: number;
  avgMatchRate: number;
  errorCount: number;
}

interface RetentionCohort {
  cohortWeek: string;
  retention: number[];
}

interface GrowthRetentionProps {
  password: string;
}

export function GrowthRetention({ password }: GrowthRetentionProps) {
  const [dailyStats, setDailyStats] = useState<DailyStat[]>([]);
  const [retention, setRetention] = useState<RetentionCohort[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [statsRes, retentionRes] = await Promise.all([
        fetch('/api/admin/analytics/aggregate?days=30', {
          headers: { 'x-admin-password': password },
        }),
        fetch('/api/admin/analytics/retention?weeks=6', {
          headers: { 'x-admin-password': password },
        }),
      ]);

      if (!statsRes.ok || !retentionRes.ok) {
        throw new Error('Failed to fetch growth data');
      }

      const [statsData, retentionData] = await Promise.all([
        statsRes.json(),
        retentionRes.json(),
      ]);

      setDailyStats(statsData);
      setRetention(retentionData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [password]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Aggregate weekly stats
  const weeklyStats = dailyStats.reduce(
    (acc, stat) => {
      const weekStart = new Date(stat.date);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      const weekKey = weekStart.toISOString().split('T')[0];

      if (!acc[weekKey]) {
        acc[weekKey] = { lookups: 0, users: 0, newUsers: 0, revenue: 0 };
      }

      acc[weekKey].lookups += stat.totalLookups;
      acc[weekKey].users = Math.max(acc[weekKey].users, stat.uniqueUsers);
      acc[weekKey].newUsers += stat.newUsers;
      acc[weekKey].revenue += stat.revenueCents;

      return acc;
    },
    {} as Record<
      string,
      { lookups: number; users: number; newUsers: number; revenue: number }
    >
  );

  const weeks = Object.entries(weeklyStats)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-12);

  const cumulativeUsers = dailyStats.reduce(
    (sum, stat) => sum + stat.newUsers,
    0
  );

  if (loading && dailyStats.length === 0) {
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
        <Button variant="outline" onClick={fetchData}>
          <RefreshCw className="h-4 w-4" aria-hidden />
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Growth & retention</h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={fetchData}
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

      {/* User Growth */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">User growth</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
            <div>
              <div className="text-xs text-muted-foreground mb-1">
                New users/week
              </div>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-extralight tabular-nums">
                  {weeks.length > 0 ? weeks[weeks.length - 1][1].newUsers : 0}
                </span>
                <Sparkline
                  data={weeks.map((w) => w[1].newUsers)}
                  width={80}
                  height={24}
                  color="var(--accent-brand)"
                />
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">
                Total users (30d)
              </div>
              <div className="text-2xl font-extralight tabular-nums">
                {cumulativeUsers}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">
                Lookups/week
              </div>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-extralight tabular-nums">
                  {weeks.length > 0 ? weeks[weeks.length - 1][1].lookups : 0}
                </span>
                <Sparkline
                  data={weeks.map((w) => w[1].lookups)}
                  width={80}
                  height={24}
                  color="var(--accent-brand)"
                />
              </div>
            </div>
          </div>

          {/* The `Table` primitive, as every other pane. This was a raw
              `<table>` with `py-2` cells and `border-t` rows: a third row
              height and a second header treatment for the same object. */}
          {weeks.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Week</TableHead>
                  <TableHead className="text-right">New users</TableHead>
                  <TableHead className="text-right">Lookups</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {weeks.slice(-8).map(([week, data]) => (
                  <TableRow key={week}>
                    <TableCell className="font-mono text-xs tabular-nums">
                      {week}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {data.newUsers}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {data.lookups}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      ${(data.revenue / 100).toFixed(0)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Retention Cohorts */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Retention cohorts</CardTitle>
        </CardHeader>
        <CardContent>
          {retention.length === 0 ? (
            <p className="text-center text-muted-foreground py-4">
              Not enough data for retention analysis yet
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cohort</TableHead>
                  {Array.from({
                    length: Math.max(
                      ...retention.map((r) => r.retention.length)
                    ),
                  }).map((_, i) => (
                    <TableHead key={i} className="text-center">
                      W{i}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {retention.map((cohort) => (
                  <TableRow key={cohort.cohortWeek}>
                    <TableCell className="font-mono text-xs tabular-nums">
                      {cohort.cohortWeek}
                    </TableCell>
                    {cohort.retention.map((rate, i) => (
                      <TableCell
                        key={i}
                        className="text-center tabular-nums"
                        /* Retention is a measured fact about a cohort, so
                           the heat is `attested`; a violet cell reads as
                           something to click. */
                        style={{
                          backgroundColor:
                            rate > 0
                              ? `color-mix(in oklch, var(--attested) ${Math.min(rate / 100, 1) * 50}%, transparent)`
                              : 'transparent',
                        }}
                      >
                        {rate}%
                      </TableCell>
                    ))}
                    {/* Fill empty cells */}
                    {Array.from({
                      length:
                        Math.max(...retention.map((r) => r.retention.length)) -
                        cohort.retention.length,
                    }).map((_, i) => (
                      <TableCell
                        key={`empty-${i}`}
                        className="text-center text-muted-foreground"
                      >
                        -
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <p className="text-xs text-muted-foreground mt-4">
            Each row shows what % of users from that cohort week returned in
            subsequent weeks.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
