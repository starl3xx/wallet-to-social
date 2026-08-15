'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Eyebrow } from '@/components/ui/eyebrow';
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
  Warning as AlertTriangle,
} from '@phosphor-icons/react';

interface DailyRow {
  day: string;
  jobs: number;
  wallets: number;
  accounts: number;
}

interface PeakRow {
  email: string | null;
  tier: string | null;
  busiest_day: string | null;
  peak_wallets: number;
  total_wallets: number;
  active_days: number;
}

interface ProviderRow {
  label: string;
  spent: number;
  limit: number;
  backgroundCeiling: number;
}

interface UsageData {
  enforcing: boolean;
  daily: DailyRow[];
  peaks: PeakRow[];
  allTimePeak: { peak_day: string | null; peak_wallets: number };
  providers: { social: ProviderRow; holderIndex: ProviderRow };
}

const n = (v: number) => v.toLocaleString();

/**
 * Daily wallet volume per account, and the provider spend it drives.
 *
 * Nothing here enforces anything. It exists so a decision about a daily
 * allowance can be made from the peaks accounts actually reach, rather than
 * from a number that felt about right.
 */
export function UsageMeter({
  password,
  onAccountClick,
}: {
  password: string;
  /** Open one account in full. Optional, so the pane still renders alone. */
  onAccountClick?: (email: string) => void;
}) {
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/usage', {
        headers: { 'x-admin-password': password },
      });
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load usage');
    } finally {
      setLoading(false);
    }
  }, [password]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-destructive bg-destructive/10 p-4">
        <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-destructive" aria-hidden />
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  if (!data) return null;

  const maxWallets = Math.max(1, ...data.daily.map((d) => d.wallets));

  const provider = (p: ProviderRow) => {
    const pct = p.limit > 0 ? (p.spent / p.limit) * 100 : 0;
    const over = p.spent > p.limit;
    return (
      <div className="space-y-1.5">
        <Eyebrow>{p.label}</Eyebrow>
        <p className={`text-2xl font-semibold tabular-nums ${over ? 'text-destructive' : ''}`}>
          {n(p.spent)}
          <span className="ml-1.5 text-sm font-normal text-muted-foreground">
            of {n(p.limit)}
          </span>
        </p>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full ${over ? 'bg-destructive' : pct > 75 ? 'bg-caution' : 'bg-accent-brand'}`}
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {over
            ? `Over the plan limit. Background work stopped at ${n(p.backgroundCeiling)}.`
            : `Background work stops at ${n(p.backgroundCeiling)}; the rest is held for customers.`}
        </p>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Usage</h2>
          <p className="text-sm text-muted-foreground">
            Measuring only. No plan carries a daily allowance, and nothing here
            creates one.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" aria-hidden />
          )}
          Refresh
        </Button>
      </div>

      <Card>
        <CardContent className="grid gap-6 p-6 sm:grid-cols-2">
          {provider(data.providers.social)}
          {provider(data.providers.holderIndex)}
        </CardContent>
      </Card>

      {/* The peak is the number a ceiling has to clear. An average is no use:
          a cap is only ever met on a busy day, and one set below an account's
          observed peak has already refused a real customer once. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Busiest day per account</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground">
            Busiest single day across the whole history. A daily ceiling has to
            sit above every figure in this column, or it would have refused
            somebody already. The busiest day the product has ever had was{' '}
            <span className="font-medium text-foreground tabular-nums">
              {n(data.allTimePeak.peak_wallets)}
            </span>{' '}
            wallets, on {data.allTimePeak.peak_day ?? 'an unknown day'}.
          </p>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead className="text-right">Peak day</TableHead>
                  <TableHead>On</TableHead>
                  <TableHead className="text-right">Lifetime</TableHead>
                  <TableHead className="text-right">Active days</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.peaks.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-sm text-muted-foreground">
                      No signed-in lookups yet.
                    </TableCell>
                  </TableRow>
                )}
                {data.peaks.map((p, i) => (
                  <TableRow key={`${p.email ?? 'anon'}-${i}`}>
                    <TableCell className="max-w-[18rem] truncate font-mono text-xs">
                      {p.email && onAccountClick ? (
                        <Button
                          variant="link"
                          size="inline"
                          className="max-w-full truncate font-mono text-xs"
                          onClick={() => onAccountClick(p.email!)}
                        >
                          {p.email}
                        </Button>
                      ) : (
                        (p.email ?? 'anonymous')
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{p.tier ?? 'free'}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {n(p.peak_wallets)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {p.busiest_day}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {n(p.total_wallets)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {p.active_days}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Wallets per day, last 30 days</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {data.daily.length === 0 && (
            <p className="text-sm text-muted-foreground">No lookups in the last 30 days.</p>
          )}
          {data.daily.map((d) => (
            <div key={d.day} className="flex items-center gap-3">
              <span className="w-24 flex-none font-mono text-xs text-muted-foreground">
                {d.day}
              </span>
              <div className="h-4 min-w-0 flex-1 overflow-hidden rounded-sm bg-muted">
                <div
                  className="h-full rounded-sm bg-accent-brand"
                  style={{ width: `${(d.wallets / maxWallets) * 100}%` }}
                />
              </div>
              <span className="w-20 flex-none text-right text-sm font-medium tabular-nums">
                {n(d.wallets)}
              </span>
              <span className="w-28 flex-none text-right text-xs text-muted-foreground tabular-nums">
                {d.jobs} {d.jobs === 1 ? 'lookup' : 'lookups'}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
