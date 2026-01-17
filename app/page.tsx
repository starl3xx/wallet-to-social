'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { FileUpload } from '@/components/FileUpload';
import { ProgressBar } from '@/components/ProgressBar';
import { ResultsTable } from '@/components/ResultsTable';
import { ExportButton } from '@/components/ExportButton';
import { StatsCards } from '@/components/StatsCards';
import { LookupHistory } from '@/components/LookupHistory';
import { RecentWins } from '@/components/RecentWins';
import { ThemeToggle } from '@/components/ThemeToggle';
import { UpgradeModal } from '@/components/UpgradeModal';
import { AccessBanner } from '@/components/AccessBanner';
import { getUserId } from '@/lib/user-id';
import { TIER_LIMITS, type UserTier } from '@/lib/access';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { parseFile } from '@/lib/file-parser';
import {
  canNotify,
  requestPermission,
  sendNotification,
} from '@/lib/notifications';
import type { WalletSocialResult, LookupProgress } from '@/lib/types';

type AppState = 'upload' | 'ready' | 'processing' | 'complete' | 'error';

export default function Home() {
  const [state, setState] = useState<AppState>('upload');
  const [wallets, setWallets] = useState<string[]>([]);
  const [originalData, setOriginalData] = useState<
    Record<string, Record<string, string>>
  >({});
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
  const [notifyOnComplete, setNotifyOnComplete] = useState(false);
  const [jobId, setJobIdState] = useState<string | null>(null);

  // User access state
  const [userTier, setUserTier] = useState<UserTier>('free');
  const [isWhitelisted, setIsWhitelisted] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  // Persist jobId to localStorage so it survives page refresh
  const setJobId = (id: string | null) => {
    setJobIdState(id);
    if (id) {
      localStorage.setItem('currentJobId', id);
    } else {
      localStorage.removeItem('currentJobId');
    }
  };

  // Restore jobId from localStorage on mount
  useEffect(() => {
    const savedJobId = localStorage.getItem('currentJobId');
    if (savedJobId) {
      // Check if job still exists and get its status
      fetch(`/api/jobs/${savedJobId}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.status === 'completed') {
            // Job finished while away - show results
            setResults(data.results || []);
            setCacheHits(data.stats?.cacheHits || 0);
            setState('complete');
            localStorage.removeItem('currentJobId');
          } else if (data.status === 'failed') {
            // Job failed
            setError(data.error || 'Job failed');
            setState('error');
            localStorage.removeItem('currentJobId');
          } else if (data.status === 'pending' || data.status === 'processing') {
            // Job still running - resume watching
            setJobIdState(savedJobId);
            setProgress({
              total: data.progress.total,
              processed: data.progress.processed,
              twitterFound: data.stats.twitterFound,
              farcasterFound: data.stats.farcasterFound,
              status: 'processing',
            });
            setStartTime(Date.now() - (data.progress.processed / data.progress.total) * 60000); // Estimate start time
            setState('processing');
          } else {
            // Unknown status or job not found - clear
            localStorage.removeItem('currentJobId');
          }
        })
        .catch(() => {
          // Job not found - clear
          localStorage.removeItem('currentJobId');
        });
    }
  }, []);

  // Check user access level on mount
  useEffect(() => {
    const email = localStorage.getItem('user_email');
    if (email) {
      setUserEmail(email);
      fetch(`/api/auth/check-access?email=${encodeURIComponent(email)}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.tier) {
            setUserTier(data.tier);
            setIsWhitelisted(data.isWhitelisted || false);
          }
        })
        .catch(console.error);
    }
  }, []);

  // Handle restore access from upgrade modal
  const handleRestoreAccess = useCallback((email: string) => {
    setUserEmail(email);
    fetch(`/api/auth/check-access?email=${encodeURIComponent(email)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.tier) {
          setUserTier(data.tier);
          setIsWhitelisted(data.isWhitelisted || false);
        }
      })
      .catch(console.error);
  }, []);

  const [displayedProcessed, setDisplayedProcessed] = useState(0);
  const [startTime, setStartTime] = useState<number | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // Estimate processing time: ~2 min per 1000 wallets (conservative)
  const estimateTime = (walletCount: number): string => {
    const minutes = Math.ceil((walletCount / 1000) * 2);
    if (minutes < 1) return 'less than a minute';
    if (minutes === 1) return '~1 minute';
    if (minutes < 60) return `~${minutes} minutes`;
    const hours = Math.floor(minutes / 60);
    const remainingMins = minutes % 60;
    if (remainingMins === 0) return `~${hours} hour${hours > 1 ? 's' : ''}`;
    return `~${hours}h ${remainingMins}m`;
  };

  // Calculate time remaining based on actual processing rate
  const getTimeRemaining = (): string | null => {
    if (!startTime || progress.processed === 0) return null;
    const elapsed = (Date.now() - startTime) / 1000; // seconds
    const rate = progress.processed / elapsed; // wallets per second
    if (rate <= 0) return null;
    const remaining = (progress.total - progress.processed) / rate;
    const minutes = Math.ceil(remaining / 60);
    if (minutes < 1) return 'less than a minute';
    if (minutes === 1) return '~1 minute remaining';
    if (minutes < 60) return `~${minutes} minutes remaining`;
    const hours = Math.floor(minutes / 60);
    const remainingMins = minutes % 60;
    if (remainingMins === 0) return `~${hours}h remaining`;
    return `~${hours}h ${remainingMins}m remaining`;
  };
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleFileLoaded = useCallback(async (file: File) => {
    setError(null);

    try {
      const result = await parseFile(file);

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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse file');
      setState('error');
    }
  }, []);

  const startLookup = useCallback(async () => {
    // Check tier limit before starting
    const walletLimit = TIER_LIMITS[userTier];
    if (wallets.length > walletLimit) {
      setShowUpgradeModal(true);
      return;
    }

    setState('processing');
    setResults([]);
    setCacheHits(0);
    setJobId(null);
    setDisplayedProcessed(0);
    setStartTime(Date.now());
    setProgress({
      total: wallets.length,
      processed: 0,
      twitterFound: 0,
      farcasterFound: 0,
      status: 'processing',
      message: 'Submitting job...',
    });

    try {
      // Submit job to queue
      const response = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallets,
          originalData,
          saveToHistory,
          historyName: lookupName || undefined,
          includeENS,
          userId: getUserId(),
          email: userEmail || undefined,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        // Handle upgrade required response
        if (errorData.upgradeRequired) {
          setShowUpgradeModal(true);
          setState('ready');
          return;
        }
        throw new Error(errorData.error || `HTTP error: ${response.status}`);
      }

      const { jobId: newJobId } = await response.json();
      setJobId(newJobId);
      setProgress((prev) => ({
        ...prev,
        message: 'Job queued - processing will start shortly...',
      }));
    } catch (err) {
      console.error('Job submission error:', err);
      setError(err instanceof Error ? err.message : 'Failed to submit job');
      setProgress((prev) => ({ ...prev, status: 'error' }));
      setState('error');
    }
  }, [wallets, originalData, saveToHistory, lookupName, includeENS, userTier, userEmail]);

  // Poll for job status when jobId is set
  useEffect(() => {
    if (!jobId || state !== 'processing') {
      return;
    }

    const pollJobStatus = async () => {
      try {
        const response = await fetch(`/api/jobs/${jobId}`);
        if (!response.ok) {
          throw new Error(`HTTP error: ${response.status}`);
        }

        const data = await response.json();

        // Update progress
        setProgress((prev) => ({
          ...prev,
          processed: data.progress.processed,
          total: data.progress.total,
          twitterFound: data.stats.twitterFound,
          farcasterFound: data.stats.farcasterFound,
          message: data.progress.stage
            ? `Processing: ${data.progress.stage} (${data.progress.processed}/${data.progress.total})`
            : `Processing ${data.progress.processed}/${data.progress.total} wallets...`,
        }));

        if (data.status === 'completed') {
          // Job complete - stop polling and show results
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }

          setJobId(null); // Clear localStorage
          setResults(data.results || []);
          setCacheHits(data.stats.cacheHits || 0);
          setProgress((prev) => ({
            ...prev,
            status: 'complete',
            processed: data.progress.total,
          }));
          setState('complete');

          // Send browser notification if enabled
          if (notifyOnComplete) {
            sendNotification('Lookup Complete', {
              body: `Found ${data.stats.twitterFound} Twitter and ${data.stats.farcasterFound} Farcaster accounts from ${data.progress.total} wallets`,
            });
          }
        } else if (data.status === 'failed') {
          // Job failed - stop polling and show error
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }

          setJobId(null); // Clear localStorage
          setError(data.error || 'Job failed');
          setProgress((prev) => ({ ...prev, status: 'error' }));
          setState('error');
        }
        // If still pending/processing, continue polling
      } catch (err) {
        console.error('Poll error:', err);
        // Don't stop polling on transient errors
      }
    };

    // Poll immediately, then every 2 seconds
    pollJobStatus();
    pollingRef.current = setInterval(pollJobStatus, 2000);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [jobId, state, notifyOnComplete]);

  // Animate progress counter smoothly toward real value
  useEffect(() => {
    if (state !== 'processing') {
      setDisplayedProcessed(progress.processed);
      return;
    }

    // If we're behind the real progress, animate toward it
    if (displayedProcessed < progress.processed) {
      const diff = progress.processed - displayedProcessed;
      const increment = Math.max(1, Math.ceil(diff / 20)); // Catch up in ~20 frames

      const timer = setTimeout(() => {
        setDisplayedProcessed((prev) =>
          Math.min(prev + increment, progress.processed)
        );
      }, 50); // 20fps animation

      return () => clearTimeout(timer);
    }
  }, [displayedProcessed, progress.processed, state]);

  const handleCancel = useCallback(() => {
    // Stop polling
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    setJobId(null);
    setProgress((prev) => ({ ...prev, status: 'cancelled' }));
    setState('ready');
  }, []);

  const handleReset = useCallback(() => {
    // Stop any active polling
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    setJobId(null);
    setStartTime(null);
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

  const handleLoadHistory = useCallback(
    (loadedResults: WalletSocialResult[]) => {
      setResults(loadedResults);
      setExtraColumns([]);
      setCacheHits(0);
      setState('complete');
    },
    []
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto py-8 px-4 max-w-6xl">
        <header className="mb-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold mb-2">Wallet → Social lookup</h1>
              <p className="text-muted-foreground">
                Upload a CSV of Ethereum wallet addresses to find associated
                𝕏/Twitter + Farcaster profiles
              </p>
            </div>
            <div className="flex items-center gap-3">
              <AccessBanner
                tier={userTier}
                isWhitelisted={isWhitelisted}
                onUpgradeClick={() => setShowUpgradeModal(true)}
              />
              <ThemeToggle />
            </div>
          </div>
        </header>

        {/* Upgrade Modal */}
        <UpgradeModal
          open={showUpgradeModal}
          onOpenChange={setShowUpgradeModal}
          currentTier={userTier}
          walletCount={wallets.length > 0 ? wallets.length : undefined}
          onRestoreAccess={handleRestoreAccess}
        />

        <main className="space-y-6">
          {/* Upload State */}
          {state === 'upload' && (
            <div className="space-y-6">
              <FileUpload onFileLoaded={handleFileLoaded} />
              <RecentWins />
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
                    <p className="text-sm text-muted-foreground">
                      Estimated processing time: {estimateTime(wallets.length)}
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
                    <label
                      htmlFor="includeENS"
                      className="text-sm"
                      title="Query ENS text records onchain for Twitter handles (slower but most accurate)"
                    >
                      ENS onchain lookup
                    </label>
                  </div>
                  {includeENS && wallets.length > 1000 && (
                    <span className="text-xs text-amber-600 dark:text-amber-400">
                      Note: ENS lookups are slower for large batches
                    </span>
                  )}
                  {canNotify() && (
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="notifyOnComplete"
                        checked={notifyOnComplete}
                        onChange={async (e) => {
                          if (e.target.checked) {
                            const granted = await requestPermission();
                            setNotifyOnComplete(granted);
                          } else {
                            setNotifyOnComplete(false);
                          }
                        }}
                        className="rounded"
                      />
                      <label
                        htmlFor="notifyOnComplete"
                        className="text-sm"
                        title="Get a browser notification when lookup finishes"
                      >
                        Notify when done
                      </label>
                    </div>
                  )}
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
            <ProgressBar progress={progress} displayedProcessed={displayedProcessed} timeRemaining={getTimeRemaining()} onCancel={handleCancel} />
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
                  <ExportButton
                    results={results}
                    extraColumns={extraColumns}
                    userTier={userTier}
                    onUpgradeClick={() => setShowUpgradeModal(true)}
                  />
                </div>
              </div>

              <StatsCards results={results} />
              <ResultsTable
                results={results}
                extraColumns={extraColumns}
                userTier={userTier}
                onUpgradeClick={() => setShowUpgradeModal(true)}
              />
            </div>
          )}
        </main>

        <footer className="mt-12 pt-6 border-t text-center text-sm text-muted-foreground">
          <p>
            made with 🌠 by{' '}
            <a
              href="https://x.com/starl3xx"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground"
            >
              @starl3xx
            </a>
          </p>
        </footer>
      </div>
    </div>
  );
}
