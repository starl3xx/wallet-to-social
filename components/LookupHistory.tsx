'use client';

import { useEffect, useState, memo, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { getUserId } from '@/lib/user-id';
import type { WalletSocialResult } from '@/lib/types';
import type { UserTier } from '@/lib/access';

interface LookupSummary {
  id: string;
  name: string | null;
  walletCount: number;
  twitterFound: number;
  farcasterFound: number;
  createdAt: string;
}

interface LookupHistoryProps {
  onLoadLookup: (results: WalletSocialResult[], lookupId?: string, lookupName?: string | null) => void;
  userTier: UserTier;
  onAddAddresses?: (lookupId: string, existingWallets: string[]) => void;
}

// Get the display limit based on user tier
const getHistoryLimit = (tier: UserTier): number => {
  if (tier === 'free') return 1;
  return 10; // Initial load for pro/unlimited
};

export const LookupHistory = memo(function LookupHistory({ onLoadLookup, userTier, onAddAddresses }: LookupHistoryProps) {
  const [history, setHistory] = useState<LookupSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    async function fetchHistory() {
      try {
        const userId = getUserId();
        const limit = getHistoryLimit(userTier);
        // Fetch summaries only (no full results JSONB), include count for pagination
        const res = await fetch(`/api/history?limit=${limit}&userId=${userId}&summaryOnly=true&includeCount=true`);
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
        setTotalCount(data.totalCount || 0);
        setHasMore(data.history.length < (data.totalCount || 0));
      } catch {
        setError('Failed to load history');
      } finally {
        setLoading(false);
      }
    }

    fetchHistory();
  }, [userTier]);

  // Load more history (for pro/unlimited users)
  const handleLoadMore = useCallback(async () => {
    if (loadingMore || userTier === 'free') return;

    setLoadingMore(true);
    try {
      const userId = getUserId();
      const limit = 10;
      const offset = history.length;
      const res = await fetch(`/api/history?limit=${limit}&offset=${offset}&userId=${userId}&summaryOnly=true`);
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setHistory(prev => [...prev, ...data.history]);
      setHasMore(history.length + data.history.length < totalCount);
    } catch (err) {
      console.error('Failed to load more:', err);
    } finally {
      setLoadingMore(false);
    }
  }, [history.length, loadingMore, totalCount, userTier]);

  // Lazy load full results only when user clicks "Load"
  const handleLoadLookup = useCallback(async (id: string, name: string | null) => {
    setLoadingId(id);
    try {
      const res = await fetch(`/api/history/${id}`);
      if (!res.ok) throw new Error('Failed to load');
      const { results } = await res.json();
      onLoadLookup(results, id, name);
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
          <CardTitle className="text-lg">My lookups</CardTitle>
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
        <CardTitle className="text-lg">My lookups</CardTitle>
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
            <div className="flex items-center gap-2">
              {onAddAddresses && userTier !== 'free' && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onAddAddresses(lookup.id, [])}
                  title="Add more addresses to this lookup"
                  className="px-2"
                >
                  +
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleLoadLookup(lookup.id, lookup.name)}
                disabled={loadingId === lookup.id}
              >
                {loadingId === lookup.id ? 'Loading...' : 'Load'}
              </Button>
            </div>
          </div>
        ))}

        {/* Free tier upgrade prompt */}
        {userTier === 'free' && totalCount > 1 && (
          <p className="text-xs text-muted-foreground text-center pt-2">
            Upgrade to see your full lookup history ({totalCount - 1} more)
          </p>
        )}

        {/* Load more button for pro/unlimited */}
        {userTier !== 'free' && hasMore && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLoadMore}
            disabled={loadingMore}
            className="w-full"
          >
            {loadingMore ? 'Loading...' : `Load more (${totalCount - history.length} remaining)`}
          </Button>
        )}
      </CardContent>
    </Card>
  );
});
