'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { WalletSocialResult } from '@/lib/types';

interface SavedLookup {
  id: string;
  name: string | null;
  walletCount: number;
  twitterFound: number;
  farcasterFound: number;
  results: WalletSocialResult[];
  createdAt: string;
}

interface LookupHistoryProps {
  onLoadLookup: (results: WalletSocialResult[]) => void;
}

export function LookupHistory({ onLoadLookup }: LookupHistoryProps) {
  const [history, setHistory] = useState<SavedLookup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchHistory() {
      try {
        const res = await fetch('/api/history?limit=5');
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

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Recent Lookups</CardTitle>
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
        <CardTitle className="text-lg">Recent Lookups</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {history.map((lookup) => (
          <div
            key={lookup.id}
            className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
          >
            <div>
              <p className="font-medium text-sm">
                {lookup.name || `${lookup.walletCount.toLocaleString()} wallets`}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatDate(lookup.createdAt)} · {lookup.twitterFound} Twitter, {lookup.farcasterFound} Farcaster
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onLoadLookup(lookup.results)}
            >
              Load
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
