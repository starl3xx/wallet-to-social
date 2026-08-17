'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { ProgressBar } from '@/components/ProgressBar';
import { ResultsTable } from '@/components/ResultsTable';
import { ExportButton } from '@/components/ExportButton';
import { ShareButtons } from '@/components/ShareButtons';
import { StatsCards } from '@/components/StatsCards';
import { LookupHistory } from '@/components/LookupHistory';
import { ReverseLookup, type ReverseMeta } from '@/components/ReverseLookup';
import { RecentWins } from '@/components/RecentWins';
import { ThemeToggle } from '@/components/ThemeToggle';
import { PageShell } from '@/components/ui/page-shell';
import { Eyebrow } from '@/components/ui/eyebrow';
import { OverflowMenu, MenuItem } from '@/components/ui/overflow-menu';
import { XMark } from '@/components/ui/brand-marks';
import { AccessBanner } from '@/components/AccessBanner';
import { useAuth } from '@/components/AuthProvider';
import { INDEXED_WALLETS } from '@/lib/public-figures';

// Lazy-load modals — not needed until user interaction
const UpgradeModal = dynamic(() => import('@/components/UpgradeModal').then(m => ({ default: m.UpgradeModal })));
const AddAddressesModal = dynamic(() => import('@/components/AddAddressesModal').then(m => ({ default: m.AddAddressesModal })));
const ContractImportModal = dynamic(() => import('@/components/ContractImportModal').then(m => ({ default: m.ContractImportModal })));
import type { ImportedContract } from '@/components/ContractImportModal';
const AuthModal = dynamic(() => import('@/components/AuthModal').then(m => ({ default: m.AuthModal })));
const FarcasterDMModal = dynamic(() => import('@/components/FarcasterDMModal').then(m => ({ default: m.FarcasterDMModal })));
import { getUserId } from '@/lib/user-id';
import { Analytics } from '@/lib/client-analytics';
import { TIER_LIMITS, tierCanUseENS, type UserTier } from '@/lib/access';
import { SUPPORTED_CHAINS, CHAIN_LABELS, type SupportedChain } from '@/lib/chains';
import { parseContractDeepLink } from '@/lib/contract-deep-link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { SCAN_DEPTHS, scanDepthOptions, type ScanDepth } from '@/lib/scan-depth';
import { PencilSimple as Pencil, Plus, Check, X, PaperPlaneTilt as Send, Warning as AlertTriangle, ArrowsClockwise as RefreshCw, Lightning, Binoculars, Swap, MagnifyingGlass } from '@phosphor-icons/react';
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
  /**
   * Deep is the default, and it is the one the product is sold on: onchain ENS
   * records are the only source where the wallet's owner published the handle
   * themselves, so they are what makes a row attested rather than inferred.
   * Fast is there for the person who wants an answer now and already knows most
   * of their list is in the index.
   */
  const [scanDepth, setScanDepth] = useState<ScanDepth>('deep');
  const [lookupName, setLookupName] = useState('');
  const [notifyOnComplete, setNotifyOnComplete] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('notifyOnComplete') === 'true';
  });
  const [jobId, setJobIdState] = useState<string | null>(null);

  // Live index size for the header stat strip — falls back to the static
  // The constant is the fallback when the live stats fetch fails. It is the
  // same figure, kept in lib/public-figures.ts so static copy agrees with it.
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
  const { user, isLoading: authLoading } = useAuth();
  const userTier: UserTier = user?.tier || 'free';
  const isWhitelisted = user?.isWhitelisted || false;
  const userEmail = user?.email || null;
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  // Paste addresses mode
  const [showPasteInput, setShowPasteInput] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [inputSource, setInputSource] = useState<'file_upload' | 'text_input' | 'contract_import'>('file_upload');
  // The contract behind a contract import. Sent with the job so the admin Jobs
  // table can name what was looked up, not only how many wallets it held.
  const [sourceContract, setSourceContract] = useState<ImportedContract | null>(null);

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
  // Set only for reverse lookups. Drives the truncation notice, which matters
  // because the endpoint caps at 100 with no pagination, so a popular handle
  // silently returns a partial answer unless we say so.
  const [reverseMeta, setReverseMeta] = useState<ReverseMeta | null>(null);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState('');
  const [enrichedWallets, setEnrichedWallets] = useState<Set<string>>(new Set());
  /**
   * A merge that resolved but could not be saved back to the lookup.
   *
   * Deliberately not `error`. That one means the run failed and swaps the
   * whole view for a failure screen, which would throw away results that are
   * real and already on screen. This is the narrower case: the addresses
   * resolved, and only the write to the saved lookup was refused. It renders
   * as a notice above the results rather than in place of them.
   */
  const [mergeWarning, setMergeWarning] = useState<string | null>(null);

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

  /**
   * `/?contract=0x…&chain=base` opens the importer with the contract filled in.
   *
   * It exists so a link can carry a contract: from a bookmarklet on a
   * marketplace page, from a shared message, from our own docs. The page is
   * statically rendered, so this reads `window.location` in an effect rather
   * than using `useSearchParams`, which would force a Suspense boundary and
   * push the whole route to dynamic for one query string.
   *
   * Read once, on mount, and clear the URL immediately. Clearing before doing
   * anything with the value means a refresh cannot replay the import, and the
   * address does not sit in history or get copied out of the address bar with
   * the rest of a shared link.
   */
  const [deepLinkContract, setDeepLinkContract] = useState<{
    address: string;
    chain: SupportedChain;
  } | null>(null);
  const deepLinkRead = useRef(false);
  const deepLinkActed = useRef(false);

  useEffect(() => {
    if (deepLinkRead.current) return;
    deepLinkRead.current = true;

    const search = window.location.search;
    if (!search.includes('contract=')) return;

    window.history.replaceState({}, '', window.location.pathname);
    setDeepLinkContract(parseContractDeepLink(search));
  }, []);

  /**
   * Act on it only once the session has resolved.
   *
   * `userTier` falls back to 'free' while `useAuth` is still loading, so acting
   * on mount would show a paying customer the upgrade modal for a feature they
   * already have. The ref makes it fire once: without it, upgrading later would
   * silently open an importer the person had moved on from.
   */
  useEffect(() => {
    if (!deepLinkContract || authLoading || deepLinkActed.current) return;
    deepLinkActed.current = true;
    if (userTier === 'pro' || userTier === 'unlimited') {
      setShowContractImportModal(true);
    } else {
      setShowUpgradeModal(true);
    }
  }, [deepLinkContract, authLoading, userTier]);

  const [displayedProcessed, setDisplayedProcessed] = useState(0);
  const [startTime, setStartTime] = useState<number | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * Estimate processing time, per scan depth.
   *
   * Deep: ~10s per 1,000 across the live sources (measured ~7s worst case,
   * ~4.5s with typical cache hits, since they run in parallel), plus ~8s per
   * 1,000 for onchain ENS: reverse resolution runs 50 at a time, and only the
   * wallets that resolve go on to read text records. 18s per 1,000 is the
   * conservative sum, and it is deliberately conservative — an estimate that
   * runs under is a pleasant surprise, one that runs over is a support ticket.
   *
   * Fast: two indexed queries against our own tables. Wall clock is the round
   * trip rather than the row count, so the number barely moves with list size.
   */
  const estimateTime = (walletCount: number, depth: ScanDepth): string => {
    const seconds =
      depth === 'fast'
        ? Math.ceil((walletCount / 5000) * 5) + 3
        : Math.ceil((walletCount / 1000) * 18) + 5;
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
    setSourceContract(null);
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
      setSourceContract(null);
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
    setMergeWarning(null);
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
          ...scanDepthOptions(scanDepth),
          userId: getUserId(),
          email: userEmail || undefined,
          inputSource,
          sourceContract: inputSource === 'contract_import' ? sourceContract : undefined,
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
    // `sourceContract` has to be here even though every setter that changes it
    // also sets `inputSource`. Two contract imports in a row set inputSource to
    // the same value twice, React bails out of that update, and without this
    // dependency the callback keeps the first contract: the second import would
    // be filed in the admin panel under the first one's name.
  }, [wallets, originalData, saveToHistory, lookupName, scanDepth, userTier, userEmail, inputSource, sourceContract]);

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

                // Update the lookup in the database.
                //
                // The response is checked rather than fired and forgotten. A
                // rejected save used to leave the merged list on screen looking
                // saved, and it survived until the next reload took it away
                // with no explanation. Showing the new addresses without the
                // old ones is the honest failure: it matches what is stored.
                const saved = await fetch(`/api/history/${pendingMergeLookupId}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ results: mergedResults }),
                });

                if (saved.ok) {
                  setMergeWarning(null);
                  setResults(mergedResults);
                } else {
                  const reason = await saved.json().catch(() => null);
                  console.error('Merge save rejected:', reason);
                  setMergeWarning(
                    reason?.error ||
                      'These addresses were resolved, but could not be added to the saved lookup.'
                  );
                  setResults(data.results || []);
                }
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

  // Reverse results land in the same `results` state as a forward lookup, so
  // the table, stats cards and CSV export all work unchanged. The only thing
  // that differs is the truncation notice.
  const handleReverseResults = useCallback(
    (
      reverseResults: WalletSocialResult[],
      label: string,
      meta: ReverseMeta,
      lookupId: string | null
    ) => {
      setResults(reverseResults);
      setExtraColumns([]);
      setOriginalData({});
      // Saved server-side, so the rename and add-addresses controls work on it
      // exactly as they do for a forward lookup.
      setCurrentLookupId(lookupId);
      setCurrentLookupName(`Wallets for ${label}`);
      setReverseMeta(meta);
      setError(null);
      setState('complete');
    },
    []
  );

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
    setReverseMeta(null);
    setMergeWarning(null);
    setScanDepth('deep');
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
      // The notice belonged to a different run; it must not follow a lookup
      // the user has just opened from history.
      setMergeWarning(null);
      // A saved lookup carries its rows but not the truncation metadata, which
      // only ever existed in memory. Leaving a stale banner up would claim
      // "showing 100 of N" over a list that is no longer that query's result.
      setReverseMeta(null);
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
    // The cap notice described the reverse query, not this grown list. Once
    // addresses are added the row count no longer matches what it claims.
    setReverseMeta(null);
    setState('processing');
    setResults([]);
    // A retry is a fresh attempt, so the previous verdict must not survive it.
    setMergeWarning(null);
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
          ...scanDepthOptions(scanDepth),
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
  }, [scanDepth, userEmail]);

  // Handle creating new lookup from modal
  const handleCreateNewFromModal = useCallback((addresses: string[]) => {
    if (addresses.length === 0) return;
    setWallets(addresses);
    setOriginalData({});
    setExtraColumns([]);
    // These describe where the PREVIOUS wallet list came from. Leaving them set
    // makes the next lookup claim the contract it no longer contains, and the
    // admin Source column then names the wrong token.
    setInputSource('text_input');
    setSourceContract(null);
    setState('ready');
  }, []);

  // Handle importing wallets from contract address
  const handleContractImport = useCallback((importedWallets: string[], source: ImportedContract) => {
    if (importedWallets.length === 0) return;
    setWallets(importedWallets);
    setOriginalData({});
    setExtraColumns([]);
    setInputSource('contract_import');
    setSourceContract(source);
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
    <PageShell
      continuesHeader
      onBrandClick={handleReset}
      actions={
        <>
          <AccessBanner
            tier={userTier}
            isWhitelisted={isWhitelisted}
            onUpgradeClick={handleOpenUpgradeModal}
            /* The theme control is a three-option segmented at 132px, which is
               40% of the header's action cluster and more than a phone can give
               it. Below `sm` it renders in the footer instead, which is on every
               page and has room. Exactly one is ever on screen. */
            trailing={
              <div className="hidden sm:block">
                <ThemeToggle />
              </div>
            }
          />
        </>
      }
    >
      {/* Owns its own bottom spacing. It used to sit in the header, where the
          separation came from main's py-12 below it; as a sibling inside main
          there is nothing between it and the upload UI. */}
      <div className="mb-8 border-b border-border pb-3.5">
        {/* One line, not three sentences that then repeat themselves in the
            strip below. The old copy stated a hardcoded figure and complete Farcaster
            coverage in the paragraph and again in the stats line. */}
        <h1 className="max-w-[60ch] pt-2 text-sm text-muted-foreground sm:text-base">
          Turn a wallet list into the{' '}
          <XMark className="inline h-3 w-3 align-[-0.1em]" label="X" /> and Farcaster
          accounts behind it.{' '}
          <a href="/vs/addressable" className="transition-control underline hover:text-accent-brand">
            Simple alternative to Addressable
          </a>
          .
        </h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            {/* The pulse goes on the figure that actually moves. Coverage is a
                fixed 100%; this is the count that grows as lookups feed the
                graph, which is what "and counting" claims. */}
            <span className="h-1.5 w-1.5 rounded-full bg-attested motion-safe:animate-pulse" aria-hidden />
            <span className="font-medium tabular-nums text-foreground">
              {indexedWallets ?? INDEXED_WALLETS}
            </span>{' '}
            wallets indexed and counting
          </span>
          <span aria-hidden="true" className="opacity-40">·</span>
          <span>
            <span className="font-medium tabular-nums text-foreground">100%</span> Farcaster coverage
          </span>
          <span aria-hidden="true" className="opacity-40">·</span>
          <span>
            <span className="font-medium tabular-nums text-foreground">13K+</span> AI agents flagged
          </span>
        </div>
      </div>

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
          // Closing drops the deep link, so a later manual open starts blank
          // rather than re-filling a contract the person has already dismissed.
          onOpenChange={(next) => {
            setShowContractImportModal(next);
            if (!next) setDeepLinkContract(null);
          }}
          onImport={handleContractImport}
          initialAddress={deepLinkContract?.address}
          initialChain={deepLinkContract?.chain}
        />

        {/* Farcaster DM Modal (Unlimited tier only) */}
        <FarcasterDMModal
          open={showFarcasterDMModal}
          onOpenChange={setShowFarcasterDMModal}
          results={results}
        />

        <div className="space-y-6">
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
                // Yielding to open dialogs is handled inside the component by
                // asking the DOM, not enumerated here: dialogs also open from
                // the access banner and lookup history, which this file does
                // not track, and any list would go stale on the next one added
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

              {/* The other direction. Featured on the front page rather than
                  buried, because it is the differentiator and it was previously
                  sold in the upgrade modal with no interface anywhere. */}
              <ReverseLookup
                locked={userTier !== 'pro' && userTier !== 'unlimited'}
                onUpgradeClick={handleOpenUpgradeModal}
                onSignInRequired={() => setShowAuthModal(true)}
                onResults={handleReverseResults}
              />

              {/* Derived from SUPPORTED_CHAINS rather than typed out, so adding
                  a chain updates the page instead of leaving stale copy behind */}
              <p className="text-center text-xs text-muted-foreground">
                {SUPPORTED_CHAINS.map((c) => CHAIN_LABELS[c]).join(' · ')}
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
                <div className="p-4 bg-caution-tint border border-caution/30 rounded-lg flex items-center justify-between gap-4">
                  <p className="text-sm text-caution">
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

              {/* Two questions, asked in words rather than in pipeline terms.
                  This was four checkboxes in one wrapping row, two of which
                  ("ENS onchain lookup", "Fast mode") named implementation
                  details and pulled in opposite directions. What a person
                  actually decides here is how long to wait and whether to keep
                  the result, so those are the two things the panel asks. */}
              <div className="p-4 bg-muted rounded-lg space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="font-medium">
                      {wallets.length.toLocaleString()} wallet addresses loaded
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Estimated processing time: {estimateTime(wallets.length, scanDepth)}
                    </p>
                    {extraColumns.length > 0 && (
                      <p className="text-sm text-muted-foreground">
                        Extra columns: {extraColumns.join(', ')}
                      </p>
                    )}
                  </div>
                  <Button variant="outline" onClick={handleReset} className="shrink-0">
                    <Swap className="h-4 w-4" aria-hidden />
                    Choose different file
                  </Button>
                </div>

                <div className="space-y-4 border-t pt-4">
                  {/* How long against how thorough */}
                  <div className="grid gap-2 sm:grid-cols-[8rem_1fr] sm:items-start sm:gap-4">
                    <Eyebrow className="sm:pt-2.5">
                      Scan depth
                    </Eyebrow>
                    <div className="space-y-1.5">
                      <Segmented<ScanDepth>
                        ariaLabel="Scan depth"
                        value={scanDepth}
                        onChange={setScanDepth}
                        className="w-full max-w-[17rem]"
                        options={[
                          {
                            value: 'fast',
                            label: SCAN_DEPTHS.fast.label,
                            content: (
                              <>
                                <Lightning className="h-4 w-4" aria-hidden />
                                {SCAN_DEPTHS.fast.label}
                              </>
                            ),
                          },
                          {
                            value: 'deep',
                            label: SCAN_DEPTHS.deep.label,
                            content: (
                              <>
                                <Binoculars className="h-4 w-4" aria-hidden />
                                {SCAN_DEPTHS.deep.label}
                              </>
                            ),
                          },
                        ]}
                      />
                      <p className="text-xs text-muted-foreground">
                        {SCAN_DEPTHS[scanDepth].blurb}
                      </p>
                    </div>
                  </div>

                  {/* Keep it, and under what name */}
                  <div className="grid gap-2 sm:grid-cols-[8rem_1fr] sm:items-start sm:gap-4">
                    <Eyebrow className="sm:pt-2.5">
                      History
                    </Eyebrow>
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-3">
                        <label
                          htmlFor="saveHistory"
                          className="flex h-control items-center gap-2 text-sm"
                        >
                          <input
                            type="checkbox"
                            id="saveHistory"
                            checked={saveToHistory}
                            onChange={(e) => setSaveToHistory(e.target.checked)}
                            className="rounded-sm"
                          />
                          Save this lookup
                        </label>
                        {saveToHistory && (
                          <Input
                            placeholder="Name it (optional)"
                            value={lookupName}
                            onChange={(e) => setLookupName(e.target.value)}
                            className="w-full max-w-xs"
                            aria-label="Lookup name"
                          />
                        )}
                      </div>
                      {!saveToHistory && (
                        <p className="text-xs text-muted-foreground">
                          Results are not kept. Export them before you leave this page.
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 border-t pt-4">
                  {canNotify() && (
                    <label
                      htmlFor="notifyOnComplete"
                      className="flex items-center gap-2 text-sm text-muted-foreground"
                      title="Get a browser notification when lookup finishes"
                    >
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
                        className="rounded-sm"
                      />
                      Notify when done
                    </label>
                  )}
                  <div className="flex-1" />
                  <Button onClick={startLookup}>
                    <MagnifyingGlass className="h-4 w-4" aria-hidden />
                    Start lookup
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Processing State */}
          {state === 'processing' && (
            <ProgressBar progress={progress} displayedProcessed={displayedProcessed} timeRemaining={getTimeRemaining()} onCancel={handleCancel} scanDepth={scanDepth} includesEns={tierCanUseENS(userTier, isWhitelisted)} />
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
              {mergeWarning && (
                <div className="flex items-start gap-3 rounded-lg border border-caution bg-caution-tint p-4">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-caution" aria-hidden />
                  <p className="text-sm text-caution">
                    {mergeWarning} You are looking at the new addresses only, and
                    the saved lookup still holds what it held before.
                  </p>
                </div>
              )}
              {/* Stacks on a phone. A row of buttons never wraps, so when the
                  viewport cannot hold the name beside the actions the two go on
                  separate lines rather than the row reflowing. */}
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
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
                    <div>
                      {/* The eyebrow is what says the string below it is a name you
                          set, not a section heading. A pencil beside a word does not
                          communicate "label this so you can find it later", and the
                          affordance is visible at rest because on touch there is no
                          hover to reveal it. */}
                      <Eyebrow className="mb-1">Lookup name</Eyebrow>
                      <div className="flex items-center gap-2.5">
                        <h2 className="text-xl font-semibold tracking-[-0.02em]">
                          {currentLookupName || 'Results'}
                        </h2>
                        {currentLookupId && (userTier === 'pro' || userTier === 'unlimited') && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditNameValue(currentLookupName || '');
                              setIsEditingName(true);
                            }}
                            className="transition-control inline-flex items-center gap-1.5 rounded-full border border-accent-brand px-2.5 py-1 text-xs font-medium text-accent-brand hover:bg-accent-brand-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                          >
                            <Pencil className="h-3 w-3" aria-hidden />
                            Rename
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                  {cacheHits > 0 && (
                    <p className="text-sm text-muted-foreground">
                      {cacheHits.toLocaleString()} results from cache (24h)
                    </p>
                  )}
                </div>
                {/* One filled action, one contextual action, everything else in the
                    menu. This was up to seven buttons of equal weight in a wrapping
                    row, which gave "Export CSV" and "\u{1D54F} Share" the same emphasis and
                    ragged onto a second line. A row of buttons never wraps. */}
                <div className="flex flex-none items-center gap-2">
                  {/* Hidden below sm and offered in the menu instead. A row of
                      buttons never wraps, so on a phone the row has to get
                      shorter rather than reflow: ExportButton alone is two
                      controls, and the name sits beside all of it. */}
                  {userTier === 'unlimited' && (results.some(r => r.fc_fid) || enrichingFids) && (
                    <Button
                      variant="outline"
                      onClick={() => setShowFarcasterDMModal(true)}
                      disabled={enrichingFids}
                      title="Send DMs to Farcaster users"
                      className="hidden sm:inline-flex"
                    >
                      <Send className="h-4 w-4" />
                      {enrichingFids
                        ? 'Loading FIDs...'
                        : `DM ${results.filter(r => r.fc_fid).length.toLocaleString()}`}
                    </Button>
                  )}

                  <ExportButton
                    results={results}
                    extraColumns={extraColumns}
                    userTier={userTier}
                    onUpgradeClick={handleOpenUpgradeModal}
                    lookupName={currentLookupName}
                  />

                  <OverflowMenu>
                    {userTier === 'unlimited' && (results.some(r => r.fc_fid) || enrichingFids) && (
                      <div className="sm:hidden">
                        <MenuItem onClick={() => setShowFarcasterDMModal(true)}>
                          <Send className="h-4 w-4" aria-hidden />
                          DM {results.filter(r => r.fc_fid).length.toLocaleString()} FC users
                        </MenuItem>
                      </div>
                    )}
                    {currentLookupId && userTier === 'unlimited' && (
                      <MenuItem onClick={handleAddAddressesFromResults}>
                        <Plus className="h-4 w-4" aria-hidden />
                        Add addresses
                      </MenuItem>
                    )}
                    <MenuItem onClick={handleReset}>
                      <RefreshCw className="h-4 w-4" aria-hidden />
                      New lookup
                    </MenuItem>
                    <div className="my-1 border-t border-border" />
                    <ShareButtons
                      twitterCount={results.filter((r) => r.twitter_handle).length}
                      farcasterCount={results.filter((r) => r.farcaster).length}
                      totalWallets={results.length}
                      /* Same predicate as StatsCards, so the shared figure and
                         the one on screen can never disagree. */
                      reachableCount={
                        results.filter(
                          (r) => r.twitter_handle || r.farcaster || r.lens || r.github
                        ).length
                      }
                      asMenuItems
                    />
                  </OverflowMenu>
                </div>
              </div>

              {/* Report the cap honestly. There is no pagination behind it, so
                  the rest is genuinely unreachable rather than one click away,
                  and implying otherwise would be worse than saying nothing. */}
              {reverseMeta?.truncated && (
                <div className="flex items-start gap-2 rounded-lg border border-caution/30 bg-caution-tint p-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-caution" />
                  <p className="text-xs text-caution">
                    Showing {reverseMeta.returnedCount} of{' '}
                    {reverseMeta.totalCount.toLocaleString()} wallets, ordered by
                    Farcaster reach. Need the full set?{' '}
                    <a href="mailto:help@walletlink.social" className="underline">
                      Get in touch
                    </a>
                    .
                  </p>
                </div>
              )}

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
        </div>
    </PageShell>
  );
}
