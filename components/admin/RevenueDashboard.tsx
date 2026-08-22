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
  CurrencyDollar as DollarSign,
  CaretRight as ChevronRight,
} from '@phosphor-icons/react';
import { PACKS, isPackId } from '@/lib/packs';

interface FunnelData {
  pageViews: number;
  csvUploads: number;
  lookupsStarted: number;
  lookupsCompleted: number;
  upgradeModalViewed: number;
  checkoutStarted: number;
  paymentCompleted: number;
}

interface Totals {
  grossCents: number;
  refundedCents: number;
  netCents: number;
  count: number;
}

interface Payment {
  id: string;
  email: string | null;
  /** Legacy tier sale. Null for every pack. */
  tier: string | null;
  /** Pack id for a credit sale. Null for the two legacy tier sales. */
  pack?: string | null;
  amountCents: number;
  refundedCents: number;
  netCents: number;
  created: string;
  fullyRefunded: boolean;
}

interface RevenueData {
  configured: boolean;
  allTime: Totals;
  thisMonth: Totals;
  /** Legacy tier conversions only. Packs carry no tier, so they are not in here. */
  byTier: Record<string, number>;
  /** Conversions keyed on pack id or legacy tier, refunds excluded. */
  byProduct?: Record<string, number>;
  /** Lowercased email → highest tier actually purchased, across all payments. */
  paidTierByEmail: Record<string, string>;
  payments: Payment[];
  truncated: boolean;
}

interface UserEntry {
  id: string;
  email: string;
  tier: string;
  stripeCustomerId: string | null;
  paidAt: string | null;
  createdAt: string;
}

interface RevenueDashboardProps {
  password: string;
}

/** Ladder order, so a held legacy tier can be compared against a purchased one. */
const TIER_RANK: Record<string, number> = { free: 0, pro: 1, unlimited: 2 };

/** What a payment bought, by name: the pack when it is one, else the legacy tier. */
const productName = (p: Pick<Payment, 'pack' | 'tier'>) => {
  if (p.pack) return isPackId(p.pack) ? PACKS[p.pack].name : p.pack;
  return p.tier ?? 'unknown';
};

const money = (cents: number) =>
  (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });

