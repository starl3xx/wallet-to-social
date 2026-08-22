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
import { Banner } from './Banner';
import { Stat } from './Stat';
import { Meter } from './Meter';
import { RefreshButton } from './RefreshButton';
import { Empty, Loading } from './PaneState';

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
    return <Loading />;
  }

  if (error) {
    return <Banner tone="error">{error}</Banner>;
  }

  if (!data) return null;

  const maxWallets = Math.max(1, ...data.daily.map((d) => d.wallets));

  // Spend against the plan limit. The figure goes red once the limit is
  // passed; the bar turns caution at three quarters, before it is.
  const provider = (p: ProviderRow) => {
    const pct = p.limit > 0 ? p.spent / p.limit : 0;
    const over = p.spent > p.limit;
    return (
      <Stat
        label={p.label}
        value={
          <>
            {n(p.spent)}
            <span className="ml-2 text-sm font-normal tracking-[var(--tracking-body)] text-muted-foreground">
              of {n(p.limit)}
            </span>
          </>
        }
        valueClassName={over ? 'text-destructive' : undefined}
        note={
          <div className="space-y-2">
            <Meter
              value={pct}
              tone={over ? 'destructive' : pct > 0.75 ? 'caution' : 'brand'}
            />
            <p>
              {over
                ? `Over the plan limit. Background work stopped at ${n(p.backgroundCeiling)}.`
                : `Background work stops at ${n(p.backgroundCeiling)}; the rest is held for customers.`}
            </p>
          </div>
        }
      />
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-light tracking-[var(--tracking-title)]">
            Usage
          </h2>
          <p className="text-sm text-muted-foreground">
            Measuring only. No plan carries a daily allowance, and nothing here
            creates one.
          </p>
        </div>
        <RefreshButton onClick={fetchData} loading={loading} />
      </div>

      {/* `Card` is `py-6` and `CardContent` `px-6`: that is the `p-6` card
          padding, and adding `p-6` here on top doubled it vertically. */}
      <Card>
        <CardContent className="grid gap-6 sm:grid-cols-2">
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
          {data.peaks.length === 0 ? (
            <Empty>No signed-in lookups yet.</Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead className="text-right">Peak day</TableHead>
                  <TableHead>On</TableHead>
                  <TableHead className="text-right">Lifetime</TableHead>
                  <TableHead className="text-right">Active days</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.peaks.map((p, i) => (
                  <TableRow key={`${p.email ?? 'anon'}-${i}`}>
                    <TableCell className="max-w-[18rem] truncate">
                      {p.email && onAccountClick ? (
                        <Button
                          variant="link"
                          size="inline"
                          className="max-w-full truncate"
                          onClick={() => onAccountClick(p.email!)}
                        >
                          {p.email}
                        </Button>
                      ) : (
                        (p.email ?? 'anonymous')
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {p.tier ?? 'free'}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {n(p.peak_wallets)}
                    </TableCell>
                    <TableCell className="font-mono text-xs tabular-nums text-muted-foreground">
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
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Wallets per day, last 30 days
          </CardTitle>
        </CardHeader>
        {/* `space-y-2`: the rows were 6px apart, which is not one of the nine
            spacing steps; 8px is the nearest. */}
        <CardContent className="space-y-2">
          {data.daily.length === 0 && (
            <Empty>No lookups in the last 30 days.</Empty>
          )}
          {data.daily.map((d) => (
            <div key={d.day} className="flex items-center gap-3">
              <span className="w-24 flex-none font-mono text-xs text-muted-foreground">
                {d.day}
              </span>
              <Meter bar className="flex-1" value={d.wallets / maxWallets} />
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
