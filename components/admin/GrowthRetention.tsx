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
import { ArrowsClockwise as RefreshCw } from '@phosphor-icons/react';
import { Sparkline } from './Sparkline';
import { Stat } from './Stat';
import { RefreshButton } from './RefreshButton';
import { Empty, Loading } from './PaneState';

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

interface EmailStatus {
  sends: Array<{ emailKey: string; count: number; lastSentAt: string | null }>;
  optOuts: number;
}

interface GrowthRetentionProps {
  password: string;
}

export function GrowthRetention({ password }: GrowthRetentionProps) {
  const [dailyStats, setDailyStats] = useState<DailyStat[]>([]);
  const [retention, setRetention] = useState<RetentionCohort[]>([]);
  const [email, setEmail] = useState<EmailStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [statsRes, retentionRes, emailRes] = await Promise.all([
        fetch('/api/admin/analytics/aggregate?days=30', {
          headers: { 'x-admin-password': password },
        }),
        fetch('/api/admin/analytics/retention?weeks=6', {
          headers: { 'x-admin-password': password },
        }),
        fetch('/api/admin/email', {
          headers: { 'x-admin-password': password },
        }),
      ]);

      if (!statsRes.ok || !retentionRes.ok || !emailRes.ok) {
        throw new Error('Failed to fetch growth data');
      }

      const [statsData, retentionData, emailData] = await Promise.all([
        statsRes.json(),
        retentionRes.json(),
        emailRes.json(),
      ]);

      setDailyStats(statsData);
      setRetention(retentionData);
      setEmail(emailData);
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
    return <Loading />;
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
        <h2 className="text-2xl font-light tracking-[var(--tracking-title)]">
          Growth & retention
        </h2>
        <RefreshButton onClick={fetchData} loading={loading} />
      </div>

      {/* User Growth */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">User growth</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
            <Stat
              label="New users/week"
              value={weeks.length > 0 ? weeks[weeks.length - 1][1].newUsers : 0}
              aside={
                <Sparkline
                  data={weeks.map((w) => w[1].newUsers)}
                  width={80}
                  height={24}
                  color="var(--accent-brand)"
                />
              }
            />
            <Stat label="Total users (30d)" value={cumulativeUsers} />
            <Stat
              label="Lookups/week"
              value={weeks.length > 0 ? weeks[weeks.length - 1][1].lookups : 0}
              aside={
                <Sparkline
                  data={weeks.map((w) => w[1].lookups)}
                  width={80}
                  height={24}
                  color="var(--accent-brand)"
                />
              }
            />
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
                    <TableCell className="text-right font-medium tabular-nums">
                      {data.newUsers}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {data.lookups}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
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
            <Empty>Not enough data for retention analysis yet</Empty>
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

      {/* Lifecycle email. Sends come from the lifecycle_emails ledger, which
          the campaign script writes at-most-once per account; opt-outs come
          from the unsubscribe endpoint. Both were readable only through
          ad-hoc SQL before this card. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lifecycle email</CardTitle>
        </CardHeader>
        <CardContent>
          {!email || email.sends.length === 0 ? (
            <Empty>
              No lifecycle email has been sent
              {email && email.optOuts > 0 ? `; ${email.optOuts} opted out` : ''}
            </Empty>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead className="text-right">Sent</TableHead>
                    <TableHead className="text-right">Last send</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {email.sends.map((s) => (
                    <TableRow key={s.emailKey}>
                      <TableCell className="font-medium">
                        {s.emailKey}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {s.count}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground tabular-nums">
                        {s.lastSentAt
                          ? new Date(s.lastSentAt).toLocaleDateString()
                          : '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="text-xs text-muted-foreground mt-4">
                {email.optOuts} account{email.optOuts === 1 ? ' has' : 's have'}{' '}
                opted out of lifecycle mail.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
