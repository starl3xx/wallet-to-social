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
import { ArrowsClockwise as RefreshCw } from '@phosphor-icons/react';
import { PACKS, isPackId } from '@/lib/packs';
import { StatTile } from './Stat';
import { RefreshButton } from './RefreshButton';
import { Empty, Loading } from './PaneState';

/**
 * Money, and nothing else.
 *
 * There was a conversion funnel on this pane, over 30 days, dividing payments
 * by pricing views. The behaviour pane drew a second one over 7 days dividing
 * every step by page views, four steps appeared on both with different numbers,
 * and the Pulse tile labelled "Conversion rate" linked here while showing the
 * other definition. All of it now lives on the Funnel tab, over one window the
 * reader chooses, with the two rates named rather than both called conversion.
 *
 * What is left here is the only thing this pane was ever the authority on:
 * what Stripe actually took, net of refunds. That is deliberately a different
 * number from the booked revenue on Pulse and Growth, which sums
 * `daily_stats.revenue_cents` and knows nothing about a refund. Each surface
 * says which it is.
 */
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
  const [revenue, setRevenue] = useState<RevenueData | null>(null);
  const [paidUsers, setPaidUsers] = useState<UserEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const headers = { 'x-admin-password': password };
      const [revenueRes, usersRes] = await Promise.all([
        fetch('/api/admin/revenue', { headers }),
        fetch('/api/admin/users', { headers }),
      ]);

      if (!revenueRes.ok || !usersRes.ok) {
        throw new Error('Failed to fetch revenue data');
      }

      const [revenueData, usersData] = await Promise.all([
        revenueRes.json(),
        usersRes.json(),
      ]);

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

  if (loading && !revenue) {
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

  const allTime = revenue?.allTime;
  const thisMonth = revenue?.thisMonth;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-light tracking-[var(--tracking-title)]">
          Revenue dashboard
        </h2>
        <RefreshButton onClick={fetchData} loading={loading} />
      </div>

      {revenue && !revenue.configured && (
        <p className="text-sm text-caution">
          Stripe is not configured, so revenue cannot be read. Figures below are
          zero, not empty.
        </p>
      )}

      {/* Every figure here is net of refunds and read from Stripe. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatTile
          label="Net revenue, all time"
          value={money(allTime?.netCents ?? 0)}
          note={
            !!allTime?.refundedCents && (
              <span className="tabular-nums">
                {money(allTime.grossCents)} gross,{' '}
                {money(allTime.refundedCents)} refunded
              </span>
            )
          }
        />
        <StatTile
          label="Net this month"
          value={money(thisMonth?.netCents ?? 0)}
          note={
            !!thisMonth?.refundedCents && (
              <span className="tabular-nums">
                {money(thisMonth.refundedCents)} refunded
              </span>
            )
          }
        />
        <StatTile
          label="Paid conversions"
          value={allTime?.count ?? 0}
          note={byProduct.join(' · ') || 'none yet'}
        />
        <StatTile
          label="Complimentary"
          value={compedUsers.length}
          note="access beyond what was paid for"
        />
      </div>

      {/* Actual payments, straight from Stripe. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payments</CardTitle>
        </CardHeader>
        <CardContent>
          {!revenue?.payments.length ? (
            <Empty>No payments yet</Empty>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                    <TableHead>Payment</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {revenue.payments.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>{p.email ?? '-'}</TableCell>
                      {/* Brand tone: the product is ours, neither good nor
                          bad. A purchase outcome would be green; the name of
                          what was bought is not an outcome. */}
                      <TableCell>
                        <Badge tone="brand">{productName(p)}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
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
                      <TableCell className="font-mono text-xs tabular-nums text-muted-foreground">
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
            </>
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
                      <Badge tone="muted">{u.tier}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {u.paidFor ?? 'nothing'}
                    </TableCell>
                    <TableCell className="font-mono text-xs tabular-nums text-muted-foreground">
                      {new Date(u.paidAt || u.createdAt).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
