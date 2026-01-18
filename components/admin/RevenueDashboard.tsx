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
import { Loader2, RefreshCw, DollarSign, ChevronRight } from 'lucide-react';

interface FunnelData {
  pageViews: number;
  csvUploads: number;
  lookupsStarted: number;
  lookupsCompleted: number;
  upgradeModalViewed: number;
  checkoutStarted: number;
  paymentCompleted: number;
}

interface DailyStat {
  date: string;
  revenueCents: number;
  proPurchases: number;
  unlimitedPurchases: number;
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

export function RevenueDashboard({ password }: RevenueDashboardProps) {
  const [funnel, setFunnel] = useState<FunnelData | null>(null);
  const [dailyStats, setDailyStats] = useState<DailyStat[]>([]);
  const [paidUsers, setPaidUsers] = useState<UserEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [funnelRes, statsRes, usersRes] = await Promise.all([
        fetch('/api/admin/analytics/funnel?days=30', {
          headers: { 'x-admin-password': password },
        }),
        fetch('/api/admin/analytics/aggregate?days=30', {
          headers: { 'x-admin-password': password },
        }),
        fetch('/api/admin/users', {
          headers: { 'x-admin-password': password },
        }),
      ]);

      if (!funnelRes.ok || !statsRes.ok || !usersRes.ok) {
        throw new Error('Failed to fetch revenue data');
      }

      const [funnelData, statsData, usersData] = await Promise.all([
        funnelRes.json(),
        statsRes.json(),
        usersRes.json(),
      ]);

      setFunnel(funnelData);
      setDailyStats(statsData);
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

  // Calculate totals
  const totalRevenue = dailyStats.reduce((sum, s) => sum + s.revenueCents, 0) / 100;
  const proPurchases = dailyStats.reduce((sum, s) => sum + s.proPurchases, 0);
  const unlimitedPurchases = dailyStats.reduce((sum, s) => sum + s.unlimitedPurchases, 0);

  // Get all-time revenue from paid users
  const allTimeRevenue =
    paidUsers.reduce((sum, u) => {
      if (u.tier === 'pro') return sum + 149;
      if (u.tier === 'unlimited') return sum + 420;
      return sum;
    }, 0);

  // Calculate conversion rate
  const conversionRate =
    funnel && funnel.upgradeModalViewed > 0
      ? (funnel.paymentCompleted / funnel.upgradeModalViewed) * 100
      : 0;

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Revenue dashboard</h2>
        <Button variant="ghost" size="sm" onClick={fetchData} disabled={loading}>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Revenue Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <DollarSign className="h-3 w-3" />
              <span>All-time revenue</span>
            </div>
            <div className="text-2xl font-bold">${allTimeRevenue.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs text-muted-foreground mb-1">This month</div>
            <div className="text-2xl font-bold">${totalRevenue.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs text-muted-foreground mb-1">Pro purchases</div>
            <div className="text-2xl font-bold">{paidUsers.filter((u) => u.tier === 'pro').length}</div>
            <div className="text-xs text-muted-foreground">This month: {proPurchases}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="text-xs text-muted-foreground mb-1">Unlimited purchases</div>
            <div className="text-2xl font-bold">
              {paidUsers.filter((u) => u.tier === 'unlimited').length}
            </div>
            <div className="text-xs text-muted-foreground">This month: {unlimitedPurchases}</div>
          </CardContent>
        </Card>
      </div>

      {/* Conversion Funnel */}
      {funnel && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Conversion funnel (30 days)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-2 text-center">
              <div className="flex-1">
                <div className="text-xs text-muted-foreground">Lookups</div>
                <div className="text-lg font-bold">{funnel.lookupsStarted}</div>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
              <div className="flex-1">
                <div className="text-xs text-muted-foreground">Saw upgrade</div>
                <div className="text-lg font-bold">{funnel.upgradeModalViewed}</div>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
              <div className="flex-1">
                <div className="text-xs text-muted-foreground">Started checkout</div>
                <div className="text-lg font-bold">{funnel.checkoutStarted}</div>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
              <div className="flex-1">
                <div className="text-xs text-muted-foreground">Completed</div>
                <div className="text-lg font-bold text-green-500">{funnel.paymentCompleted}</div>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t text-center">
              <span className="text-sm text-muted-foreground">
                Modal → Payment conversion rate:{' '}
                <span className="font-bold text-foreground">{conversionRate.toFixed(1)}%</span>
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent Purchases */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent purchases</CardTitle>
        </CardHeader>
        <CardContent>
          {paidUsers.length === 0 ? (
            <p className="text-center text-muted-foreground py-4">No purchases yet</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Tier</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Stripe ID</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paidUsers
                    .sort(
                      (a, b) =>
                        new Date(b.paidAt || b.createdAt).getTime() -
                        new Date(a.paidAt || a.createdAt).getTime()
                    )
                    .slice(0, 20)
                    .map((user) => (
                      <TableRow key={user.id}>
                        <TableCell>{user.email}</TableCell>
                        <TableCell>
                          <span
                            className={`px-2 py-1 rounded-full text-xs font-medium ${
                              user.tier === 'unlimited'
                                ? 'bg-yellow-100 text-yellow-800'
                                : 'bg-blue-100 text-blue-800'
                            }`}
                          >
                            {user.tier}
                          </span>
                        </TableCell>
                        <TableCell>
                          ${user.tier === 'pro' ? '149' : user.tier === 'unlimited' ? '420' : '0'}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {user.stripeCustomerId
                            ? `${user.stripeCustomerId.slice(0, 12)}...`
                            : '-'}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {user.paidAt
                            ? new Date(user.paidAt).toLocaleDateString()
                            : new Date(user.createdAt).toLocaleDateString()}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
