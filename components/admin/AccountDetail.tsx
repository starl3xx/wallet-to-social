'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ArrowLeft } from '@phosphor-icons/react';
import { Banner } from './Banner';
import { Stat } from './Stat';
import { Meter } from './Meter';
import { Empty, Loading } from './PaneState';

interface AccountData {
  account: {
    id: string;
    email: string;
    tier: string;
    stripe_customer_id: string | null;
    stripe_payment_id: string | null;
    paid_at: string | null;
    created_at: string;
    wallets_used: number;
    isWhitelisted: boolean;
  };
  gifted: boolean;
  netCents: number;
  credits: {
    available: number;
    onFreeAllowance: boolean;
    freeUsedThisWindow: number;
    freeWindowResetsAt: string | null;
    lots: Array<{ pack: string; remaining: number; expiresAt: string }>;
  };
  payments: Array<{
    id: string;
    amountCents: number;
    refundedCents: number;
    netCents: number;
    created: string;
    fullyRefunded: boolean;
  }>;
  volume: {
    lifetimeWallets: number;
    peakDayWallets: number;
    activeDays: number;
    daily: Array<{ day: string; jobs: number; wallets: number }>;
  };
  savedLookups: { n: number; wallets: number };
  apiKeys: { active: number; total: number };
  recentJobs: Array<{
    created_at: string;
    status: string;
    wallets: number;
    source: string | null;
    chain: string | null;
    contract_name: string | null;
    scan_depth: string | null;
  }>;
}

const n = (v: number) => v.toLocaleString();
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** One account, everything about it, in one place. */
export function AccountDetail({
  email,
  password,
  onBack,
}: {
  email: string;
  password: string;
  onBack: () => void;
}) {
  const [data, setData] = useState<AccountData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/account?email=${encodeURIComponent(email)}`,
        {
          headers: { 'x-admin-password': password },
        }
      );
      const body = await res.json();
      if (!res.ok)
        throw new Error(body?.error || `Request failed: ${res.status}`);
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load account');
    } finally {
      setLoading(false);
    }
  }, [email, password]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const back = (
    <Button variant="outline" size="sm" onClick={onBack}>
      <ArrowLeft className="h-4 w-4" aria-hidden />
      Back
    </Button>
  );

  if (loading) {
    return (
      <div className="space-y-4">
        {back}
        <Loading />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-4">
        {back}
        <Banner tone="error">{error ?? 'No data'}</Banner>
      </div>
    );
  }

  const { account, volume } = data;
  const maxDay = Math.max(1, ...volume.daily.map((d) => d.wallets));

  const stat = (label: string, value: string, note?: string) => (
    <Stat label={label} value={value} note={note} />
  );

  return (
    <div className="space-y-6">
      {/* The email is the pane heading, at the pane tier. `break-all`, so a
          long address wraps inside the shell instead of pushing past it. */}
      <div className="flex flex-wrap items-center gap-3">
        {back}
        <h2 className="min-w-0 break-all text-2xl font-light tracking-[var(--tracking-title)]">
          {account.email}
        </h2>
        {/* `tier` is a legacy entitlement. Every pack buyer is 'free' here, so
            the word is labelled, or a paying customer reads as a comp. */}
        <Badge tone={account.tier === 'free' ? 'muted' : 'brand'}>
          {account.tier === 'free'
            ? 'no legacy tier'
            : `legacy ${account.tier}`}
        </Badge>
        {account.isWhitelisted && <Badge tone="attested">whitelisted</Badge>}
        {/* Named plainly. An entitlement with no payment behind it reads as
            revenue everywhere it is not called what it is. */}
        {data.gifted && <Badge tone="caution">gifted, not paid</Badge>}
      </div>

      {/* `Card` is `py-6` and `CardContent` `px-6`: that is the `p-6` card
          padding, and adding `p-6` here on top doubled it vertically. */}
      <Card>
        <CardContent className="grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
          {stat(
            'Net paid',
            money(data.netCents),
            `${data.payments.length} settled payment(s)`
          )}
          {/* A legacy tier and the whitelist are never metered, so a balance
              of zero there is not a fact about the account. */}
          {account.tier !== 'free' || account.isWhitelisted
            ? stat(
                'Matches left',
                'unmetered',
                account.isWhitelisted ? 'whitelisted' : 'legacy tier'
              )
            : stat(
                'Matches left',
                n(data.credits.available),
                data.credits.onFreeAllowance
                  ? `free allowance, ${n(data.credits.freeUsedThisWindow)} used this window`
                  : `${data.credits.lots.length} live lot(s)`
              )}
          {stat('Lifetime wallets', n(volume.lifetimeWallets))}
          {stat(
            'Busiest day',
            n(volume.peakDayWallets),
            'a daily ceiling would have to clear this'
          )}
          {stat(
            'Active days',
            n(volume.activeDays),
            `${n(data.savedLookups.n)} saved lookups`
          )}
        </CardContent>
      </Card>

      {data.credits.lots.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Credit lots</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pack</TableHead>
                  <TableHead className="text-right">Matches left</TableHead>
                  <TableHead>Expires</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.credits.lots.map((l, i) => (
                  <TableRow key={`${l.expiresAt}-${i}`}>
                    <TableCell className="text-sm">{l.pack}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {n(l.remaining)}
                    </TableCell>
                    <TableCell className="font-mono text-xs tabular-nums text-muted-foreground">
                      {l.expiresAt.slice(0, 10)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {data.payments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Payments</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead className="text-right">Charged</TableHead>
                  <TableHead className="text-right">Refunded</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.payments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs tabular-nums text-muted-foreground">
                      {p.created.slice(0, 10)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(p.amountCents)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {p.refundedCents > 0 ? money(p.refundedCents) : '-'}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {money(p.netCents)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Wallets per day</CardTitle>
        </CardHeader>
        {/* `space-y-2`: the rows were 6px apart, which is not one of the nine
            spacing steps; 8px is the nearest. */}
        <CardContent className="space-y-2">
          {volume.daily.length === 0 && <Empty>No lookups yet.</Empty>}
          {volume.daily.map((d) => (
            <div key={d.day} className="flex items-center gap-3">
              <span className="w-24 flex-none font-mono text-xs text-muted-foreground">
                {d.day}
              </span>
              <Meter bar className="flex-1" value={d.wallets / maxDay} />
              <span className="w-20 flex-none text-right text-sm font-medium tabular-nums">
                {n(d.wallets)}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent lookups</CardTitle>
        </CardHeader>
        <CardContent>
          {data.recentJobs.length === 0 ? (
            <Empty>No lookups yet.</Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead className="text-right">Wallets</TableHead>
                  <TableHead>How</TableHead>
                  <TableHead>Depth</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.recentJobs.map((j, i) => (
                  <TableRow key={`${j.created_at}-${i}`}>
                    <TableCell className="font-mono text-xs tabular-nums text-muted-foreground">
                      {j.created_at}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {n(j.wallets)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {j.source === 'contract_import'
                        ? `contract${j.chain ? ` · ${j.chain}` : ''}${j.contract_name ? ` · ${j.contract_name}` : ''}`
                        : (j.source ?? 'unknown')}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {j.scan_depth}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {j.status}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
