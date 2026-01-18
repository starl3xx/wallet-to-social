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
import { Loader2, RefreshCw, ChevronRight } from 'lucide-react';

interface FunnelData {
  pageViews: number;
  csvUploads: number;
  lookupsStarted: number;
  lookupsCompleted: number;
  exportsClicked: number;
  historySaved: number;
  upgradeModalViewed: number;
  checkoutStarted: number;
  paymentCompleted: number;
}

interface CohortData {
  name: string;
  definition: string;
  count: number;
  avgLookups: number;
  conversionRate: number;
}

interface FeatureData {
  ensLookupRate: number;
  historySaveRate: number;
  exportRate: number;
  exportFormats: { csv: number; twitter: number };
  avgLookupSize: { free: number; pro: number; unlimited: number };
}

interface UserBehaviorProps {
  password: string;
}

export function UserBehavior({ password }: UserBehaviorProps) {
  const [funnel, setFunnel] = useState<FunnelData | null>(null);
  const [cohorts, setCohorts] = useState<CohortData[]>([]);
  const [features, setFeatures] = useState<FeatureData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [funnelRes, cohortsRes, featuresRes] = await Promise.all([
        fetch('/api/admin/analytics/funnel?days=7', {
          headers: { 'x-admin-password': password },
        }),
        fetch('/api/admin/analytics/cohorts', {
          headers: { 'x-admin-password': password },
        }),
        fetch('/api/admin/analytics/features?days=30', {
          headers: { 'x-admin-password': password },
        }),
      ]);

      if (!funnelRes.ok || !cohortsRes.ok || !featuresRes.ok) {
        throw new Error('Failed to fetch behavior data');
      }

      const [funnelData, cohortsData, featuresData] = await Promise.all([
        funnelRes.json(),
        cohortsRes.json(),
        featuresRes.json(),
      ]);

      setFunnel(funnelData);
      setCohorts(cohortsData);
      setFeatures(featuresData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [password]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const FunnelStep = ({
    label,
    count,
    rate,
    isLast,
  }: {
    label: string;
    count: number;
    rate: number;
    isLast?: boolean;
  }) => (
    <div className="flex items-center">
      <div className="flex-1 text-center">
        <div className="text-xs text-muted-foreground mb-1">{label}</div>
        <div className="text-lg font-bold">{count.toLocaleString()}</div>
        <div className="text-xs text-muted-foreground">{rate.toFixed(0)}%</div>
      </div>
      {!isLast && (
        <ChevronRight className="h-4 w-4 text-muted-foreground mx-1 flex-shrink-0" />
      )}
    </div>
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

  const baseCount = funnel?.pageViews || 1;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">User behavior analytics</h2>
        <Button variant="ghost" size="sm" onClick={fetchData} disabled={loading}>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* User Journey Funnel */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">User journey funnel (7 days)</CardTitle>
        </CardHeader>
        <CardContent>
          {funnel && (
            <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
              <FunnelStep
                label="Page views"
                count={funnel.pageViews}
                rate={100}
              />
              <FunnelStep
                label="CSV uploads"
                count={funnel.csvUploads}
                rate={(funnel.csvUploads / baseCount) * 100}
              />
              <FunnelStep
                label="Lookups started"
                count={funnel.lookupsStarted}
                rate={(funnel.lookupsStarted / baseCount) * 100}
              />
              <FunnelStep
                label="Exports"
                count={funnel.exportsClicked}
                rate={(funnel.exportsClicked / baseCount) * 100}
              />
              <FunnelStep
                label="Upgrade modal"
                count={funnel.upgradeModalViewed}
                rate={(funnel.upgradeModalViewed / baseCount) * 100}
              />
              <FunnelStep
                label="Paid"
                count={funnel.paymentCompleted}
                rate={(funnel.paymentCompleted / baseCount) * 100}
                isLast
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Behavior Cohorts */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Behavior cohorts</CardTitle>
        </CardHeader>
        <CardContent>
          {cohorts.length === 0 ? (
            <p className="text-center text-muted-foreground py-4">
              No cohort data available yet
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cohort</TableHead>
                    <TableHead>Definition</TableHead>
                    <TableHead className="text-right">Count</TableHead>
                    <TableHead className="text-right">Avg lookups</TableHead>
                    <TableHead className="text-right">Conversion</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cohorts.map((cohort) => (
                    <TableRow key={cohort.name}>
                      <TableCell className="font-medium">{cohort.name}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {cohort.definition}
                      </TableCell>
                      <TableCell className="text-right">{cohort.count}</TableCell>
                      <TableCell className="text-right">
                        {cohort.avgLookups.toFixed(1)}
                      </TableCell>
                      <TableCell className="text-right">
                        <span
                          className={
                            cohort.conversionRate > 50
                              ? 'text-green-500'
                              : cohort.conversionRate > 10
                                ? 'text-yellow-500'
                                : 'text-red-500'
                          }
                        >
                          {cohort.conversionRate.toFixed(0)}%
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Feature Adoption */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Feature adoption (30 days)</CardTitle>
        </CardHeader>
        <CardContent>
          {features && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <div className="text-xs text-muted-foreground mb-1">ENS lookup rate</div>
                <div className="text-xl font-bold">{features.ensLookupRate.toFixed(0)}%</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">History save rate</div>
                <div className="text-xl font-bold">{features.historySaveRate.toFixed(0)}%</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Export rate</div>
                <div className="text-xl font-bold">{features.exportRate.toFixed(0)}%</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Export formats</div>
                <div className="text-sm">
                  CSV: {features.exportFormats.csv} / Twitter: {features.exportFormats.twitter}
                </div>
              </div>
            </div>
          )}

          {features && (
            <div className="mt-4 pt-4 border-t">
              <div className="text-xs text-muted-foreground mb-2">Average lookup size by tier</div>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <div className="text-sm text-muted-foreground">Free</div>
                  <div className="text-lg font-bold">
                    {features.avgLookupSize.free.toLocaleString()}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Pro</div>
                  <div className="text-lg font-bold">
                    {features.avgLookupSize.pro.toLocaleString()}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Unlimited</div>
                  <div className="text-lg font-bold">
                    {features.avgLookupSize.unlimited.toLocaleString()}
                  </div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
