'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Sparkline } from './Sparkline';
import {
  Loader2,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Minus,
  Search,
  DollarSign,
  AlertCircle,
  Layers,
  Users,
  BarChart3,
} from 'lucide-react';

interface PulseData {
  lookupsToday: number;
  lookupsTrend: number[];
  activeUsers7d: number;
  activeUsersTrend: 'up' | 'down' | 'flat';
  conversionRate: number;
  revenueMTD: number;
  revenueVsLastMonth: number;
  errorRate: number;
  errorStatus: 'green' | 'yellow' | 'red';
  queueDepth: number;
}

interface ExecutivePulseProps {
  password: string;
  onMetricClick?: (metric: string) => void;
}

export function ExecutivePulse({ password, onMetricClick }: ExecutivePulseProps) {
  const [data, setData] = useState<PulseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPulse = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/admin/analytics/pulse', {
        headers: { 'x-admin-password': password },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch pulse data');
      }

      const pulseData = await response.json();
      setData(pulseData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [password]);

  useEffect(() => {
    fetchPulse();
  }, [fetchPulse]);

  const TrendIcon = ({ trend }: { trend: 'up' | 'down' | 'flat' }) => {
    switch (trend) {
      case 'up':
        return <TrendingUp className="h-4 w-4 text-green-500" />;
      case 'down':
        return <TrendingDown className="h-4 w-4 text-red-500" />;
      default:
        return <Minus className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const StatusIndicator = ({ status }: { status: 'green' | 'yellow' | 'red' }) => {
    const colors = {
      green: 'bg-green-500',
      yellow: 'bg-yellow-500',
      red: 'bg-red-500',
    };
    return (
      <span className={`inline-block w-2 h-2 rounded-full ${colors[status]} mr-1`} />
    );
  };

  if (loading && !data) {
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
        <Button variant="outline" onClick={fetchPulse}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Retry
        </Button>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Executive pulse</h2>
        <Button variant="ghost" size="sm" onClick={fetchPulse} disabled={loading}>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {/* Lookups Today */}
        <Card
          className="cursor-pointer hover:border-primary/50 transition-colors"
          onClick={() => onMetricClick?.('jobs')}
        >
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <Search className="h-3 w-3" />
              <span>Lookups today</span>
            </div>
            <div className="flex items-end justify-between">
              <span className="text-2xl font-bold">{data.lookupsToday}</span>
              <Sparkline
                data={data.lookupsTrend}
                width={60}
                height={20}
                color="hsl(var(--primary))"
              />
            </div>
          </CardContent>
        </Card>

        {/* Active Users */}
        <Card
          className="cursor-pointer hover:border-primary/50 transition-colors"
          onClick={() => onMetricClick?.('behavior')}
        >
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <Users className="h-3 w-3" />
              <span>Active users (7d)</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-2xl font-bold">{data.activeUsers7d}</span>
              <TrendIcon trend={data.activeUsersTrend} />
            </div>
          </CardContent>
        </Card>

        {/* Conversion Rate */}
        <Card
          className="cursor-pointer hover:border-primary/50 transition-colors"
          onClick={() => onMetricClick?.('revenue')}
        >
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <BarChart3 className="h-3 w-3" />
              <span>Conversion rate</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-2xl font-bold">{data.conversionRate.toFixed(1)}%</span>
            </div>
          </CardContent>
        </Card>

        {/* Revenue MTD */}
        <Card
          className="cursor-pointer hover:border-primary/50 transition-colors"
          onClick={() => onMetricClick?.('revenue')}
        >
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <DollarSign className="h-3 w-3" />
              <span>Revenue (MTD)</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-2xl font-bold">${data.revenueMTD.toLocaleString()}</span>
              <span
                className={`text-xs ${
                  data.revenueVsLastMonth >= 0 ? 'text-green-500' : 'text-red-500'
                }`}
              >
                {data.revenueVsLastMonth >= 0 ? '+' : ''}
                {data.revenueVsLastMonth}%
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Error Rate */}
        <Card
          className="cursor-pointer hover:border-primary/50 transition-colors"
          onClick={() => onMetricClick?.('health')}
        >
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <AlertCircle className="h-3 w-3" />
              <span>Error rate (24h)</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-2xl font-bold">
                <StatusIndicator status={data.errorStatus} />
                {data.errorRate.toFixed(1)}%
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Queue Depth */}
        <Card
          className="cursor-pointer hover:border-primary/50 transition-colors"
          onClick={() => onMetricClick?.('jobs')}
        >
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <Layers className="h-3 w-3" />
              <span>Queue depth</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-2xl font-bold">{data.queueDepth}</span>
              <span
                className={`text-xs ${
                  data.queueDepth > 10
                    ? 'text-yellow-500'
                    : data.queueDepth > 50
                      ? 'text-red-500'
                      : 'text-green-500'
                }`}
              >
                {data.queueDepth === 0 ? 'idle' : data.queueDepth <= 10 ? 'normal' : 'busy'}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