export function RevenueDashboard({ password }: RevenueDashboardProps) {
  const [funnel, setFunnel] = useState<FunnelData | null>(null);
  const [revenue, setRevenue] = useState<RevenueData | null>(null);
  const [paidUsers, setPaidUsers] = useState<UserEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const headers = { 'x-admin-password': password };
      const [funnelRes, revenueRes, usersRes] = await Promise.all([
        fetch('/api/admin/analytics/funnel?days=30', { headers }),
        fetch('/api/admin/revenue', { headers }),
        fetch('/api/admin/users', { headers }),
      ]);

      if (!funnelRes.ok || !revenueRes.ok || !usersRes.ok) {
        throw new Error('Failed to fetch revenue data');
      }

      const [funnelData, revenueData, usersData] = await Promise.all([
        funnelRes.json(),
        revenueRes.json(),
        usersRes.json(),
      ]);

      setFunnel(funnelData);
      setRevenue(revenueData);
      setPaidUsers(usersData.users.filter((u: UserEntry) => u.tier !== 'free'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [password]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  /**
   * Entitlement nobody paid for.
   *
   * Two shapes, and the second is the one that catches goodwill: an account with
   * no surviving payment at all (whitelist, manual grant), and an account
   * holding a tier *above* the highest tier it actually bought. On 2026-08-15
   * the customer genuinely paid for Pro and was then moved to Unlimited as an
   * apology, so an email-only check would have called them a paying Unlimited
   * customer and quietly implied $249 of income again.
   *
   * These cost real API spend and belong on this screen. They are not revenue.
   */
  // Comes from the API, computed over every payment. Deriving it from
  // `revenue.payments` would be wrong: that list is the 25 most recent, so any
  // customer whose purchase has scrolled past the cut-off would be reported as
  // complimentary.
  // Typed with `| undefined` deliberately: a bare Record<string, string> index
  // is typed as always returning a string, which would quietly make the
  // "never paid" branch below unreachable to the type checker.
  const highestPaidTierByEmail: Record<string, string | undefined> =
    revenue?.paidTierByEmail ?? {};

  const compedUsers = paidUsers
    .map((u) => {
      const paidFor = highestPaidTierByEmail[u.email.toLowerCase()] ?? null;
      const gifted =
        !paidFor || (TIER_RANK[u.tier] ?? 0) > (TIER_RANK[paidFor] ?? 0);
      return gifted ? { ...u, paidFor } : null;
    })
    .filter((u): u is UserEntry & { paidFor: string | null } => u !== null);

  const conversionRate =
    funnel && funnel.upgradeModalViewed > 0
      ? (funnel.paymentCompleted / funnel.upgradeModalViewed) * 100
      : 0;

  /**
   * Conversions by product, named. `byProduct` is keyed on the pack id (or a
   * legacy tier), so each pack can be counted rather than inferred as the
   * remainder after the legacy tiers, which was the previous approach and could
   * not say which pack sold.
   */
  const byProduct = Object.entries(revenue?.byProduct ?? {})
    .sort(([, a], [, b]) => b - a)
    .map(([product, n]) =>
      isPackId(product)
        ? `${n} ${PACKS[product].name}`
        : product === 'pro' || product === 'unlimited'
          ? `${n} legacy ${product}`
          : `${n} ${product}`
    );

  if (loading && !funnel) {
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

  const allTime = revenue?.allTime;
  const thisMonth = revenue?.thisMonth;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Revenue dashboard</h2>
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

      {revenue && !revenue.configured && (
        <p className="text-sm text-caution">
          Stripe is not configured, so revenue cannot be read. Figures below are
          zero, not empty.
        </p>
      )}

      {/* Every figure here is net of refunds and read from Stripe. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <DollarSign className="h-3 w-3" />
              <span>Net revenue, all time</span>
            </div>
            <div className="text-2xl font-bold tabular-nums">
              {money(allTime?.netCents ?? 0)}
            </div>
            {!!allTime?.refundedCents && (
              <div className="text-xs text-muted-foreground tabular-nums">
                {money(allTime.grossCents)} gross,{' '}
                {money(allTime.refundedCents)} refunded
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs text-muted-foreground mb-1">
              Net this month
            </div>
            <div className="text-2xl font-bold tabular-nums">
              {money(thisMonth?.netCents ?? 0)}
            </div>
            {!!thisMonth?.refundedCents && (
              <div className="text-xs text-muted-foreground tabular-nums">
                {money(thisMonth.refundedCents)} refunded
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs text-muted-foreground mb-1">
              Paid conversions
            </div>
            <div className="text-2xl font-bold tabular-nums">
              {allTime?.count ?? 0}
            </div>
            <div className="text-xs text-muted-foreground">
              {byProduct.join(' · ') || 'none yet'}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs text-muted-foreground mb-1">
              Complimentary
            </div>
            <div className="text-2xl font-bold tabular-nums">
              {compedUsers.length}
            </div>
            <div className="text-xs text-muted-foreground">
              access beyond what was paid for
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Conversion Funnel */}
      {funnel && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Conversion funnel (30 days)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-2 text-center">
              <div className="flex-1">
                <div className="text-xs text-muted-foreground">Lookups</div>
                <div className="text-lg font-bold tabular-nums">
                  {funnel.lookupsStarted}
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
              <div className="flex-1">
                <div className="text-xs text-muted-foreground">Saw pricing</div>
                <div className="text-lg font-bold tabular-nums">
                  {funnel.upgradeModalViewed}
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
              <div className="flex-1">
                <div className="text-xs text-muted-foreground">
                  Started checkout
                </div>
                <div className="text-lg font-bold tabular-nums">
                  {funnel.checkoutStarted}
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
              <div className="flex-1">
                <div className="text-xs text-muted-foreground">Completed</div>
                {/* A completed payment is a real outcome, so it is green. */}
                <div className="text-lg font-bold tabular-nums text-attested">
                  {funnel.paymentCompleted}
                </div>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t text-center">
              <span className="text-sm text-muted-foreground">
                Modal → Payment conversion rate:{' '}
                <span className="font-bold text-foreground tabular-nums">
                  {conversionRate.toFixed(1)}%
                </span>
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Actual payments, straight from Stripe. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payments</CardTitle>
        </CardHeader>
        <CardContent>
          {!revenue?.payments.length ? (
            <p className="text-center text-muted-foreground py-4">
              No payments yet
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Net</TableHead>
                    <TableHead>Payment</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {revenue.payments.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>{p.email ?? '-'}</TableCell>
                      <TableCell>
                        <span className="px-2 py-1 rounded-sm text-xs font-medium bg-accent-brand-tint text-accent-brand">
                          {productName(p)}
                        </span>
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {p.fullyRefunded ? (
                          <span className="text-muted-foreground line-through">
                            {money(p.amountCents)}
                          </span>
                        ) : (
                          money(p.netCents)
                        )}
                        {p.fullyRefunded && (
                          <span className="ml-2 text-xs text-caution">
                            refunded
                          </span>
                        )}
                        {!p.fullyRefunded && p.refundedCents > 0 && (
                          <span className="ml-2 text-xs text-caution">
                            {money(p.refundedCents)} back
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {p.id.slice(0, 14)}…
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {new Date(p.created).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {revenue.truncated && (
                <p className="mt-3 text-xs text-caution">
                  Older payments exist beyond the fetch limit and are not
                  counted above.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Comps: real access, zero revenue. Listed so the gap between "paid
          conversions" and "accounts on a legacy tier" is always explainable.
          Only legacy tiers are checked here; a hand-issued credit lot shows
          on the account drill-down instead. */}
      {compedUsers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Complimentary accounts</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Holds</TableHead>
                    <TableHead>Paid for</TableHead>
                    <TableHead>Since</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {compedUsers.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell>{u.email}</TableCell>
                      <TableCell>
                        <span className="px-2 py-1 rounded-sm text-xs font-medium bg-muted text-muted-foreground">
                          {u.tier}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {u.paidFor ?? 'nothing'}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {new Date(u.paidAt || u.createdAt).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
