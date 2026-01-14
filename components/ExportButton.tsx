'use client';

import { Button } from '@/components/ui/button';
import { exportToCSV } from '@/lib/csv-parser';
import type { WalletSocialResult } from '@/lib/types';

interface ExportButtonProps {
  results: WalletSocialResult[];
  extraColumns?: string[];
  disabled?: boolean;
}

export function ExportButton({ results, extraColumns = [], disabled }: ExportButtonProps) {
  const handleExport = () => {
    const headers = [
      'wallet',
      'ens_name',
      ...extraColumns,
      'twitter_handle',
      'twitter_url',
      'farcaster',
      'farcaster_url',
      'fc_followers',
      'lens',
      'github',
      'source',
    ];

    const data = results.map((result) => ({
      ...result,
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

  return (
    <Button onClick={handleExport} disabled={disabled || results.length === 0}>
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
  );
}
