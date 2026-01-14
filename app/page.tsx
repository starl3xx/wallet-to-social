'use client';

import { useState, useCallback, useRef } from 'react';
import { FileUpload } from '@/components/FileUpload';
import { ProgressBar } from '@/components/ProgressBar';
import { ResultsTable } from '@/components/ResultsTable';
import { ExportButton } from '@/components/ExportButton';
import { StatsCards } from '@/components/StatsCards';
import { LookupHistory } from '@/components/LookupHistory';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  const [cacheHits, setCacheHits] = useState(0);
  const [saveToHistory, setSaveToHistory] = useState(true);
  const [includeENS, setIncludeENS] = useState(false);
  const [lookupName, setLookupName] = useState('');
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
    setCacheHits(0);
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
        body: JSON.stringify({
          wallets,
          originalData,
          saveToHistory,
          historyName: lookupName || undefined,
          includeENS,
        }),
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
              setCacheHits(data.stats.cacheHits || 0);
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

            case 'info':
              console.info('Info:', data.message);
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
  }, [wallets, originalData, saveToHistory, lookupName, includeENS]);

  const handleCancel = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const handleReset = useCallback(() => {
    setWallets([]);
    setOriginalData({});
    setExtraColumns([]);
    setResults([]);
    setError(null);
    setCacheHits(0);
    setLookupName('');
    setIncludeENS(false);
    setProgress({
      total: 0,
      processed: 0,
      twitterFound: 0,
      farcasterFound: 0,
      status: 'idle',
    });
    setState('upload');
  }, []);

  const handleLoadHistory = useCallback((loadedResults: WalletSocialResult[]) => {
    setResults(loadedResults);
    setExtraColumns([]);
    setCacheHits(0);
    setState('complete');
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto py-8 px-4 max-w-6xl">
        <header className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Wallet → Social lookup</h1>
          <p className="text-muted-foreground">
            Upload a CSV of Ethereum wallet addresses to find associated 𝕏/Twitter + Farcaster profiles
          </p>
        </header>

        <main className="space-y-6">
          {/* Upload State */}
          {state === 'upload' && (
            <div className="grid gap-6 md:grid-cols-[1fr,300px]">
              <FileUpload onFileLoaded={handleFileLoaded} />
              <LookupHistory onLoadLookup={handleLoadHistory} />
            </div>
          )}

          {/* Ready State */}
          {state === 'ready' && (
            <div className="space-y-4">
              <div className="p-4 bg-muted rounded-lg space-y-4">
                <div className="flex items-center justify-between">
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
                  <Button variant="outline" onClick={handleReset}>
                    Choose different file
                  </Button>
                </div>

                <div className="flex flex-wrap items-center gap-4 pt-2 border-t">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="saveHistory"
                      checked={saveToHistory}
                      onChange={(e) => setSaveToHistory(e.target.checked)}
                      className="rounded"
                    />
                    <label htmlFor="saveHistory" className="text-sm">
                      Save to history
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="includeENS"
                      checked={includeENS}
                      onChange={(e) => setIncludeENS(e.target.checked)}
                      className="rounded"
                    />
                    <label htmlFor="includeENS" className="text-sm" title="Query ENS text records onchain for Twitter handles (slower but most accurate)">
                      ENS onchain lookup
                    </label>
                  </div>
                  {saveToHistory && (
                    <Input
                      placeholder="Lookup name (optional)"
                      value={lookupName}
                      onChange={(e) => setLookupName(e.target.value)}
                      className="max-w-xs"
                    />
                  )}
                  <div className="flex-1" />
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
                <div>
                  <h2 className="text-xl font-semibold">Results</h2>
                  {cacheHits > 0 && (
                    <p className="text-sm text-muted-foreground">
                      {cacheHits.toLocaleString()} results from cache (24h)
                    </p>
                  )}
                </div>
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

        <footer className="mt-12 pt-6 border-t text-center text-sm text-muted-foreground space-y-2">
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
            {' · Results cached for 24 hours'}
          </p>
          <p>
            made with 🌠 by{' '}
            <a
              href="https://x.com/starl3xx"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground"
            >
              starl3xx
            </a>
          </p>
        </footer>
      </div>
    </div>
  );
}
