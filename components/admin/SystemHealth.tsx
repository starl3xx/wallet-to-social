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
import { Loader2, RefreshCw, AlertTriangle } from 'lucide-react';

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

interface QueueStats {
  pending: number;
  processing: number;
}

interface SystemHealthProps {
  password: string;
}

export function SystemHealth({ password }: SystemHealthProps) {
  const [apiStats, setApiStats] = useState<ApiStat[]>([]);
  const [errors, setErrors] = useState<ApiError[]>([]);
  const [queue, setQueue] = useState<QueueStats>({ pending: 0, processing: 0 });
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
      setQueue({ pending: 0, processing: 0 }); // Will be enhanced with queue endpoint
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [password]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const StatusIndicator = ({ status }: { status: 'green' | 'yellow' | 'red' }) => {
    const icons = {
      green: <span className="w-2 h-2 rounded-full bg-green-500" />,
      yellow: <span className="w-2 h-2 rounded-full bg-yellow-500" />,
      red: <span className="w-2 h-2 rounded-full bg-red-500" />,
    };
    return icons[status];
  };

  const getStatus = (errorRate: number): 'green' | 'yellow' | 'red' => {
    if (errorRate < 1) return 'green';
    if (errorRate < 5) return 'yellow';
    return 'red';
  };

  if (loading && apiStats.length === 0) {
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
          <RefreshCw className="h-4 w-4 mr-2" />
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">System health</h2>
        <Button variant="ghost" size="sm" onClick={fetchData} disabled={loading}>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* API Performance */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">API performance (24h)</CardTitle>
        </CardHeader>
        <CardContent>
          {apiStats.length === 0 ? (
            <p className="text-center text-muted-foreground py-4">
              No API metrics available yet
            </p>
          ) : (
            <div className="overflow-x-auto">
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
                      <TableCell className="text-right">
                        {stat.avgLatency}ms
                      </TableCell>
                      <TableCell className="text-right">
                        {stat.p99Latency}ms
                      </TableCell>
                      <TableCell className="text-right">
                        <span
                          className={
                            stat.errorRate < 1
                              ? 'text-green-500'
                              : stat.errorRate < 5
                                ? 'text-yellow-500'
                                : 'text-red-500'
                          }
                        >
                          {stat.errorRate.toFixed(1)}%
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
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
            </div>
          )}
        </CardContent>
      </Card>

      {/* Queue Health */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Queue health</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-xs text-muted-foreground mb-1">Pending jobs</div>
              <div className="text-2xl font-bold">{queue.pending}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Processing</div>
              <div className="text-2xl font-bold">{queue.processing}</div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-4">
            Normal queue depth is &lt;10 pending jobs.
          </p>
        </CardContent>
      </Card>

      {/* Recent Errors */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-yellow-500" />
            Recent errors
          </CardTitle>
        </CardHeader>
        <CardContent>
          {errors.length === 0 ? (
            <p className="text-center text-muted-foreground py-4">
              No recent errors - all systems operational
            </p>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {errors.map((err) => (
                <div
                  key={err.id}
                  className="p-3 rounded-lg bg-destructive/5 border border-destructive/10"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium capitalize">{err.provider}</span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(err.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-sm text-destructive">{err.errorMessage}</p>
                  {err.jobId && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Job: {err.jobId.slice(0, 8)}...
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
