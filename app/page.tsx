'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import { ProgressBar } from '@/components/ProgressBar';
import { ResultsTable } from '@/components/ResultsTable';
import { ExportButton } from '@/components/ExportButton';
import { ShareButtons } from '@/components/ShareButtons';
import { StatsCards } from '@/components/StatsCards';
import { LookupHistory } from '@/components/LookupHistory';
import { RecentWins } from '@/components/RecentWins';
import { ThemeToggle } from '@/components/ThemeToggle';
import { AccessBanner } from '@/components/AccessBanner';
import { useAuth } from '@/components/AuthProvider';

// Lazy-load modals — not needed until user interaction
const UpgradeModal = dynamic(() => import('@/components/UpgradeModal').then(m => ({ default: m.UpgradeModal })));
const AddAddressesModal = dynamic(() => import('@/components/AddAddressesModal').then(m => ({ default: m.AddAddressesModal })));
const ContractImportModal = dynamic(() => import('@/components/ContractImportModal').then(m => ({ default: m.ContractImportModal })));
const AuthModal = dynamic(() => import('@/components/AuthModal').then(m => ({ default: m.AuthModal })));
const FarcasterDMModal = dynamic(() => import('@/components/FarcasterDMModal').then(m => ({ default: m.FarcasterDMModal })));
import { getUserId } from '@/lib/user-id';
import { Analytics } from '@/lib/client-analytics';
import { TIER_LIMITS, type UserTier } from '@/lib/access';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Pencil, Plus, Check, X, Send } from 'lucide-react';
import { InputMethodPicker } from '@/components/InputMethodPicker';
import { parseFile } from '@/lib/file-parser';
import {
  canNotify,
  requestPermission,
  sendNotification,
  getPermissionStatus,
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
  const [fastMode, setFastMode] = useState(false);
  const [lookupName, setLookupName] = useState('');
  const [notifyOnComplete, setNotifyOnComplete] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('notifyOnComplete') === 'true';
  });
  const [jobId, setJobIdState] = useState<string | null>(null);

  // Live index size for the header stat strip — falls back to the static
  // "4.7M" copy if the public stats fetch fails or returns nothing useful
  const [indexedWallets, setIndexedWallets] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/public-stats')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data || typeof data.total_wallets !== 'number') return;
        // Only trust index-scale numbers; dev/empty databases keep the fallback
        if (data.total_wallets >= 1_000_000) {
          const millions = (data.total_wallets / 1_000_000).toFixed(1);
          setIndexedWallets(`${millions.replace(/\.0$/, '')}M`);
        }
      })
      .catch(() => {
        // Keep the static fallback
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // User access state from AuthProvider
  const { user } = useAuth();
  const userTier: UserTier = user?.tier || 'free';
  const isWhitelisted = user?.isWhitelisted || false;
  const userEmail = user?.email || null;
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  // Paste addresses mode
  const [showPasteInput, setShowPasteInput] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [inputSource, setInputSource] = useState<'file_upload' | 'text_input' | 'contract_import'>('file_upload');

  // Add addresses modal state
  const [showAddAddressesModal, setShowAddAddressesModal] = useState(false);

  // Contract import modal state (Pro and Unlimited)
  const [showContractImportModal, setShowContractImportModal] = useState(false);
  const [addAddressesLookupId, setAddAddressesLookupId] = useState<string | null>(null);
  const [addAddressesExistingWallets, setAddAddressesExistingWallets] = useState<string[]>([]);

  // Auth modal for rate limit prompts
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [rateLimitMessage, setRateLimitMessage] = useState<string | null>(null);

  // Farcaster DM modal (Unlimited tier only)
  const [showFarcasterDMModal, setShowFarcasterDMModal] = useState(false);
  const [enrichingFids, setEnrichingFids] = useState(false);

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
      fetch(`/api/jobs/${savedJobId}?userId=${encodeURIComponent(getUserId())}`)
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

            // Update title to show completion (job finished while away)
            document.title = `✓ Lookup complete - walletlink.social`;
            const resetTitle = () => {
              document.title = 'walletlink.social';
              window.removeEventListener('focus', resetTitle);
            };
            window.addEventListener('focus', resetTitle);
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

  // Memoized callback for opening upgrade modal - avoids creating new function on each render
  const handleOpenUpgradeModal = useCallback(() => {
    setShowUpgradeModal(true);
  }, []);

  const handlePasteToggle = useCallback(() => setShowPasteInput((v) => !v), []);

  // The contract card is shown to everyone. Free accounts get the upgrade
  // modal instead of the importer, so the feature is discoverable before it
  // is bought rather than invisible until after.
  const handleContractCardClick = useCallback(() => {
    if (userTier === 'pro' || userTier === 'unlimited') {
      setShowContractImportModal(true);
    } else {
      setShowUpgradeModal(true);
    }
  }, [userTier]);

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
      // limitHit existed in client-analytics but was never called, so we had no
      // idea how often the free ceiling was actually the blocker.
      Analytics.limitHit(userTier, walletLimit, wallets.length);
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
          fastMode,
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
        // Handle rate limit response
        if (response.status === 429) {
          setRateLimitMessage(errorData.error || 'Rate limit exceeded. Sign in for unlimited access.');
          setShowAuthModal(true);
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
  }, [wallets, originalData, saveToHistory, lookupName, includeENS, fastMode, userTier, userEmail, inputSource]);

  // Adaptive polling interval (starts at 2s, increases to 5s if no progress)
  const pollIntervalRef = useRef(2000);
  const lastProgressRef = useRef(0);
  const pollStartTimeRef = useRef(0);
  const consecutiveErrorsRef = useRef(0);

  // Max time to poll before giving up (10 minutes)
  const MAX_POLL_DURATION_MS = 10 * 60 * 1000;

  // Poll for job status when jobId is set
  useEffect(() => {
    if (!jobId || state !== 'processing') {
      return;
    }

    // Reset polling state when starting
    pollIntervalRef.current = 2000;
    lastProgressRef.current = 0;
    pollStartTimeRef.current = Date.now();
    consecutiveErrorsRef.current = 0;

    const pollJobStatus = async () => {
      // Safety net: stop polling after MAX_POLL_DURATION_MS
      if (Date.now() - pollStartTimeRef.current > MAX_POLL_DURATION_MS) {
        if (pollingRef.current) {
          clearTimeout(pollingRef.current);
          pollingRef.current = null;
        }
        setJobId(null);
        setError('Lookup timed out. Please try again or check History for results.');
        setProgress((prev) => ({ ...prev, status: 'error' }));
        setState('error');
        return;
      }

      try {
        const response = await fetch(`/api/jobs/${jobId}?userId=${encodeURIComponent(getUserId())}`);
        if (!response.ok) {
          throw new Error(`HTTP error: ${response.status}`);
        }

        // Successful response — reset error counter
        consecutiveErrorsRef.current = 0;

        const data = await response.json();

        // Adaptive backoff: if no progress, increase interval (up to 5s)
        // Reset to 2s when progress is detected
        if (data.progress.processed === lastProgressRef.current) {
          // No progress - increase polling interval
          pollIntervalRef.current = Math.min(pollIntervalRef.current + 500, 5000);
        } else {
          // Progress detected - reset to fast polling
          pollIntervalRef.current = 2000;
          lastProgressRef.current = data.progress.processed;
        }

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
            clearTimeout(pollingRef.current);
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
            const permissionStatus = getPermissionStatus();
            if (permissionStatus === 'granted') {
              sendNotification('Lookup complete', {
                body: `Found ${data.stats.twitterFound} Twitter and ${data.stats.farcasterFound} Farcaster accounts from ${data.progress.total} wallets`,
              });
            } else {
              console.log('Notification permission not granted:', permissionStatus);
            }

            // Also update page title as a reliable fallback (works when tab is backgrounded)
            const originalTitle = document.title;
            document.title = `✓ Lookup complete - ${data.stats.twitterFound} Twitter, ${data.stats.farcasterFound} Farcaster`;
            // Reset title when user focuses the window
            const resetTitle = () => {
              document.title = originalTitle;
              window.removeEventListener('focus', resetTitle);
            };
            window.addEventListener('focus', resetTitle);
            // Also reset after 30 seconds in case they don't switch back
            setTimeout(() => {
              if (document.title.startsWith('✓')) {
                document.title = originalTitle;
              }
            }, 30000);
          }
        } else if (data.status === 'failed') {
          // Job failed - stop polling and show error
          if (pollingRef.current) {
            clearTimeout(pollingRef.current);
            pollingRef.current = null;
          }

          setJobId(null); // Clear localStorage
          setError(data.error || 'Job failed');
          setProgress((prev) => ({ ...prev, status: 'error' }));
          setState('error');
        }
        // If still pending/processing, schedule next poll with adaptive interval
        scheduleNextPoll();
      } catch (err) {
        console.error('Poll error:', err);
        consecutiveErrorsRef.current++;
        // Exponential backoff for errors: 2s, 4s, 8s, 16s, cap at 30s
        pollIntervalRef.current = Math.min(2000 * Math.pow(2, consecutiveErrorsRef.current - 1), 30000);
        scheduleNextPoll();
      }
    };

    // Schedule next poll with adaptive interval (using setTimeout for dynamic timing)
    const scheduleNextPoll = () => {
      if (pollingRef.current) {
        clearTimeout(pollingRef.current);
      }
      pollingRef.current = setTimeout(pollJobStatus, pollIntervalRef.current) as unknown as NodeJS.Timeout;
    };

    // Poll immediately, then use adaptive interval
    pollJobStatus();

    return () => {
      if (pollingRef.current) {
        clearTimeout(pollingRef.current);
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
      clearTimeout(pollingRef.current);
      pollingRef.current = null;
    }
    setJobId(null);
    setProgress((prev) => ({ ...prev, status: 'cancelled' }));
    setState('ready');
  }, []);

  const handleReset = useCallback(() => {
    // Stop any active polling
    if (pollingRef.current) {
      clearTimeout(pollingRef.current);
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
    setFastMode(false);
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
      // Show results immediately
      setResults(loadedResults);
      setExtraColumns([]);
      setCacheHits(0);
      setCurrentLookupId(lookupId || null);
      setCurrentLookupName(lookupName || null);
      setEnrichedWallets(new Set(enrichedWalletsArray?.map(w => w.toLowerCase()) || []));
      setState('complete');

      // Check for results that have farcaster username but no fc_fid
      const needsFidEnrichment = loadedResults.filter(r => r.farcaster && !r.fc_fid);

      // Enrich FIDs in background (don't block UI)
      if (needsFidEnrichment.length > 0) {
        setEnrichingFids(true);

        const enrichFids = async () => {
          try {
            const usernames = needsFidEnrichment.map(r => r.farcaster!);
            const BATCH_SIZE = 100;
            const allFids: Record<string, number> = {};

            // Process batches in parallel (max 3 concurrent)
            const batches: string[][] = [];
            for (let i = 0; i < usernames.length; i += BATCH_SIZE) {
              batches.push(usernames.slice(i, i + BATCH_SIZE));
            }

            const CONCURRENT = 3;
            for (let i = 0; i < batches.length; i += CONCURRENT) {
              const concurrentBatches = batches.slice(i, i + CONCURRENT);
              const responses = await Promise.all(
                concurrentBatches.map(batch =>
                  fetch('/api/enrich-fids', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ usernames: batch }),
                  }).then(r => r.ok ? r.json() : null).catch(() => null)
                )
              );

              for (const data of responses) {
                if (data?.fids) {
                  Object.assign(allFids, data.fids);
                }
              }
            }

            // Update results with enriched FIDs
            if (Object.keys(allFids).length > 0) {
              setResults(prev => prev.map(r => {
                if (r.farcaster && !r.fc_fid) {
                  const fid = allFids[r.farcaster.toLowerCase()];
                  if (fid) {
                    return { ...r, fc_fid: fid };
                  }
                }
                return r;
              }));
            }
          } catch (err) {
            console.error('Failed to enrich FIDs:', err);
          } finally {
            setEnrichingFids(false);
          }
        };

        // Run in background
        enrichFids();
      }
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
          fastMode,
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
        // Handle rate limit response
        if (response.status === 429) {
          setRateLimitMessage(errorData.error || 'Rate limit exceeded. Sign in for unlimited access.');
          setShowAuthModal(true);
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
  }, [includeENS, fastMode, userEmail]);

  // Handle creating new lookup from modal
  const handleCreateNewFromModal = useCallback((addresses: string[]) => {
    if (addresses.length === 0) return;
    setWallets(addresses);
    setOriginalData({});
    setExtraColumns([]);
    setState('ready');
  }, []);

  // Handle importing wallets from contract address
  const handleContractImport = useCallback((importedWallets: string[]) => {
    if (importedWallets.length === 0) return;
    setWallets(importedWallets);
    setOriginalData({});
    setExtraColumns([]);
    setInputSource('contract_import');
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
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
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
                  className="rounded-lg flex-shrink-0"
                />
                <h1 className="text-2xl sm:text-3xl font-bold hover:text-accent-brand transition-colors">
                  walletlink.social
                </h1>
              </div>
              <p className="text-muted-foreground text-sm sm:text-base">
                Turn your wallet list into Twitter handles and Farcaster profiles. Backed by an index of 4.7M wallets with complete Farcaster coverage. Detect 13,000+ known AI agent wallets instantly.{' '}
                <a
                  href="/vs/addressable"
                  className="underline hover:text-foreground"
                >
                  Simple alternative to Addressable
                </a>
                .
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                {indexedWallets ?? '4.7M'} wallets indexed · complete Farcaster coverage · 13K+ AI agents flagged
              </p>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
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

        {/* Auth Modal for rate limit prompts */}
        <AuthModal open={showAuthModal} onOpenChange={(open) => {
          setShowAuthModal(open);
          if (!open) setRateLimitMessage(null);
        }} />

        {/* Contract Import Modal (Pro and Unlimited) */}
        <ContractImportModal
          open={showContractImportModal}
          onOpenChange={setShowContractImportModal}
          onImport={handleContractImport}
        />

        {/* Farcaster DM Modal (Unlimited tier only) */}
        <FarcasterDMModal
          open={showFarcasterDMModal}
          onOpenChange={setShowFarcasterDMModal}
          results={results}
        />

        <main className="space-y-6">
          {/* Upload State */}
          {state === 'upload' && (
            <div className="space-y-6">
              {/* The three input methods as peers. Contract import shows locked
                  rather than hidden on free accounts, so the layout is stable
                  and the feature is discoverable before it is bought. */}
              <InputMethodPicker
                onFileLoaded={handleFileLoaded}
                onPasteClick={handlePasteToggle}
                pasteActive={showPasteInput}
                // The drop target is the whole window, so it has to stand down
                // while a dialog is over the page or a file dropped onto the
                // modal would be swallowed by the page behind it
                disabled={showContractImportModal || showUpgradeModal || showAuthModal}
                contractLocked={userTier !== 'pro' && userTier !== 'unlimited'}
                onContractClick={handleContractCardClick}
              />

              {/* Paste panel, opened by the middle card */}
              <div className="text-center">
                {showPasteInput && (
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
                          Load addresses
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Supported networks, previously buried under the contract button */}
              <p className="text-center text-xs text-muted-foreground">
                Ethereum, Base and Robinhood Chain
              </p>

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
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="fastMode"
                      checked={fastMode}
                      onChange={(e) => setFastMode(e.target.checked)}
                      className="rounded"
                    />
                    <label
                      htmlFor="fastMode"
                      className="text-sm"
                      title="Skip slower lookups for near-instant results. Gets Farcaster + verified Twitter only."
                    >
                      Fast mode
                    </label>
                  </div>
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
                            localStorage.setItem('notifyOnComplete', granted.toString());
                          } else {
                            setNotifyOnComplete(false);
                            localStorage.setItem('notifyOnComplete', 'false');
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
                  <Button onClick={startLookup}>Start lookup</Button>
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
                <div className="flex gap-2 flex-wrap">
                  {/* DM Farcaster users button (Unlimited tier only, when FC users exist or enriching) */}
                  {userTier === 'unlimited' && (results.some(r => r.fc_fid) || enrichingFids) && (
                    <Button
                      variant="outline"
                      onClick={() => setShowFarcasterDMModal(true)}
                      disabled={enrichingFids}
                      title="Send DMs to Farcaster users"
                      className="text-purple-600 border-purple-200 hover:bg-purple-50 dark:text-purple-400 dark:border-purple-800 dark:hover:bg-purple-950"
                    >
                      <Send className="h-4 w-4 mr-2" />
                      {enrichingFids ? (
                        <>Loading FIDs...</>
                      ) : (
                        <>DM {results.filter(r => r.fc_fid).length.toLocaleString()} FC users</>
                      )}
                    </Button>
                  )}
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
                    New lookup
                  </Button>
                  <ExportButton
                    results={results}
                    extraColumns={extraColumns}
                    userTier={userTier}
                    onUpgradeClick={handleOpenUpgradeModal}
                    lookupName={currentLookupName}
                  />
                  <ShareButtons
                    twitterCount={results.filter((r) => r.twitter_handle).length}
                    farcasterCount={results.filter((r) => r.farcaster).length}
                    totalWallets={results.length}
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
          <p className="flex items-center justify-center gap-2">
            made with 🌠 by @starl3xx
            <a
              href="https://x.com/starl3xx"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors"
              title="@starl3xx on X"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
            </a>
            <a
              href="https://warpcast.com/starl3xx.eth"
              target="_blank"
              rel="noopener noreferrer"
              className="text-purple-500 hover:text-purple-400 transition-colors"
              title="@starl3xx.eth on Farcaster"
            >
              <svg width="14" height="14" viewBox="0 0 200 175" fill="currentColor">
                <path d="M200 0V23.6302H176.288V47.2404H183.553V47.2483H200V175H160.281L160.256 174.883L139.989 79.3143C138.057 70.2043 133 61.9616 125.751 56.0995C118.502 50.2376 109.371 47.0108 100.041 47.0108H99.9613C90.631 47.0108 81.5 50.2376 74.251 56.0995C67.0023 61.9616 61.9453 70.2073 60.013 79.3143L39.7223 175H0V47.2453H16.4475V47.2404H23.7114V23.6302H0V0H200Z" />
              </svg>
            </a>
          </p>
          <p className="flex items-center justify-center gap-2 mt-1">
            <a
              href="https://x.com/walletlinkETH"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors flex items-center gap-1"
              title="@walletlinkETH on X"
            >
              @walletlinkETH
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
            </a>
          </p>
          <div className="flex items-center justify-center gap-4 mt-3 text-xs">
            <a href="/blog" className="hover:text-foreground transition-colors">
              Blog
            </a>
            <span>|</span>
            <a href="/vs/addressable" className="hover:text-foreground transition-colors">
              vs Addressable
            </a>
            <span>|</span>
            <a href="/vs/blaze" className="hover:text-foreground transition-colors">
              vs Blaze
            </a>
            <span>|</span>
            <a href="/vs/cookie" className="hover:text-foreground transition-colors">
              vs Cookie.fun
            </a>
          </div>
        </footer>
      </div>
    </div>
  );
}
