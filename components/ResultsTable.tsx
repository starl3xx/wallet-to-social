'use client';

import { useState, useMemo, useCallback, memo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Lock } from 'lucide-react';
import type { WalletSocialResult } from '@/lib/types';

interface ResultsTableProps {
  results: WalletSocialResult[];
  extraColumns?: string[];
  userTier?: 'free' | 'pro' | 'unlimited';
  onUpgradeClick?: () => void;
  enrichedWallets?: Set<string>; // Wallets that have been enriched since last view
}

type SortField =
  | 'wallet'
  | 'twitter_handle'
  | 'farcaster'
  | 'fc_followers'
  | 'ens_name'
  | 'holdings'
  | 'priority_score';
type SortDirection = 'asc' | 'desc';

const ROW_HEIGHT = 44; // Fixed row height for virtualization

export const ResultsTable = memo(function ResultsTable({
  results,
  extraColumns = [],
  userTier = 'free',
  onUpgradeClick,
  enrichedWallets,
}: ResultsTableProps) {
  const isPaidTier = userTier === 'pro' || userTier === 'unlimited';
  const [search, setSearch] = useState('');
  const [showOnlyTwitter, setShowOnlyTwitter] = useState(false);
  const [showTopInfluencers, setShowTopInfluencers] = useState(false);
  const [sortField, setSortField] = useState<SortField>('priority_score');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [copiedWallet, setCopiedWallet] = useState<string | null>(null);

  const parentRef = useRef<HTMLDivElement>(null);

  // Check if any results have holdings data
  const hasHoldings = useMemo(
    () => results.some((r) => r.holdings !== undefined && r.holdings > 0),
    [results]
  );

  // Filter extra columns once
  const filteredExtraColumns = useMemo(
    () =>
      extraColumns.filter(
        (col) =>
          !col.toLowerCase().includes('value') &&
          !col.toLowerCase().includes('balance') &&
          !col.toLowerCase().includes('holdings')
      ),
    [extraColumns]
  );

  const filteredAndSorted = useMemo(() => {
    let filtered = results;

    // Apply Twitter filter
    if (showOnlyTwitter) {
      filtered = filtered.filter((r) => r.twitter_handle);
    }

    // Apply Top Influencers filter (1K+ FC followers)
    if (showTopInfluencers) {
      filtered = filtered.filter(
        (r) => r.fc_followers !== undefined && r.fc_followers >= 1000
      );
    }

    // Apply search filter
    if (search) {
      const searchLower = search.toLowerCase();
      filtered = filtered.filter(
        (r) =>
          r.wallet.toLowerCase().includes(searchLower) ||
          r.ens_name?.toLowerCase().includes(searchLower) ||
          r.twitter_handle?.toLowerCase().includes(searchLower) ||
          r.farcaster?.toLowerCase().includes(searchLower)
      );
    }

    // Apply sorting
    filtered = [...filtered].sort((a, b) => {
      let aVal: string | number | undefined;
      let bVal: string | number | undefined;

      switch (sortField) {
        case 'fc_followers':
          aVal = a.fc_followers ?? 0;
          bVal = b.fc_followers ?? 0;
          break;
        case 'holdings':
          aVal = a.holdings ?? 0;
          bVal = b.holdings ?? 0;
          break;
        case 'priority_score':
          aVal = a.priority_score ?? 0;
          bVal = b.priority_score ?? 0;
          break;
        default:
          aVal = a[sortField] as string | undefined;
          bVal = b[sortField] as string | undefined;
      }

      if (aVal === undefined && bVal === undefined) return 0;
      if (aVal === undefined) return 1;
      if (bVal === undefined) return -1;

      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
      }

      const comparison = String(aVal).localeCompare(String(bVal));
      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return filtered;
  }, [
    results,
    search,
    showOnlyTwitter,
    showTopInfluencers,
    sortField,
    sortDirection,
  ]);

  // Virtualizer for efficient rendering of large lists
  const virtualizer = useVirtualizer({
    count: filteredAndSorted.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10, // Render 10 extra rows above/below viewport
  });

  const handleSort = useCallback((field: SortField) => {
    setSortField((currentField) => {
      if (currentField === field) {
        setSortDirection((dir) => (dir === 'asc' ? 'desc' : 'asc'));
        return field;
      }
      // Default to descending for numeric fields
      if (field === 'fc_followers' || field === 'holdings' || field === 'priority_score') {
        setSortDirection('desc');
      } else {
        setSortDirection('asc');
      }
      return field;
    });
  }, []);

  const SortIcon = useCallback(
    ({ field }: { field: SortField }) => {
      if (sortField !== field) return null;
      return <span className="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>;
    },
    [sortField, sortDirection]
  );

  const truncateWallet = (wallet: string) => {
    return `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
  };

  const formatHoldings = (value: number | undefined) => {
    if (value === undefined) return '-';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const formatPriorityScore = (value: number | undefined) => {
    if (value === undefined || value === 0) return '-';
    return value.toFixed(1);
  };

  // Memoize max score calculation
  const maxScore = useMemo(
    () => Math.max(...results.map((r) => r.priority_score || 0), 1),
    [results]
  );

  const getPriorityLevel = useCallback(
    (score: number | undefined): number => {
      if (score === undefined || score === 0) return 0;
      const normalizedScore = score / maxScore;
      if (normalizedScore >= 0.8) return 5;
      if (normalizedScore >= 0.6) return 4;
      if (normalizedScore >= 0.4) return 3;
      if (normalizedScore >= 0.2) return 2;
      return 1;
    },
    [maxScore]
  );

  const PriorityIndicator = memo(function PriorityIndicator({
    score,
  }: {
    score: number | undefined;
  }) {
    const level = getPriorityLevel(score);
    if (level === 0) return <span className="text-muted-foreground">-</span>;

    return (
      <div
        className="flex items-center gap-0.5 cursor-help"
        title={`Priority: ${formatPriorityScore(score)} (Based on holdings × follower reach)`}
      >
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className={`w-1 h-3 rounded-sm ${
              i < level ? 'bg-green-500' : 'bg-gray-200 dark:bg-gray-700'
            }`}
          />
        ))}
        <span className="ml-2 text-xs text-muted-foreground">
          {formatPriorityScore(score)}
        </span>
      </div>
    );
  });

  const handleCopyWallet = useCallback(async (wallet: string) => {
    try {
      await navigator.clipboard.writeText(wallet);
      setCopiedWallet(wallet);
      setTimeout(() => setCopiedWallet(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, []);

  // Calculate column count for grid
  const baseColumns = 6; // wallet, ens, twitter, farcaster, fc_followers, priority
  const columnCount =
    baseColumns + (hasHoldings ? 1 : 0) + filteredExtraColumns.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <Input
          placeholder="Search wallet, ENS, or handle..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <Button
          variant={showOnlyTwitter ? 'default' : 'outline'}
          size="sm"
          onClick={() => setShowOnlyTwitter(!showOnlyTwitter)}
        >
          {showOnlyTwitter ? 'Showing Twitter only' : 'Show only with Twitter'}
        </Button>
        <Button
          variant={showTopInfluencers ? 'default' : 'outline'}
          size="sm"
          onClick={() => setShowTopInfluencers(!showTopInfluencers)}
        >
          {showTopInfluencers ? 'Top influencers (1K+)' : 'Top influencers'}
        </Button>
        <span className="text-sm text-muted-foreground">
          {filteredAndSorted.length.toLocaleString()} results
        </span>
      </div>

      <div className="border rounded-lg overflow-hidden">
        {/* Header */}
        <div className="bg-muted/50 border-b">
          <div
            className="grid text-sm font-medium text-muted-foreground"
            style={{
              gridTemplateColumns: `minmax(120px, 1fr) minmax(100px, 1fr) ${hasHoldings ? 'minmax(100px, 1fr) ' : ''}${filteredExtraColumns.map(() => 'minmax(80px, 1fr) ').join('')}minmax(120px, 1fr) minmax(120px, 1fr) minmax(100px, 1fr) minmax(140px, 1fr)`,
            }}
          >
            <div
              className="px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => handleSort('wallet')}
            >
              Wallet <SortIcon field="wallet" />
            </div>
            <div
              className="px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => handleSort('ens_name')}
            >
              ENS <SortIcon field="ens_name" />
            </div>
            {hasHoldings && (
              <div
                className="px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => handleSort('holdings')}
              >
                Holdings <SortIcon field="holdings" />
              </div>
            )}
            {filteredExtraColumns.map((col) => (
              <div key={col} className="px-4 py-3">
                {col}
              </div>
            ))}
            <div
              className="px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => handleSort('twitter_handle')}
            >
              Twitter <SortIcon field="twitter_handle" />
            </div>
            <div
              className="px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => handleSort('farcaster')}
            >
              Farcaster <SortIcon field="farcaster" />
            </div>
            <div
              className="px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => handleSort('fc_followers')}
            >
              FC Followers <SortIcon field="fc_followers" />
            </div>
            <div
              className="px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => handleSort('priority_score')}
              title="Based on holdings × follower reach"
            >
              Priority <SortIcon field="priority_score" />
            </div>
          </div>
        </div>

        {/* Virtualized body */}
        <div
          ref={parentRef}
          className="overflow-auto"
          style={{ height: Math.min(filteredAndSorted.length * ROW_HEIGHT, 600) }}
        >
          {filteredAndSorted.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              No results found
            </div>
          ) : (
            <div
              style={{
                height: `${virtualizer.getTotalSize()}px`,
                width: '100%',
                position: 'relative',
              }}
            >
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const result = filteredAndSorted[virtualRow.index];
                const isEnriched = enrichedWallets?.has(result.wallet.toLowerCase());
                return (
                  <div
                    key={result.wallet}
                    className={`absolute top-0 left-0 w-full grid items-center border-b border-border/50 transition-colors ${
                      isEnriched
                        ? 'bg-green-50 dark:bg-green-950/30 hover:bg-green-100 dark:hover:bg-green-950/50'
                        : 'hover:bg-muted/30'
                    }`}
                    style={{
                      height: `${virtualRow.size}px`,
                      transform: `translateY(${virtualRow.start}px)`,
                      gridTemplateColumns: `minmax(120px, 1fr) minmax(100px, 1fr) ${hasHoldings ? 'minmax(100px, 1fr) ' : ''}${filteredExtraColumns.map(() => 'minmax(80px, 1fr) ').join('')}minmax(120px, 1fr) minmax(120px, 1fr) minmax(100px, 1fr) minmax(140px, 1fr)`,
                    }}
                  >
                    {/* Wallet */}
                    <div className="px-4 py-2 font-mono text-xs">
                      <div className="flex items-center gap-2">
                        <button
                          className="relative hover:text-blue-500 cursor-pointer transition-colors"
                          onClick={() => handleCopyWallet(result.wallet)}
                          title={`${result.wallet}\nClick to copy`}
                        >
                          {truncateWallet(result.wallet)}
                          {copiedWallet === result.wallet && (
                            <span className="absolute -top-6 left-1/2 -translate-x-1/2 bg-black text-white text-xs px-2 py-1 rounded whitespace-nowrap z-10">
                              Copied!
                            </span>
                          )}
                        </button>
                        {isEnriched && (
                          <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-green-500 text-white">
                            NEW
                          </span>
                        )}
                      </div>
                    </div>

                    {/* ENS */}
                    <div className="px-4 py-2 text-sm truncate">
                      {result.ens_name || '-'}
                    </div>

                    {/* Holdings */}
                    {hasHoldings && (
                      <div className="px-4 py-2 font-mono text-sm">
                        {formatHoldings(result.holdings)}
                      </div>
                    )}

                    {/* Extra columns */}
                    {filteredExtraColumns.map((col) => (
                      <div key={col} className="px-4 py-2 text-sm truncate">
                        {(result[col] as string) || '-'}
                      </div>
                    ))}

                    {/* Twitter */}
                    <div className="px-4 py-2 text-sm">
                      {result.twitter_handle ? (
                        <a
                          href={
                            result.twitter_url ||
                            `https://x.com/${result.twitter_handle}`
                          }
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-500 hover:underline"
                        >
                          @{result.twitter_handle}
                        </a>
                      ) : (
                        '-'
                      )}
                    </div>

                    {/* Farcaster */}
                    <div className="px-4 py-2 text-sm">
                      {result.farcaster ? (
                        <a
                          href={
                            result.farcaster_url ||
                            `https://warpcast.com/${result.farcaster}`
                          }
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-purple-500 hover:underline"
                        >
                          @{result.farcaster}
                        </a>
                      ) : (
                        '-'
                      )}
                    </div>

                    {/* FC Followers */}
                    <div className="px-4 py-2 text-sm">
                      {isPaidTier ? (
                        result.fc_followers !== undefined ? (
                          result.fc_followers.toLocaleString()
                        ) : (
                          '-'
                        )
                      ) : (
                        <button
                          onClick={onUpgradeClick}
                          className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                          title="Upgrade to see FC followers"
                        >
                          <Lock className="h-3 w-3" />
                          <span className="text-xs">Upgrade</span>
                        </button>
                      )}
                    </div>

                    {/* Priority */}
                    <div className="px-4 py-2 text-sm">
                      {isPaidTier ? (
                        <PriorityIndicator score={result.priority_score} />
                      ) : (
                        <button
                          onClick={onUpgradeClick}
                          className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                          title="Upgrade to see priority score"
                        >
                          <Lock className="h-3 w-3" />
                          <span className="text-xs">Upgrade</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
