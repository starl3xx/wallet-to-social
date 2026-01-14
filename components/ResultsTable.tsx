'use client';

import { useState, useMemo } from 'react';
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

type SortField = 'wallet' | 'twitter_handle' | 'farcaster' | 'fc_followers' | 'ens_name';
type SortDirection = 'asc' | 'desc';

export function ResultsTable({ results, extraColumns = [] }: ResultsTableProps) {
  const [search, setSearch] = useState('');
  const [showOnlyTwitter, setShowOnlyTwitter] = useState(false);
  const [sortField, setSortField] = useState<SortField>('wallet');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  const filteredAndSorted = useMemo(() => {
    let filtered = results;

    // Apply Twitter filter
    if (showOnlyTwitter) {
      filtered = filtered.filter((r) => r.twitter_handle);
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
  }, [results, search, showOnlyTwitter, sortField, sortDirection]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    return <span className="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>;
  };

  const truncateWallet = (wallet: string) => {
    return `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
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
                {extraColumns.map((col) => (
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
                <TableHead>Source</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAndSorted.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7 + extraColumns.length}
                    className="text-center text-muted-foreground py-8"
                  >
                    No results found
                  </TableCell>
                </TableRow>
              ) : (
                filteredAndSorted.map((result) => (
                  <TableRow key={result.wallet}>
                    <TableCell className="font-mono text-xs">
                      <span title={result.wallet}>{truncateWallet(result.wallet)}</span>
                    </TableCell>
                    <TableCell>{result.ens_name || '-'}</TableCell>
                    {extraColumns.map((col) => (
                      <TableCell key={col}>
                        {(result[col] as string) || '-'}
                      </TableCell>
                    ))}
                    <TableCell>
                      {result.twitter_handle ? (
                        <a
                          href={result.twitter_url || `https://x.com/${result.twitter_handle}`}
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
                          href={result.farcaster_url || `https://warpcast.com/${result.farcaster}`}
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
                    <TableCell className="text-xs text-muted-foreground">
                      {result.source.join(', ')}
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
