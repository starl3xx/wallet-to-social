'use client';

import { useState, useCallback, useRef } from 'react';
import { FileUpload } from '@/components/FileUpload';
import { ProgressBar } from '@/components/ProgressBar';
import { ResultsTable } from '@/components/ResultsTable';
import { ExportButton } from '@/components/ExportButton';
import { StatsCards } from '@/components/StatsCards';
import { Button } from '@/components/ui/button';
import { parseCSV } from '@/lib/csv-parser';
import type { WalletSocialResult, LookupProgress } from '@/lib/types';

type AppState = 'upload' | 'ready' | 'processing' | 'complete' | 'error';

export default function Home() {
  const [state, setState] = useState<AppState>('upload');
  const [wallets, setWallets] = useState<string[]>([]);
  const [originalData, setOriginalData] = useState<Record<string, Record<string, string>>>({});
  const [extraColumns, setExtraColumns] = useState<string[]>([]);
  const [results, setResults] = useState<WalletSocialResult[]>([]);
  const [progress, setProgress] = useState<LookupProgress>({
    total: 0,
    processed: 0,
    twitterFound: 0,
    farcasterFound: 0,
    status: 'idle',
  });
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleFileLoaded = useCallback((content: string, _fileName: string) => {
    setError(null);
    const result = parseCSV(content);

    if (result.error) {
      setError(result.error);
      setState('error');
      return;
    }

    const walletList = result.rows.map((r) => r.wallet);
    setWallets(walletList);

    // Store original data (extra columns)
    const dataMap: Record<string, Record<string, string>> = {};
    const cols: string[] = [];

    for (const row of result.rows) {
      const extra: Record<string, string> = {};
      for (const [key, value] of Object.entries(row)) {
        if (key !== 'wallet' && value) {
          extra[key] = value;
          if (!cols.includes(key)) cols.push(key);
        }
      }
      dataMap[row.wallet] = extra;
    }

    setOriginalData(dataMap);
    setExtraColumns(cols);
    setState('ready');
  }, []);

  const startLookup = useCallback(async () => {
    setState('processing');
    setResults([]);
    setProgress({
      total: wallets.length,
      processed: 0,
      twitterFound: 0,
      farcasterFound: 0,
      status: 'processing',
    });

    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch('/api/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallets, originalData }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('No response body');
      }

      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;

          const eventMatch = line.match(/^event: (.+)$/m);
          const dataMatch = line.match(/^data: (.+)$/m);

          if (!eventMatch || !dataMatch) continue;

          const event = eventMatch[1];
          const data = JSON.parse(dataMatch[1]);

          switch (event) {
            case 'progress':
              setProgress((prev) => ({
                ...prev,
                processed: data.processed,
                twitterFound: data.twitterFound,
                farcasterFound: data.farcasterFound,
                message: data.message,
              }));
              break;

            case 'complete':
              setResults(data.results);
              setProgress((prev) => ({
                ...prev,
                status: 'complete',
                processed: data.stats.total,
                twitterFound: data.stats.twitterFound,
                farcasterFound: data.stats.farcasterFound,
              }));
              setState('complete');
              break;

            case 'warning':
              console.warn('Warning:', data.message);
              break;

            case 'error':
              throw new Error(data.message);
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        setProgress((prev) => ({ ...prev, status: 'cancelled' }));
        setState('ready');
        return;
      }

      console.error('Lookup error:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      setProgress((prev) => ({ ...prev, status: 'error' }));
      setState('error');
    }
  }, [wallets, originalData]);

  const handleCancel = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const handleReset = useCallback(() => {
    setWallets([]);
    setOriginalData({});
    setExtraColumns([]);
    setResults([]);
    setError(null);
    setProgress({
      total: 0,
      processed: 0,
      twitterFound: 0,
      farcasterFound: 0,
      status: 'idle',
    });
    setState('upload');
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto py-8 px-4 max-w-6xl">
        <header className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Wallet Social Lookup</h1>
          <p className="text-muted-foreground">
            Upload a CSV of Ethereum wallet addresses to find associated Twitter and Farcaster profiles
          </p>
        </header>

        <main className="space-y-6">
          {/* Upload State */}
          {state === 'upload' && (
            <FileUpload onFileLoaded={handleFileLoaded} />
          )}

          {/* Ready State */}
          {state === 'ready' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
                <div>
                  <p className="font-medium">
                    {wallets.length.toLocaleString()} wallet addresses loaded
                  </p>
                  {extraColumns.length > 0 && (
                    <p className="text-sm text-muted-foreground">
                      Extra columns: {extraColumns.join(', ')}
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={handleReset}>
                    Choose different file
                  </Button>
                  <Button onClick={startLookup}>Start Lookup</Button>
                </div>
              </div>
            </div>
          )}

          {/* Processing State */}
          {state === 'processing' && (
            <ProgressBar progress={progress} onCancel={handleCancel} />
          )}

          {/* Error State */}
          {state === 'error' && (
            <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
              <p className="text-destructive font-medium mb-2">Error</p>
              <p className="text-sm text-muted-foreground mb-4">
                {error || 'An unknown error occurred'}
              </p>
              <Button variant="outline" onClick={handleReset}>
                Try again
              </Button>
            </div>
          )}

          {/* Complete State */}
          {state === 'complete' && results.length > 0 && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold">Results</h2>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={handleReset}>
                    New Lookup
                  </Button>
                  <ExportButton results={results} extraColumns={extraColumns} />
                </div>
              </div>

              <StatsCards results={results} />
              <ResultsTable results={results} extraColumns={extraColumns} />
            </div>
          )}
        </main>

        <footer className="mt-12 pt-6 border-t text-center text-sm text-muted-foreground">
          <p>
            Data sourced from{' '}
            <a
              href="https://web3.bio"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground"
            >
              Web3.bio
            </a>
            {' and '}
            <a
              href="https://neynar.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground"
            >
              Neynar
            </a>
          </p>
        </footer>
      </div>
    </div>
  );
}
