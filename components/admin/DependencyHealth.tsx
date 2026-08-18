'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { ArrowsClockwise, CheckCircle, WarningCircle, XCircle } from '@phosphor-icons/react';

/**
 * Whether the machinery behind our claims is actually configured and running.
 *
 * Every other panel here reports what happened. This one reports what is
 * *capable* of happening, which is a different question and the one nothing
 * answered: a cron that does not exist emits no errors, and an unset key makes
 * a degrading path degrade silently, exactly as it was designed to.
 *
 * The unscheduled section is the point of the whole panel. The handle-liveness
 * sweep is real work with no cron, and the docs claimed a daily cadence for it
 * for a week. Naming it here as unscheduled is what stops that recurring.
 */

interface Dependency {
  capability: string;
  vars: string[];
  impact: string;
  configured: boolean;
  severity: 'critical' | 'degrades';
}

interface Job {
  name: string;
  schedule: string;
  lastSuccess: string | null;
  hoursAgo: number | null;
  status: 'ok' | 'late' | 'never';
}

interface Payload {
  dependencies: Dependency[];
  jobs: Job[];
  unscheduled: Array<{ name: string; how: string; why: string }>;
  summary: {
    missingCritical: number;
    missingDegraded: number;
    jobsLate: number;
    databaseReachable: boolean;
  };
}

export function DependencyHealth({ password }: { password: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/health/dependencies', {
        headers: { 'x-admin-password': password },
      });
      if (!res.ok) throw new Error('Failed to load dependency health');
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [password]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>;
  }
  if (!data) {
    return <p className="text-sm text-muted-foreground">Loading dependencies…</p>;
  }

  const { summary } = data;
  const allWell = summary.missingCritical === 0 && summary.jobsLate === 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base flex items-center gap-2">
            {allWell ? (
              <CheckCircle size={18} weight="fill" className="text-attested" aria-hidden />
            ) : (
              <WarningCircle size={18} weight="fill" className="text-destructive" aria-hidden />
            )}
            Dependencies and scheduled work
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={fetchData} disabled={loading}>
            <ArrowsClockwise size={16} aria-hidden />
            <span className="sr-only">Refresh</span>
          </Button>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-sm text-muted-foreground">
            Read locally: an environment variable’s presence, and a timestamp already in the
            database. No request leaves the server, so nothing here can be slow or cost anything,
            and a provider being down cannot stop this page loading.
          </p>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Capability</TableHead>
                  <TableHead>Configured</TableHead>
                  <TableHead>If missing</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.dependencies.map((d) => (
                  <TableRow key={d.capability}>
                    <TableCell className="font-medium">
                      {d.capability}
                      <div className="text-xs text-muted-foreground font-mono">
                        {d.vars.join(', ')}
                      </div>
                    </TableCell>
                    <TableCell>
                      {d.configured ? (
                        <span className="inline-flex items-center gap-1.5 text-attested text-sm">
                          <CheckCircle size={15} weight="fill" aria-hidden /> set
                        </span>
                      ) : (
                        <span
                          className={`inline-flex items-center gap-1.5 text-sm ${
                            d.severity === 'critical' ? 'text-destructive' : 'text-muted-foreground'
                          }`}
                        >
                          <XCircle size={15} weight="fill" aria-hidden />
                          {d.severity === 'critical' ? 'MISSING' : 'not set'}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{d.impact}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Scheduled job</TableHead>
                  <TableHead>Cadence</TableHead>
                  <TableHead>Last success</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.jobs.map((j) => (
                  <TableRow key={j.name}>
                    <TableCell className="font-medium">{j.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{j.schedule}</TableCell>
                    <TableCell className="text-sm tabular-nums">
                      {j.status === 'never' ? (
                        <span className="text-destructive">never recorded</span>
                      ) : (
                        <span className={j.status === 'late' ? 'text-destructive' : undefined}>
                          {j.hoursAgo !== null && j.hoursAgo < 1
                            ? 'under an hour ago'
                            : `${j.hoursAgo}h ago`}
                          {j.status === 'late' ? ' (late)' : ''}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {data.unscheduled.length > 0 && (
            <div className="rounded-lg border border-border bg-muted/40 p-4 space-y-3">
              <h3 className="text-sm font-medium">Real work that runs on no schedule</h3>
              <p className="text-sm text-muted-foreground">
                Listed rather than omitted. A job with no cron produces no failures, which is
                exactly how the docs came to claim a daily cadence for one of these.
              </p>
              {data.unscheduled.map((u) => (
                <div key={u.name} className="text-sm">
                  <span className="font-medium">{u.name}</span>
                  <span className="text-muted-foreground"> · {u.how}</span>
                  <div className="text-muted-foreground">{u.why}</div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
