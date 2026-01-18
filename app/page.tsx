'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import Image from 'next/image';
import { FileUpload } from '@/components/FileUpload';
import { ProgressBar } from '@/components/ProgressBar';
import { ResultsTable } from '@/components/ResultsTable';
import { ExportButton } from '@/components/ExportButton';
import { StatsCards } from '@/components/StatsCards';
import { LookupHistory } from '@/components/LookupHistory';
import { RecentWins } from '@/components/RecentWins';
import { ThemeToggle } from '@/components/ThemeToggle';
import { UpgradeModal } from '@/components/UpgradeModal';
import { AddAddressesModal } from '@/components/AddAddressesModal';
import { AccessBanner } from '@/components/AccessBanner';
import { getUserId } from '@/lib/user-id';
import { TIER_LIMITS, type UserTier } from '@/lib/access';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Pencil, Plus, Check, X } from 'lucide-react';
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

  // Paste addresses mode
  const [showPasteInput, setShowPasteInput] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [inputSource, setInputSource] = useState<'file_upload' | 'text_input'>('file_upload');

  // Add addresses modal state
  const [showAddAddressesModal, setShowAddAddressesModal] = useState(false);
  const [addAddressesLookupId, setAddAddressesLookupId] = useState<string | null>(null);
  const [addAddressesExistingWallets, setAddAddressesExistingWallets] = useState<string[]>([]);

  // Current lookup tracking (for results view)
  const [currentLookupId, setCurrentLookupId] = useState<string | null>(null);
  const [currentLookupName, setCurrentLookupName] = useState<string | null>(null);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState('');
  const [enrichedWallets, setEnrichedWallets] = useState<Set<string>>(new Set());

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
            // Note: We don't have the lookup ID here, but the name would need to be stored
            // For now, load from history to get full edit/add functionality
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

            // Build message with stage info (same format as polling)
            const message = data.progress.stage
              ? `Processing: ${data.progress.stage} (${data.progress.processed}/${data.progress.total})`
              : `Processing ${data.progress.processed}/${data.progress.total} wallets...`;

            setProgress({
              total: data.progress.total,
              processed: data.progress.processed,
              twitterFound: data.stats.twitterFound,
              farcasterFound: data.stats.farcasterFound,
              status: 'processing',
              message,
            });

            // Estimate start time based on progress for time remaining calculation
            const progressRatio = data.progress.total > 0 ? data.progress.processed / data.progress.total : 0;
            setStartTime(Date.now() - progressRatio * 60000);
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

  // Memoized callback for opening upgrade modal - avoids creating new function on each render
  const handleOpenUpgradeModal = useCallback(() => {
    setShowUpgradeModal(true);
  }, []);

  const [displayedProcessed, setDisplayedProcessed] = useState(0);
  const [startTime, setStartTime] = useState<number | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // Estimate processing time: ~10 seconds per 1000 wallets (conservative)
  // Actual: ~7s worst case, ~4.5s with typical cache hits
  // Web3.bio + Neynar run in parallel, cache speeds things up significantly
  const estimateTime = (walletCount: number): string => {
    const seconds = Math.ceil((walletCount / 1000) * 10) + 5; // 10s per 1K + 5s overhead
    if (seconds < 30) return 'less than 30 seconds';
    if (seconds < 60) return 'less than a minute';
    const minutes = Math.ceil(seconds / 60);
    if (minutes === 1) return '~1 minute';
    if (minutes < 60) return `~${minutes} minutes`;
    const hours = Math.floor(minutes / 60);
    const remainingMins = minutes % 60;
    if (remainingMins === 0) return `~${hours} hour${hours > 1 ? 's' : ''}`;
    return `~${hours}h ${remainingMins}m`;
  };

  // Extract all valid Ethereum addresses from text (anywhere in the text)
  const extractAddresses = (text: string): string[] => {
    if (!text.trim()) return [];
    const matches = text.match(/0x[a-fA-F0-9]{40}/gi) || [];
    return [...new Set(matches.map(addr => addr.toLowerCase()))];
  };

  // Count valid Ethereum addresses in pasted text
  const countValidAddresses = (text: string): number => {
    return extractAddresses(text).length;
  };

  // Handle loading addresses from paste input
  const handlePasteAddresses = useCallback(() => {
    const unique = extractAddresses(pasteText);

    if (unique.length === 0) {
      setError('No valid Ethereum addresses found');
      return;
    }

    setWallets(unique);
    setOriginalData({});
    setExtraColumns([]);
    setInputSource('text_input');
    setState('ready');
    setShowPasteInput(false);
  }, [pasteText]);

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
      setInputSource('file_upload');
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
          inputSource,
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
  }, [wallets, originalData, saveToHistory, lookupName, includeENS, userTier, userEmail, inputSource]);

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

        // Only update progress if values actually changed - prevents unnecessary re-renders
        setProgress((prev) => {
          const newMessage = data.progress.stage
            ? `Processing: ${data.progress.stage} (${data.progress.processed}/${data.progress.total})`
            : `Processing ${data.progress.processed}/${data.progress.total} wallets...`;

          // Check if any values changed
          if (
            prev.processed === data.progress.processed &&
            prev.total === data.progress.total &&
            prev.twitterFound === data.stats.twitterFound &&
            prev.farcasterFound === data.stats.farcasterFound &&
            prev.message === newMessage
          ) {
            return prev; // Return same reference - no re-render
          }

          return {
            ...prev,
            processed: data.progress.processed,
            total: data.progress.total,
            twitterFound: data.stats.twitterFound,
            farcasterFound: data.stats.farcasterFound,
            message: newMessage,
          };
        });

        if (data.status === 'completed') {
          // Job complete - stop polling and show results
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }

          setJobId(null); // Clear localStorage

          // Check if we need to merge with an existing lookup
          const pendingMergeLookupId = localStorage.getItem('pendingMergeLookupId');
          if (pendingMergeLookupId) {
            localStorage.removeItem('pendingMergeLookupId');

            // Fetch existing results and merge
            try {
              const existingRes = await fetch(`/api/history/${pendingMergeLookupId}`);
              if (existingRes.ok) {
                const existingData = await existingRes.json();
                const existingResults: WalletSocialResult[] = existingData.results || [];
                const newResults: WalletSocialResult[] = data.results || [];

                // Merge results (new takes precedence, merge sources)
                const resultMap = new Map<string, WalletSocialResult>();
                existingResults.forEach(r => resultMap.set(r.wallet.toLowerCase(), r));
                newResults.forEach(r => {
                  const key = r.wallet.toLowerCase();
                  const existing = resultMap.get(key);
                  if (existing) {
                    // Merge sources
                    const mergedSources = [...new Set([...existing.source, ...r.source])];
                    resultMap.set(key, { ...existing, ...r, source: mergedSources });
                  } else {
                    resultMap.set(key, r);
                  }
                });
                const mergedResults = Array.from(resultMap.values());

                // Update the lookup in the database
                await fetch(`/api/history/${pendingMergeLookupId}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ results: mergedResults }),
                });

                setResults(mergedResults);
              } else {
                // Fallback to just showing new results
                setResults(data.results || []);
              }
            } catch (err) {
              console.error('Failed to merge results:', err);
              setResults(data.results || []);
            }
          } else {
            setResults(data.results || []);
          }

          setCacheHits(data.stats.cacheHits || 0);
          setProgress((prev) => ({
            ...prev,
            status: 'complete',
            processed: data.progress.total,
          }));
          // Set lookup name for exports (but no ID means no edit/add addresses until loaded from history)
          if (saveToHistory && lookupName) {
            setCurrentLookupName(lookupName);
          }
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
  }, [jobId, state, notifyOnComplete, saveToHistory, lookupName]);

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
    setShowPasteInput(false);
    setPasteText('');
    setCurrentLookupId(null);
    setCurrentLookupName(null);
    setIsEditingName(false);
    setEditNameValue('');
    setEnrichedWallets(new Set());
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
    (loadedResults: WalletSocialResult[], lookupId?: string, lookupName?: string | null, enrichedWalletsArray?: string[]) => {
      setResults(loadedResults);
      setExtraColumns([]);
      setCacheHits(0);
      setCurrentLookupId(lookupId || null);
      setCurrentLookupName(lookupName || null);
      // Convert array to Set for efficient lookup
      setEnrichedWallets(new Set(enrichedWalletsArray?.map(w => w.toLowerCase()) || []));
      setState('complete');
    },
    []
  );

  // Handle opening the add addresses modal
  const handleOpenAddAddresses = useCallback(async (lookupId: string) => {
    // Fetch the existing results for this lookup
    try {
      const res = await fetch(`/api/history/${lookupId}`);
      if (!res.ok) throw new Error('Failed to fetch lookup');
      const data = await res.json();
      const existingWallets = (data.results as WalletSocialResult[]).map(r => r.wallet);
      setAddAddressesLookupId(lookupId);
      setAddAddressesExistingWallets(existingWallets);
      setShowAddAddressesModal(true);
    } catch (err) {
      console.error('Failed to load lookup for add addresses:', err);
    }
  }, []);

  // Handle adding addresses to existing lookup
  const handleAddToLookup = useCallback(async (lookupId: string, newAddresses: string[]) => {
    if (newAddresses.length === 0) return;

    // Set up for processing the new addresses
    setWallets(newAddresses);
    setOriginalData({});
    setExtraColumns([]);
    setState('processing');
    setResults([]);
    setCacheHits(0);
    setJobId(null);
    setDisplayedProcessed(0);
    setStartTime(Date.now());
    setProgress({
      total: newAddresses.length,
      processed: 0,
      twitterFound: 0,
      farcasterFound: 0,
      status: 'processing',
      message: 'Submitting job...',
    });

    try {
      // Submit job for new addresses only (don't save to history, we'll merge)
      const response = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallets: newAddresses,
          originalData: {},
          saveToHistory: false, // Don't save - we'll merge
          includeENS,
          userId: getUserId(),
          email: userEmail || undefined,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        if (errorData.upgradeRequired) {
          setShowUpgradeModal(true);
          setState('ready');
          return;
        }
        throw new Error(errorData.error || `HTTP error: ${response.status}`);
      }

      const { jobId: newJobId } = await response.json();

      // Store the lookup ID we're updating for when job completes
      localStorage.setItem('pendingMergeLookupId', lookupId);

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
  }, [includeENS, userEmail]);

  // Handle creating new lookup from modal
  const handleCreateNewFromModal = useCallback((addresses: string[]) => {
    if (addresses.length === 0) return;
    setWallets(addresses);
    setOriginalData({});
    setExtraColumns([]);
    setState('ready');
  }, []);

  // Handle saving the lookup name
  const handleSaveLookupName = useCallback(async () => {
    if (!currentLookupId) return;

    try {
      const res = await fetch(`/api/history/${currentLookupId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editNameValue }),
      });

      if (res.ok) {
        setCurrentLookupName(editNameValue || null);
        setIsEditingName(false);
      }
    } catch (err) {
      console.error('Failed to save lookup name:', err);
    }
  }, [currentLookupId, editNameValue]);

  // Handle opening add addresses from results view
  const handleAddAddressesFromResults = useCallback(async () => {
    if (!currentLookupId) return;

    // Use current results as the existing wallets
    const existingWallets = results.map(r => r.wallet);
    setAddAddressesLookupId(currentLookupId);
    setAddAddressesExistingWallets(existingWallets);
    setShowAddAddressesModal(true);
  }, [currentLookupId, results]);

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto py-8 px-4 max-w-6xl">
        <header className="mb-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div
                className="flex items-center gap-3 mb-2 cursor-pointer"
                onClick={handleReset}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && handleReset()}
              >
                <Image
                  src="/icon.png"
                  alt="walletlink.social"
                  width={40}
                  height={40}
                  className="rounded-lg"
                />
                <h1 className="text-3xl font-bold hover:text-accent-brand transition-colors">
                  walletlink.social
                </h1>
              </div>
              <p className="text-muted-foreground">
                Turn your wallet list into Twitter handles and Farcaster
                profiles.{' '}
                <a
                  href="/vs/addressable"
                  className="underline hover:text-foreground"
                >
                  Simple alternative to Addressable
                </a>
                .
              </p>
            </div>
            <div className="flex items-center gap-3">
              <AccessBanner
                tier={userTier}
                isWhitelisted={isWhitelisted}
                onUpgradeClick={handleOpenUpgradeModal}
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

        {/* Add Addresses Modal */}
        {addAddressesLookupId && (
          <AddAddressesModal
            open={showAddAddressesModal}
            onOpenChange={setShowAddAddressesModal}
            lookupId={addAddressesLookupId}
            existingWallets={addAddressesExistingWallets}
            onAddToLookup={handleAddToLookup}
            onCreateNewLookup={handleCreateNewFromModal}
          />
        )}

        <main className="space-y-6">
          {/* Upload State */}
          {state === 'upload' && (
            <div className="space-y-6">
              <FileUpload onFileLoaded={handleFileLoaded} />

              {/* Paste alternative */}
              <div className="text-center">
                <div className="flex items-center gap-4 my-4">
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-sm text-muted-foreground">or</span>
                  <div className="flex-1 h-px bg-border" />
                </div>

                {!showPasteInput ? (
                  <button
                    onClick={() => setShowPasteInput(true)}
                    className="text-sm text-muted-foreground hover:text-foreground underline"
                  >
                    Don&apos;t have a spreadsheet? Paste a list of addresses instead
                  </button>
                ) : (
                  <div className="space-y-3 p-4 border rounded-lg bg-muted/30 text-left">
                    <textarea
                      value={pasteText}
                      onChange={(e) => setPasteText(e.target.value)}
                      placeholder={"Paste wallet addresses in any format\n0x1234..., 0xabcd...\nor one per line\nor mixed with other text"}
                      className="w-full h-40 p-3 text-sm font-mono border rounded-lg resize-none bg-background"
                    />
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">
                        {countValidAddresses(pasteText)} valid addresses detected
                      </span>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => {
                          setShowPasteInput(false);
                          setPasteText('');
                        }}>
                          Cancel
                        </Button>
                        <Button size="sm" onClick={handlePasteAddresses} disabled={countValidAddresses(pasteText) === 0}>
                          Load Addresses
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <RecentWins />
              <LookupHistory onLoadLookup={handleLoadHistory} userTier={userTier} onAddAddresses={handleOpenAddAddresses} />
            </div>
          )}

          {/* Ready State */}
          {state === 'ready' && (
            <div className="space-y-4">
              {/* Wallet limit warning */}
              {wallets.length > TIER_LIMITS[userTier] && (
                <div className="p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg flex items-center justify-between gap-4">
                  <p className="text-sm text-amber-800 dark:text-amber-200">
                    Your file has{' '}
                    <span className="font-semibold">
                      {wallets.length.toLocaleString()}
                    </span>{' '}
                    wallets but the {userTier} plan allows a maximum of{' '}
                    <span className="font-semibold">
                      {TIER_LIMITS[userTier].toLocaleString()}
                    </span>
                    . Upgrade to process all wallets.
                  </p>
                  <Button
                    size="sm"
                    onClick={() => setShowUpgradeModal(true)}
                    className="shrink-0"
                  >
                    Upgrade
                  </Button>
                </div>
              )}

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
                  {/* Lookup name with edit capability */}
                  {isEditingName ? (
                    <div className="flex items-center gap-2">
                      <Input
                        value={editNameValue}
                        onChange={(e) => setEditNameValue(e.target.value)}
                        placeholder="Enter lookup name..."
                        className="max-w-xs h-8"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveLookupName();
                          if (e.key === 'Escape') setIsEditingName(false);
                        }}
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleSaveLookupName}
                        className="h-8 w-8 p-0"
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setIsEditingName(false)}
                        className="h-8 w-8 p-0"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl font-semibold">
                        {currentLookupName || 'Results'}
                      </h2>
                      {currentLookupId && (userTier === 'pro' || userTier === 'unlimited') && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditNameValue(currentLookupName || '');
                            setIsEditingName(true);
                          }}
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                          title="Edit lookup name"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  )}
                  {cacheHits > 0 && (
                    <p className="text-sm text-muted-foreground">
                      {cacheHits.toLocaleString()} results from cache (24h)
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  {/* Add addresses button (paid users only, when viewing a saved lookup) */}
                  {currentLookupId && (userTier === 'pro' || userTier === 'unlimited') && (
                    <Button
                      variant="outline"
                      onClick={handleAddAddressesFromResults}
                      title="Add more addresses to this lookup"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Add addresses
                    </Button>
                  )}
                  <Button variant="outline" onClick={handleReset}>
                    New Lookup
                  </Button>
                  <ExportButton
                    results={results}
                    extraColumns={extraColumns}
                    userTier={userTier}
                    onUpgradeClick={handleOpenUpgradeModal}
                    lookupName={currentLookupName}
                  />
                </div>
              </div>

              <StatsCards results={results} />
              <ResultsTable
                results={results}
                extraColumns={extraColumns}
                userTier={userTier}
                onUpgradeClick={handleOpenUpgradeModal}
                enrichedWallets={enrichedWallets}
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
