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
import { ArrowsClockwise as RefreshCw } from '@phosphor-icons/react';
import { Stat } from './Stat';
import { FunnelStep } from './FunnelStep';
import { RefreshButton } from './RefreshButton';
import { Empty, Loading } from './PaneState';

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

interface PaywallTrigger {
  trigger: string;
  count: number;
}

interface UserBehaviorProps {
  password: string;
}

export function UserBehavior({ password }: UserBehaviorProps) {
  const [funnel, setFunnel] = useState<FunnelData | null>(null);
  const [cohorts, setCohorts] = useState<CohortData[]>([]);
  const [features, setFeatures] = useState<FeatureData | null>(null);
  const [triggers, setTriggers] = useState<PaywallTrigger[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [funnelRes, cohortsRes, featuresRes, paywallRes] =
        await Promise.all([
          fetch('/api/admin/analytics/funnel?days=7', {
            headers: { 'x-admin-password': password },
          }),
          fetch('/api/admin/analytics/cohorts', {
            headers: { 'x-admin-password': password },
          }),
          fetch('/api/admin/analytics/features?days=30', {
            headers: { 'x-admin-password': password },
          }),
          fetch('/api/admin/analytics/paywall?days=30', {
            headers: { 'x-admin-password': password },
          }),
        ]);

      if (!funnelRes.ok || !cohortsRes.ok || !featuresRes.ok || !paywallRes.ok) {
        throw new Error('Failed to fetch behavior data');
      }

      const [funnelData, cohortsData, featuresData, paywallData] =
        await Promise.all([
          funnelRes.json(),
          cohortsRes.json(),
          featuresRes.json(),
          paywallRes.json(),
        ]);

      setFunnel(funnelData);
      setCohorts(cohortsData);
      setFeatures(featuresData);
      setTriggers(paywallData.triggers);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [password]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading && !funnel) {
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

  /**
   * `null` when there is no denominator, NOT 1.
   *
   * This was `funnel?.pageViews || 1`, and page views were never recorded, so
   * every rate below became a percentage of one: 34 lookups read "3400%" and 49
   * upgrade-modal views read "4900%". A number that cannot be computed has to
   * say so. Substituting a denominator to keep the arithmetic running turns a
   * missing measurement into a confident wrong one, which is the failure this
   * product exists to avoid everywhere else.
   *
   * It stays null-aware after the tracking fix, because any window that predates
   * it still has no page views and must render honestly rather than retroactively
   * inventing a rate.
   */
  const baseCount = funnel?.pageViews ? funnel.pageViews : null;
  const rateOf = (n: number) =>
    baseCount === null ? null : (n / baseCount) * 100;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-light tracking-[var(--tracking-title)]">
          User behavior analytics
        </h2>
        <RefreshButton onClick={fetchData} loading={loading} />
      </div>

      {/* User Journey Funnel */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            User journey funnel (7 days)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {funnel && (
            <div className="grid grid-cols-3 gap-4 md:grid-cols-6">
              <FunnelStep
                label="Page views"
                count={funnel.pageViews}
                rate={baseCount === null ? null : 100}
              />
              <FunnelStep
                label="CSV uploads"
                count={funnel.csvUploads}
                rate={rateOf(funnel.csvUploads)}
              />
              <FunnelStep
                label="Lookups started"
                count={funnel.lookupsStarted}
                rate={rateOf(funnel.lookupsStarted)}
              />
              <FunnelStep
                label="Exports"
                count={funnel.exportsClicked}
                rate={rateOf(funnel.exportsClicked)}
              />
              <FunnelStep
                label="Saw pricing"
                count={funnel.upgradeModalViewed}
                rate={rateOf(funnel.upgradeModalViewed)}
              />
              <FunnelStep
                label="Paid"
                count={funnel.paymentCompleted}
                rate={rateOf(funnel.paymentCompleted)}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Paywall triggers. The per-gate names shipped 2026-08-22; rows named
          'limit' and 'feature' are the legacy labels from before that. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Paywall triggers (30 days)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {triggers.length === 0 ? (
            <Empty>No buy-credits modal opens in the window</Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Gate</TableHead>
                  <TableHead className="text-right">Opens</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {triggers.map((t) => (
                  <TableRow key={t.trigger}>
                    <TableCell className="font-medium">{t.trigger}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {t.count}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
            <Empty>No cohort data available yet</Empty>
          ) : (
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
                    <TableCell className="text-right font-medium tabular-nums">
                      {cohort.count}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {cohort.avgLookups.toFixed(1)}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {/* Three tiers, two colours. A high rate is a measured
                            good outcome, so green; a low one is worth a look,
                            so caution; the middle is just a number. Not
                            destructive at the bottom: that is for failed jobs
                            and for revoking and deleting, and a quiet cohort
                            is neither. */}
                      <span
                        className={
                          cohort.conversionRate > 50
                            ? 'text-attested'
                            : cohort.conversionRate > 10
                              ? undefined
                              : 'text-caution'
                        }
                      >
                        {cohort.conversionRate.toFixed(0)}%
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Feature Adoption */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Feature adoption (30 days)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {features && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Stat
                label="ENS lookup rate"
                value={`${features.ensLookupRate.toFixed(0)}%`}
              />
              <Stat
                label="History save rate"
                value={`${features.historySaveRate.toFixed(0)}%`}
              />
              <Stat
                label="Export rate"
                value={`${features.exportRate.toFixed(0)}%`}
              />
              <Stat
                label="Export formats"
                value={
                  <span className="text-sm font-normal tracking-[var(--tracking-body)]">
                    CSV {features.exportFormats.csv} · X list{' '}
                    {features.exportFormats.twitter}
                  </span>
                }
              />
            </div>
          )}

          {features && (
            <div className="mt-4 pt-4 border-t">
              <div className="mb-2 text-xs text-muted-foreground">
                Average lookup size by tier
              </div>
              <div className="grid grid-cols-3 gap-4">
                <Stat
                  label="Free"
                  value={features.avgLookupSize.free.toLocaleString()}
                />
                <Stat
                  label="Pro"
                  value={features.avgLookupSize.pro.toLocaleString()}
                />
                <Stat
                  label="Unlimited"
                  value={features.avgLookupSize.unlimited.toLocaleString()}
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
