'use client';

import { useState, useMemo, useCallback } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { WalletSocialResult } from '@/lib/types';

interface ResultsTableProps {
  results: WalletSocialResult[];
  extraColumns?: string[];
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

export function ResultsTable({
  results,
  extraColumns = [],
}: ResultsTableProps) {
  const [search, setSearch] = useState('');
  const [showOnlyTwitter, setShowOnlyTwitter] = useState(false);
  const [showTopInfluencers, setShowTopInfluencers] = useState(false);
  const [sortField, setSortField] = useState<SortField>('priority_score');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [copiedWallet, setCopiedWallet] = useState<string | null>(null);

  // Check if any results have holdings data
  const hasHoldings = useMemo(
    () => results.some((r) => r.holdings !== undefined && r.holdings > 0),
    [results]
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

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      // Default to descending for numeric fields
      if (
        field === 'fc_followers' ||
        field === 'holdings' ||
        field === 'priority_score'
      ) {
        setSortDirection('desc');
      } else {
        setSortDirection('asc');
      }
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    return <span className="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>;
  };

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

  // Get priority level for visual indicator (0-5 scale based on distribution)
  const getPriorityLevel = useCallback(
    (score: number | undefined): number => {
      if (score === undefined || score === 0) return 0;

      // Calculate max score for relative scaling
      const maxScore = Math.max(
        ...results.map((r) => r.priority_score || 0),
        1
      );
      const normalizedScore = score / maxScore;

      if (normalizedScore >= 0.8) return 5;
      if (normalizedScore >= 0.6) return 4;
      if (normalizedScore >= 0.4) return 3;
      if (normalizedScore >= 0.2) return 2;
      return 1;
    },
    [results]
  );

  const PriorityIndicator = ({ score }: { score: number | undefined }) => {
    const level = getPriorityLevel(score);
    if (level === 0) return <span className="text-muted-foreground">-</span>;

    const bars = Array(5)
      .fill(0)
      .map((_, i) => (
        <div
          key={i}
          className={`w-1 h-3 rounded-sm ${
            i < level ? 'bg-green-500' : 'bg-gray-200 dark:bg-gray-700'
          }`}
        />
      ));

    return (
      <div
        className="flex items-center gap-0.5 cursor-help"
        title={`Priority: ${formatPriorityScore(score)} (Based on holdings × follower reach)`}
      >
        {bars}
        <span className="ml-2 text-xs text-muted-foreground">
          {formatPriorityScore(score)}
        </span>
      </div>
    );
  };

  const handleCopyWallet = async (wallet: string) => {
    try {
      await navigator.clipboard.writeText(wallet);
      setCopiedWallet(wallet);
      setTimeout(() => setCopiedWallet(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

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
          {showTopInfluencers ? 'Top Influencers (1K+)' : 'Top Influencers'}
        </Button>
        <span className="text-sm text-muted-foreground">
          {filteredAndSorted.length.toLocaleString()} results
        </span>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => handleSort('wallet')}
                >
                  Wallet <SortIcon field="wallet" />
                </TableHead>
                <TableHead
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => handleSort('ens_name')}
                >
                  ENS <SortIcon field="ens_name" />
                </TableHead>
                {hasHoldings && (
                  <TableHead
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => handleSort('holdings')}
                  >
                    Holdings <SortIcon field="holdings" />
                  </TableHead>
                )}
                {extraColumns
                  .filter(
                    (col) =>
                      !col.toLowerCase().includes('value') &&
                      !col.toLowerCase().includes('balance') &&
                      !col.toLowerCase().includes('holdings')
                  )
                  .map((col) => (
                    <TableHead key={col}>{col}</TableHead>
                  ))}
                <TableHead
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => handleSort('twitter_handle')}
                >
                  Twitter <SortIcon field="twitter_handle" />
                </TableHead>
                <TableHead
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => handleSort('farcaster')}
                >
                  Farcaster <SortIcon field="farcaster" />
                </TableHead>
                <TableHead
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => handleSort('fc_followers')}
                >
                  FC Followers <SortIcon field="fc_followers" />
                </TableHead>
                <TableHead
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => handleSort('priority_score')}
                  title="Based on holdings × follower reach"
                >
                  Priority <SortIcon field="priority_score" />
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAndSorted.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={8 + extraColumns.length}
                    className="text-center text-muted-foreground py-8"
                  >
                    No results found
                  </TableCell>
                </TableRow>
              ) : (
                filteredAndSorted.map((result) => (
                  <TableRow key={result.wallet}>
                    <TableCell className="font-mono text-xs">
                      <button
                        className="relative hover:text-blue-500 cursor-pointer transition-colors"
                        onClick={() => handleCopyWallet(result.wallet)}
                        title={`${result.wallet}\nClick to copy`}
                      >
                        {truncateWallet(result.wallet)}
                        {copiedWallet === result.wallet && (
                          <span className="absolute -top-6 left-1/2 -translate-x-1/2 bg-black text-white text-xs px-2 py-1 rounded whitespace-nowrap">
                            Copied!
                          </span>
                        )}
                      </button>
                    </TableCell>
                    <TableCell>{result.ens_name || '-'}</TableCell>
                    {hasHoldings && (
                      <TableCell className="font-mono text-sm">
                        {formatHoldings(result.holdings)}
                      </TableCell>
                    )}
                    {extraColumns
                      .filter(
                        (col) =>
                          !col.toLowerCase().includes('value') &&
                          !col.toLowerCase().includes('balance') &&
                          !col.toLowerCase().includes('holdings')
                      )
                      .map((col) => (
                        <TableCell key={col}>
                          {(result[col] as string) || '-'}
                        </TableCell>
                      ))}
                    <TableCell>
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
                    </TableCell>
                    <TableCell>
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
                    </TableCell>
                    <TableCell>
                      {result.fc_followers !== undefined
                        ? result.fc_followers.toLocaleString()
                        : '-'}
                    </TableCell>
                    <TableCell>
                      <PriorityIndicator score={result.priority_score} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
