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
  ArrowsClockwise as RefreshCw,
  Warning as AlertTriangle,
} from '@phosphor-icons/react';
import { shortId } from './format';
import { Stat } from './Stat';
import { RefreshButton } from './RefreshButton';
import { Empty, Loading } from './PaneState';

interface ApiStat {
  provider: string;
  avgLatency: number;
  p99Latency: number;
  errorRate: number;
  totalCalls: number;
}

interface ApiError {
  id: string;
  provider: string;
  errorMessage: string;
  jobId: string | null;
  createdAt: string;
}

/**
 * What the pulse endpoint reports about the queue: one number, pending and
 * processing added together (`lib/analytics.ts`, `getExecutivePulse`). It does
 * not split them, so the split is not shown here as if it did.
 */
interface QueueStats {
  depth: number;
}

interface SystemHealthProps {
  password: string;
}

export function SystemHealth({ password }: SystemHealthProps) {
  const [apiStats, setApiStats] = useState<ApiStat[]>([]);
  const [errors, setErrors] = useState<ApiError[]>([]);
  // Null until the pulse has answered. A zero here would read as a measured
  // empty queue, which is the thing this card used to do.
  const [queue, setQueue] = useState<QueueStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [statsRes, errorsRes, pulseRes] = await Promise.all([
        fetch('/api/admin/analytics/api-stats?hours=24', {
          headers: { 'x-admin-password': password },
        }),
        fetch('/api/admin/analytics/errors?limit=20', {
          headers: { 'x-admin-password': password },
        }),
        fetch('/api/admin/analytics/pulse', {
          headers: { 'x-admin-password': password },
        }),
      ]);

      if (!statsRes.ok || !errorsRes.ok || !pulseRes.ok) {
        throw new Error('Failed to fetch health data');
      }

      const [statsData, errorsData, pulseData] = await Promise.all([
        statsRes.json(),
        errorsRes.json(),
        pulseRes.json(),
      ]);

      setApiStats(statsData);
      setErrors(errorsData);
      // The same payload the Pulse tile reads. It was fetched here and then
      // discarded in favour of hard-coded zeros.
      setQueue(
        typeof pulseData?.queueDepth === 'number'
          ? { depth: pulseData.queueDepth }
          : null
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [password]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // `green` is `attested`: a low error rate is a measured fact about the
  // provider, not something the reader can act on. DependencyHealth, directly
  // above this on the same tab, already paints the same meaning green.
  const StatusIndicator = ({
    status,
  }: {
    status: 'green' | 'yellow' | 'red';
  }) => {
    const icons = {
      green: <span className="w-2 h-2 rounded-full bg-attested" />,
      yellow: <span className="w-2 h-2 rounded-full bg-caution" />,
      red: <span className="w-2 h-2 rounded-full bg-destructive" />,
    };
    return icons[status];
  };

  const getStatus = (errorRate: number): 'green' | 'yellow' | 'red' => {
    if (errorRate < 1) return 'green';
    if (errorRate < 5) return 'yellow';
    return 'red';
  };

  if (loading && apiStats.length === 0) {
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
      {/* An h3: the Health tab's h2 sits above this in page.tsx, over both
          this and DependencyHealth, so this is a subsection of it. */}
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">System health</h3>
        <RefreshButton onClick={fetchData} loading={loading} />
      </div>

      {/* API Performance */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">API performance (24h)</CardTitle>
        </CardHeader>
        <CardContent>
          {apiStats.length === 0 ? (
            <Empty>No API metrics available yet</Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Provider</TableHead>
                  <TableHead className="text-right">Avg latency</TableHead>
                  <TableHead className="text-right">P99</TableHead>
                  <TableHead className="text-right">Error rate</TableHead>
                  <TableHead className="text-right">Total calls</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {apiStats.map((stat) => (
                  <TableRow key={stat.provider}>
                    <TableCell className="font-medium capitalize">
                      {stat.provider}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {stat.avgLatency}ms
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {stat.p99Latency}ms
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      <span
                        className={
                          stat.errorRate < 1
                            ? 'text-attested'
                            : stat.errorRate < 5
                              ? 'text-caution'
                              : 'text-destructive'
                        }
                      >
                        {stat.errorRate.toFixed(1)}%
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {stat.totalCalls.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex justify-center">
                        <StatusIndicator status={getStatus(stat.errorRate)} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Queue Health */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Queue health</CardTitle>
        </CardHeader>
        <CardContent>
          {/* The figure is the sum the endpoint gives, labelled as the sum.
              The half it does not give says so in muted, the way
              DependencyHealth reports a job it could not check, rather than
              printing a zero an admin would read as measured. */}
          <div className="grid grid-cols-2 gap-4">
            {queue ? (
              <Stat label="Queue depth" value={queue.depth} />
            ) : (
              <Stat
                label="Queue depth"
                value={
                  <span
                    className="text-sm font-normal tracking-[var(--tracking-body)] text-muted-foreground"
                    title="The pulse response did not include a queue depth, so this says nothing about the queue"
                  >
                    could not check
                  </span>
                }
              />
            )}
            <Stat
              label="Processing"
              value={
                <span
                  className="text-sm font-normal tracking-[var(--tracking-body)] text-muted-foreground"
                  title="The pulse endpoint reports pending and processing as one sum, so how many are running right now is not known here"
                >
                  could not check
                </span>
              }
            />
          </div>
          <p className="text-xs text-muted-foreground mt-4">
            Queue depth is pending plus processing. Under 10 is normal.
          </p>
        </CardContent>
      </Card>

      {/* Recent Errors */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-caution" />
            Recent errors
          </CardTitle>
        </CardHeader>
        <CardContent>
          {errors.length === 0 ? (
            <Empty>No recent errors: all systems operational</Empty>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {/* A record of an error, not an error banner: each row is a
                  quiet muted tile with one hairline, and only the message is
                  red. The faded `/10` border it had was the drift the design
                  language bans, passing CI only because the guard does not
                  list `destructive`. */}
              {errors.map((err) => (
                <div
                  key={err.id}
                  className="p-3 rounded-lg border border-border bg-muted"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium capitalize">
                      {err.provider}
                    </span>
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                      {new Date(err.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-sm text-destructive">{err.errorMessage}</p>
                  {err.jobId && (
                    <p className="font-mono text-xs text-muted-foreground mt-1">
                      Job: {shortId(err.jobId)}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
