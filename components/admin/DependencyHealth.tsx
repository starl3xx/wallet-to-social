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
import { CheckCircle, WarningCircle, XCircle } from '@phosphor-icons/react';
import { Banner } from './Banner';
import { RefreshButton } from './RefreshButton';
import { Loading } from './PaneState';

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
  lastRun: string | null;
  lastSuccess: string | null;
  hoursAgo: number | null;
  status: 'ok' | 'late' | 'failing' | 'never' | 'unknown';
}

interface Payload {
  dependencies: Dependency[];
  jobs: Job[];
  unscheduled: Array<{ name: string; how: string; why: string }>;
  summary: {
    missingCritical: number;
    missingDegraded: number;
    jobsUnhealthy: number;
    /** null when the query never resolved. Not the same as false. */
    databaseReachable: boolean | null;
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
    return <Banner tone="error">{error}</Banner>;
  }
  if (!data) {
    return <Loading />;
  }

  const { summary } = data;
  const allWell =
    summary.missingCritical === 0 &&
    summary.jobsUnhealthy === 0 &&
    summary.databaseReachable === true;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          {/* The icon beside the title is a status, not decoration: green
              when nothing is missing and every job has run, red otherwise.
              At the UI size, `h-4 w-4`, like every other icon beside text. */}
          <CardTitle className="text-base flex items-center gap-2">
            {allWell ? (
              <CheckCircle
                weight="fill"
                className="h-4 w-4 text-attested"
                aria-hidden
              />
            ) : (
              <WarningCircle
                weight="fill"
                className="h-4 w-4 text-destructive"
                aria-hidden
              />
            )}
            Dependencies and scheduled work
          </CardTitle>
          <RefreshButton onClick={fetchData} loading={loading} />
        </CardHeader>
        <CardContent className="space-y-6">
          {data.summary.databaseReachable === false && (
            <Banner tone="error">
              Job history could not be read, so every row below says “could not
              check” rather than accusing a job of not running. The dependency
              list above is unaffected: it needs no database.
            </Banner>
          )}
          <p className="text-sm text-muted-foreground">
            Read locally: an environment variable’s presence, and a timestamp
            already in the database. No request leaves the server, so nothing
            here can be slow or cost anything, and a provider being down cannot
            stop this page loading.
          </p>

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
                      <span className="inline-flex items-center gap-2 text-attested text-sm">
                        <CheckCircle
                          className="h-4 w-4"
                          weight="fill"
                          aria-hidden
                        />{' '}
                        set
                      </span>
                    ) : (
                      <span
                        className={`inline-flex items-center gap-2 text-sm ${
                          d.severity === 'critical'
                            ? 'text-destructive'
                            : 'text-muted-foreground'
                        }`}
                      >
                        <XCircle
                          className="h-4 w-4"
                          weight="fill"
                          aria-hidden
                        />
                        {d.severity === 'critical' ? 'missing' : 'not set'}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {d.impact}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

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
                  <TableCell className="text-sm text-muted-foreground">
                    {j.schedule}
                  </TableCell>
                  <TableCell className="text-sm tabular-nums">
                    {j.status === 'unknown' ? (
                      <span
                        className="text-muted-foreground"
                        title="The query for job history did not complete, so this says nothing about the job"
                      >
                        could not check
                      </span>
                    ) : j.status === 'never' ? (
                      <span className="text-destructive">never recorded</span>
                    ) : j.status === 'failing' ? (
                      <span
                        className="text-destructive"
                        title="The job ran and reported that it failed. Running is not succeeding."
                      >
                        ran, reported failure
                      </span>
                    ) : (
                      <span
                        className={
                          j.status === 'late' ? 'text-destructive' : undefined
                        }
                      >
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

          {/* The one inset surface: `bg-muted` at full opacity, `p-4`. It
              was a `/40` wash, which is a second surface by another name. */}
          {data.unscheduled.length > 0 && (
            <div className="rounded-lg border border-border bg-muted p-4 space-y-3">
              <h3 className="text-sm font-medium">
                Real work that runs on no schedule
              </h3>
              <p className="text-sm text-muted-foreground">
                Listed rather than omitted. A job with no cron produces no
                failures, which is exactly how the docs came to claim a daily
                cadence for one of these.
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
