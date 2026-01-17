'use client';

import { Button } from '@/components/ui/button';
import { Lock } from 'lucide-react';
import { exportToCSV } from '@/lib/csv-parser';
import type { WalletSocialResult } from '@/lib/types';

interface ExportButtonProps {
  results: WalletSocialResult[];
  extraColumns?: string[];
  disabled?: boolean;
  userTier?: 'free' | 'pro' | 'unlimited';
  onUpgradeClick?: () => void;
}

export function ExportButton({
  results,
  extraColumns = [],
  disabled,
  userTier = 'free',
  onUpgradeClick,
}: ExportButtonProps) {
  const isPaidTier = userTier === 'pro' || userTier === 'unlimited';
  // Sort results by priority score descending for export
  const sortedResults = [...results].sort(
    (a, b) => (b.priority_score || 0) - (a.priority_score || 0)
  );

  const handleExportCSV = () => {
    const headers = [
      'wallet',
      'ens_name',
      'holdings',
      ...extraColumns.filter(
        (col) =>
          !col.toLowerCase().includes('value') &&
          !col.toLowerCase().includes('balance') &&
          !col.toLowerCase().includes('holdings')
      ),
      'twitter_handle',
      'twitter_url',
      'farcaster',
      'farcaster_url',
      'fc_followers',
      'priority_score',
      'lens',
      'github',
      'source',
    ];

    const data = sortedResults.map((result) => ({
      ...result,
      holdings: result.holdings?.toFixed(2) || '',
      priority_score: result.priority_score?.toFixed(2) || '',
      source: result.source.join(','),
    }));

    const csv = exportToCSV(data, headers);

    // Create and trigger download
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `wallet-social-lookup-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleExportTwitterList = () => {
    // Filter results that have Twitter handles and extract them
    const twitterHandles = sortedResults
      .filter((r) => r.twitter_handle)
      .map((r) => `@${r.twitter_handle}`);

    if (twitterHandles.length === 0) {
      alert('No Twitter handles found to export');
      return;
    }

    // Create text file with one handle per line
    const content = twitterHandles.join('\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `twitter-handles-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const twitterCount = results.filter((r) => r.twitter_handle).length;

  return (
    <div className="flex gap-2">
      {isPaidTier ? (
        <Button
          variant="outline"
          onClick={handleExportTwitterList}
          disabled={disabled || twitterCount === 0}
          title={`Export ${twitterCount} Twitter handles`}
        >
          <svg
            className="w-4 h-4 mr-2"
            fill="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
          Export Twitter List ({twitterCount})
        </Button>
      ) : (
        <Button
          variant="outline"
          onClick={onUpgradeClick}
          title="Upgrade to export Twitter list"
        >
          <Lock className="w-4 h-4 mr-2" />
          <svg
            className="w-4 h-4 mr-1"
            fill="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
          Twitter List (Pro)
        </Button>
      )}
      <Button onClick={handleExportCSV} disabled={disabled || results.length === 0}>
        <svg
          className="w-4 h-4 mr-2"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
          />
        </svg>
        Export CSV
      </Button>
    </div>
  );
}
