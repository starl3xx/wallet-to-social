'use client';

import { useEffect, useState, memo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { getUserId } from '@/lib/user-id';
import type { WalletSocialResult } from '@/lib/types';

interface LookupSummary {
  id: string;
  name: string | null;
  walletCount: number;
  twitterFound: number;
  farcasterFound: number;
  createdAt: string;
}

interface LookupHistoryProps {
  onLoadLookup: (results: WalletSocialResult[]) => void;
}

export const LookupHistory = memo(function LookupHistory({ onLoadLookup }: LookupHistoryProps) {
  const [history, setHistory] = useState<LookupSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchHistory() {
      try {
        const userId = getUserId();
        // Fetch summaries only (no full results JSONB)
        const res = await fetch(`/api/history?limit=5&userId=${userId}&summaryOnly=true`);
        if (!res.ok) {
          if (res.status === 503) {
            setError('Database not configured');
          } else {
            throw new Error('Failed to fetch');
          }
          return;
        }
        const data = await res.json();
        setHistory(data.history);
      } catch (err) {
        setError('Failed to load history');
      } finally {
        setLoading(false);
      }
    }

    fetchHistory();
  }, []);

  // Lazy load full results only when user clicks "Load"
  const handleLoadLookup = useCallback(async (id: string) => {
    setLoadingId(id);
    try {
      const res = await fetch(`/api/history/${id}`);
      if (!res.ok) throw new Error('Failed to load');
      const { results } = await res.json();
      onLoadLookup(results);
    } catch (err) {
      console.error('Failed to load lookup:', err);
    } finally {
      setLoadingId(null);
    }
  }, [onLoadLookup]);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Recent lookups</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Loading...</p>
        </CardContent>
      </Card>
    );
  }

  if (error || history.length === 0) {
    return null; // Don't show if no history or error
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Recent lookups</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {history.map((lookup) => (
          <div
            key={lookup.id}
            className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
          >
            <div>
              <p className="font-medium text-sm">
                {lookup.name ||
                  `${lookup.walletCount.toLocaleString()} wallets`}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatDate(lookup.createdAt)} · {lookup.twitterFound} Twitter,{' '}
                {lookup.farcasterFound} Farcaster
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleLoadLookup(lookup.id)}
              disabled={loadingId === lookup.id}
            >
              {loadingId === lookup.id ? 'Loading...' : 'Load'}
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
});
