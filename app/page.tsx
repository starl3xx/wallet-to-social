'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useCredits } from '@/lib/use-credits';
import dynamic from 'next/dynamic';
import { ProgressBar } from '@/components/ProgressBar';
import { ResultsTable } from '@/components/ResultsTable';
import { ExportButton } from '@/components/ExportButton';
import { ShareButtons } from '@/components/ShareButtons';
import { StatsCards } from '@/components/StatsCards';
import { LookupHistory } from '@/components/LookupHistory';
import { ReverseLookup, type ReverseMeta } from '@/components/ReverseLookup';
import { RecentWins } from '@/components/RecentWins';
import { PageShell } from '@/components/ui/page-shell';
import { Eyebrow } from '@/components/ui/eyebrow';
import { Figure } from '@/components/ui/figure';
import { Card } from '@/components/ui/card';
import { OverflowMenu, MenuItem } from '@/components/ui/overflow-menu';
import { XMark } from '@/components/ui/brand-marks';
import { useAuth } from '@/components/AuthProvider';
import { useUpgradeModal } from '@/components/UpgradeModalProvider';
import { INDEXED_WALLETS } from '@/lib/public-figures';
import { CACHE_TTL_DAYS } from '@/lib/cache-constants';

// Lazy-load modals: not needed until user interaction. The buy-credits modal
// is not here: it is mounted once in the layout, because the header opens it
// from every page.
const AddAddressesModal = dynamic(() =>
  import('@/components/AddAddressesModal').then((m) => ({
    default: m.AddAddressesModal,
  }))
);
const ContractImportModal = dynamic(() =>
  import('@/components/ContractImportModal').then((m) => ({
    default: m.ContractImportModal,
  }))
);
import type { ImportedContract } from '@/components/ContractImportModal';
const AuthModal = dynamic(() =>
  import('@/components/AuthModal').then((m) => ({ default: m.AuthModal }))
);
const FarcasterDMModal = dynamic(() =>
  import('@/components/FarcasterDMModal').then((m) => ({
    default: m.FarcasterDMModal,
  }))
);
import { getUserId } from '@/lib/user-id';
import { Analytics } from '@/lib/client-analytics';
import { TIER_LIMITS, tierCanUseENS, type UserTier } from '@/lib/access';
import { FREE_MATCHES_PER_WINDOW, FREE_WINDOW_DAYS } from '@/lib/packs';
import {
  SUPPORTED_CHAINS,
  CHAIN_LABELS,
  type SupportedChain,
} from '@/lib/chains';
import { parseContractDeepLink } from '@/lib/contract-deep-link';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import {
  SCAN_DEPTHS,
  scanDepthOptions,
  type ScanDepth,
} from '@/lib/scan-depth';
import {
  PencilSimple as Pencil,
  Plus,
  Check,
  X,
  PaperPlaneTilt as Send,
  Warning as AlertTriangle,
  ArrowsClockwise as RefreshCw,
  Lightning,
  Binoculars,
  Swap,
  MagnifyingGlass,
} from '@phosphor-icons/react';
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

  // Live index size for the header stat strip.
  // The constant is the fallback when the live stats fetch fails. It is the
  // same figure, kept in lib/public-figures.ts so static copy agrees with it.
  const [indexedWallets, setIndexedWallets] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/public-stats')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data || typeof data.total_wallets !== 'number')
          return;
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

  /**
   * Entitlement, which `userTier` can no longer answer.
   *
   * A pack purchase does not change `users.tier`, so every gate written as
   * `userTier === 'pro' || userTier === 'unlimited'` refused a paying customer
   * the features they had just been sold. See lib/use-credits.ts.
   */
  const credits = useCredits(!!user);
  const entitled = credits.entitled;
  const isWhitelisted = user?.isWhitelisted || false;
  const userEmail = user?.email || null;
  const upgradeModal = useUpgradeModal();

  /**
   * The per-lookup ceiling the server will apply, mirrored here so the person
   * hears about a too-large file before the upload rather than from a 403
   * after it. The rule is the one in app/api/jobs/route.ts, in the same order:
   *
   * - A legacy tier keeps the cap it was sold (TIER_LIMITS), and the whitelist
   *   has none. Neither is metered, so credits say nothing about them.
   * - A pack holder has no per-lookup cap; a submission may be at most ten
   *   times the remaining matches, which is an anti-enumeration guard rather
   *   than a quota. `/api/credits` reports that number as `maxWallets`.
   * - The free allowance keeps the demo's 500-wallet cap, and cannot submit
   *   more than its remaining matches cover either.
   * - An anonymous caller has no ledger, so the demo cap alone applies.
   *
   * Null means "do not block here". The balance is still loading for a
   * signed-in account, and a wrong block is worse than a late one, because the
   * server checks the same rule on submit anyway.
   */
  const walletLimit: number | null = (() => {
    if (!user) return TIER_LIMITS.free;
    if (credits.loading) return null;
    if (credits.unmetered) {
      return isWhitelisted ? Number.POSITIVE_INFINITY : TIER_LIMITS[userTier];
    }
    if (!credits.onFreeAllowance) return credits.maxWallets;
    return Math.min(TIER_LIMITS.free, credits.maxWallets ?? TIER_LIMITS.free);
  })();
  const overWalletLimit = walletLimit !== null && wallets.length > walletLimit;

  // Paste addresses mode
  const [showPasteInput, setShowPasteInput] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [inputSource, setInputSource] = useState<
    'file_upload' | 'text_input' | 'contract_import'
  >('file_upload');
  // The contract behind a contract import. Sent with the job so the admin Jobs
  // table can name what was looked up, not only how many wallets it held.
  const [sourceContract, setSourceContract] = useState<ImportedContract | null>(
    null
  );
  // The uploaded file's name without its extension, for the lookup name.
  // A default is never a generic noun where a real one can be derived
  // (docs/DESIGN-LANGUAGE.md), and the file name is the one the person chose.
  const [sourceFileName, setSourceFileName] = useState<string | null>(null);

  // Add addresses modal state
  const [showAddAddressesModal, setShowAddAddressesModal] = useState(false);

  // Contract import modal state (needs credits: included in every pack)
  const [showContractImportModal, setShowContractImportModal] = useState(false);
  const [addAddressesLookupId, setAddAddressesLookupId] = useState<
    string | null
  >(null);
  const [addAddressesExistingWallets, setAddAddressesExistingWallets] =
    useState<string[]>([]);

  // Auth modal for rate limit prompts
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [rateLimitMessage, setRateLimitMessage] = useState<string | null>(null);

  // Farcaster DM modal. Any pack, or a legacy tier, the same as every other
  // paid feature (decided 2026-08-22; it had stayed legacy-only after the
  // pricing change because it was not on the pack feature list). The route
  // behind it checks the same entitlement.
  const [showFarcasterDMModal, setShowFarcasterDMModal] = useState(false);
  const [enrichingFids, setEnrichingFids] = useState(false);

  // Current lookup tracking (for results view)
  const [currentLookupId, setCurrentLookupId] = useState<string | null>(null);
  const [currentLookupName, setCurrentLookupName] = useState<string | null>(
    null
  );
  // The name decided when the job was submitted, read back when it completes.
  // A ref, because the polling effect must not re-subscribe on a rename.
  const submittedNameRef = useRef<string | null>(null);
  // Set only for reverse lookups. Drives the truncation notice, which matters
  // because the endpoint caps at 100 with no pagination, so a popular handle
  // silently returns a partial answer unless we say so.
  const [reverseMeta, setReverseMeta] = useState<ReverseMeta | null>(null);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState('');
  const [enrichedWallets, setEnrichedWallets] = useState<Set<string>>(
    new Set()
  );
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
          } else if (
            data.status === 'pending' ||
            data.status === 'processing'
          ) {
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
            const progressRatio =
              data.progress.total > 0
                ? data.progress.processed / data.progress.total
                : 0;
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

  // The buy-credits modal is owned by the layout (see UpgradeModalProvider),
  // so the header can open it on every page. This wrapper is what every call
  // site on this page goes through: it passes the loaded list, which the
  // modal uses to mark the smallest pack whose headroom covers the file.
  const handleOpenUpgradeModal = useCallback(() => {
    upgradeModal.open(wallets.length > 0 ? wallets.length : undefined);
  }, [upgradeModal, wallets.length]);

  const handlePasteToggle = useCallback(() => setShowPasteInput((v) => !v), []);

  // The contract card is shown to everyone. Accounts without credits get the
  // buy-credits modal instead of the importer, so the feature is discoverable
  // before it is bought rather than invisible until after.
  const handleContractCardClick = useCallback(() => {
    if (entitled) {
      setShowContractImportModal(true);
    } else {
      handleOpenUpgradeModal();
    }
  }, [entitled, handleOpenUpgradeModal]);

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
   * on mount would show a paying customer the buy-credits modal for a feature
   * they already have. The ref makes it fire once: without it, buying credits
   * later would silently open an importer the person had moved on from.
   */
  useEffect(() => {
    // Wait for credits as well as auth. `entitled` is false while the balance
    // is still loading, and this effect acts exactly once, so acting early
    // would send a paying customer to the buy-credits modal and never correct it.
    if (
      !deepLinkContract ||
      authLoading ||
      credits.loading ||
      deepLinkActed.current
    )
      return;
    deepLinkActed.current = true;
    if (entitled) {
      setShowContractImportModal(true);
    } else {
      handleOpenUpgradeModal();
    }
  }, [
    deepLinkContract,
    authLoading,
    credits.loading,
    entitled,
    handleOpenUpgradeModal,
  ]);

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
   * conservative sum, and it is deliberately conservative: an estimate that
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
    return [...new Set(matches.map((addr) => addr.toLowerCase()))];
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
    setSourceFileName(null);
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

      // The funnel's second step. `Analytics.csvUpload` existed since January
      // and was never called, so `csv_upload` had zero rows and the step below
      // "page views" was permanently empty. Recorded after the parse succeeds,
      // so a rejected file is not counted as an upload.
      Analytics.csvUpload(file.size, result.rows.length);

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
      setSourceFileName(file.name.replace(/\.[^.]+$/, '') || null);
      setState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse file');
      setState('error');
    }
  }, []);

  const startLookup = useCallback(async () => {
    // The same per-lookup rule the server applies, checked before the upload.
    // The caution banner above the button already says why and what to do;
    // this only opens the matching way forward.
    if (overWalletLimit && walletLimit !== null) {
      // limitHit existed in client-analytics but was never called, so we had no
      // idea how often the ceiling was actually the blocker.
      Analytics.limitHit(userTier, walletLimit, wallets.length);
      if (!user) {
        setShowAuthModal(true);
      } else if (!credits.unmetered) {
        handleOpenUpgradeModal();
      }
      // A legacy account over its cap has nothing to buy: the banner tells it
      // to split the file, and that is the whole answer.
      return;
    }

    /**
     * The lookup's name, decided here from what is known at submit time.
     *
     * The person's own name wins. Otherwise the CSV's file name, or the count
     * of pasted wallets, or the token a contract import named: the same
     * derivation the reverse path already does with `Wallets for ${label}`.
     * It used to fall through to "Results", which DESIGN-LANGUAGE names as
     * the violation: a fallback doing duty as the feature's self-explanation.
     * The derived name is also what history saves, so a saved lookup is never
     * nameless either.
     */
    const typedName = lookupName.trim();
    const derivedName =
      inputSource === 'file_upload' && sourceFileName
        ? sourceFileName
        : inputSource === 'contract_import' && sourceContract
          ? `Holders of ${
              sourceContract.tokenName ||
              sourceContract.tokenSymbol ||
              sourceContract.contractAddress
            }`
          : `${wallets.length.toLocaleString()} pasted wallets`;
    const submittedName = typedName || derivedName;
    submittedNameRef.current = submittedName;

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
          historyName: submittedName,
          ...scanDepthOptions(scanDepth),
          userId: getUserId(),
          email: userEmail || undefined,
          inputSource,
          sourceContract:
            inputSource === 'contract_import' ? sourceContract : undefined,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        // Credits needed. `upgradeRequired` is the field name the server still
        // uses; what it opens is the buy-credits modal.
        if (errorData.upgradeRequired) {
          handleOpenUpgradeModal();
          setState('ready');
          return;
        }
        // Handle rate limit response
        if (response.status === 429) {
          setRateLimitMessage(
            errorData.error ||
              `Rate limit exceeded. Sign in for ${FREE_MATCHES_PER_WINDOW} free matches every ${FREE_WINDOW_DAYS} days.`
          );
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
  }, [
    wallets,
    originalData,
    saveToHistory,
    lookupName,
    sourceFileName,
    scanDepth,
    userTier,
    user,
    credits.unmetered,
    walletLimit,
    overWalletLimit,
    userEmail,
    handleOpenUpgradeModal,
    inputSource,
    sourceContract,
  ]);

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
        setError(
          'Lookup timed out. Please try again or check History for results.'
        );
        setProgress((prev) => ({ ...prev, status: 'error' }));
        setState('error');
        return;
      }

      try {
        const response = await fetch(
          `/api/jobs/${jobId}?userId=${encodeURIComponent(getUserId())}`
        );
        if (!response.ok) {
          throw new Error(`HTTP error: ${response.status}`);
        }

        // Successful response: reset error counter
        consecutiveErrorsRef.current = 0;

        const data = await response.json();

        // Adaptive backoff: if no progress, increase interval (up to 5s)
        // Reset to 2s when progress is detected
        if (data.progress.processed === lastProgressRef.current) {
          // No progress - increase polling interval
          pollIntervalRef.current = Math.min(
            pollIntervalRef.current + 500,
            5000
          );
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
          const pendingMergeLookupId = localStorage.getItem(
            'pendingMergeLookupId'
          );
          if (pendingMergeLookupId) {
            localStorage.removeItem('pendingMergeLookupId');

            // Fetch existing results and merge
            try {
              const existingRes = await fetch(
                `/api/history/${pendingMergeLookupId}`
              );
              if (existingRes.ok) {
                const existingData = await existingRes.json();
                const existingResults: WalletSocialResult[] =
                  existingData.results || [];
                const newResults: WalletSocialResult[] = data.results || [];

                // Merge results (new takes precedence, merge sources)
                const resultMap = new Map<string, WalletSocialResult>();
                existingResults.forEach((r) =>
                  resultMap.set(r.wallet.toLowerCase(), r)
                );
                newResults.forEach((r) => {
                  const key = r.wallet.toLowerCase();
                  const existing = resultMap.get(key);
                  if (existing) {
                    // Merge sources
                    const mergedSources = [
                      ...new Set([...existing.source, ...r.source]),
                    ];
                    resultMap.set(key, {
                      ...existing,
                      ...r,
                      source: mergedSources,
                    });
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
                const saved = await fetch(
                  `/api/history/${pendingMergeLookupId}`,
                  {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ results: mergedResults }),
                  }
                );

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
          // The name decided at submit (but no ID means no edit/add
          // addresses until loaded from history). A merge keeps the name of
          // the lookup it merged into.
          if (!pendingMergeLookupId) {
            setCurrentLookupName(submittedNameRef.current);
          }
          setState('complete');

          // Send browser notification if enabled
          if (notifyOnComplete) {
            const permissionStatus = getPermissionStatus();
            if (permissionStatus === 'granted') {
              sendNotification('Lookup complete', {
                // "X", never "Twitter", in anything a person reads; a
                // notification and a tab title are copy too.
                body: `Found ${data.stats.twitterFound} X and ${data.stats.farcasterFound} Farcaster accounts from ${data.progress.total} wallets`,
              });
            } else {
              console.log(
                'Notification permission not granted:',
                permissionStatus
              );
            }

            // Also update page title as a reliable fallback (works when tab is backgrounded)
            const originalTitle = document.title;
            document.title = `✓ Lookup complete: ${data.stats.twitterFound} X, ${data.stats.farcasterFound} Farcaster`;
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
        pollIntervalRef.current = Math.min(
          2000 * Math.pow(2, consecutiveErrorsRef.current - 1),
          30000
        );
        scheduleNextPoll();
      }
    };

    // Schedule next poll with adaptive interval (using setTimeout for dynamic timing)
    const scheduleNextPoll = () => {
      if (pollingRef.current) {
        clearTimeout(pollingRef.current);
      }
      pollingRef.current = setTimeout(
        pollJobStatus,
        pollIntervalRef.current
      ) as unknown as NodeJS.Timeout;
    };

    // Poll immediately, then use adaptive interval
    pollJobStatus();

    return () => {
      if (pollingRef.current) {
        clearTimeout(pollingRef.current);
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
    setSourceFileName(null);
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
    (
      loadedResults: WalletSocialResult[],
      lookupId?: string,
      lookupName?: string | null,
      enrichedWalletsArray?: string[]
    ) => {
      // Show results immediately
      setResults(loadedResults);
      setExtraColumns([]);
      setCacheHits(0);
      setCurrentLookupId(lookupId || null);
      // A saved lookup with no name is named by its size, as the history card
      // names it, so the two agree and neither falls back to a generic noun.
      setCurrentLookupName(
        lookupName || `${loadedResults.length.toLocaleString()} wallets`
      );
      setEnrichedWallets(
        new Set(enrichedWalletsArray?.map((w) => w.toLowerCase()) || [])
      );
      // The notice belonged to a different run; it must not follow a lookup
      // the user has just opened from history.
      setMergeWarning(null);
      // A saved lookup carries its rows but not the truncation metadata, which
      // only ever existed in memory. Leaving a stale banner up would claim
      // "showing 100 of N" over a list that is no longer that query's result.
      setReverseMeta(null);
      setState('complete');

      // Check for results that have farcaster username but no fc_fid
      const needsFidEnrichment = loadedResults.filter(
        (r) => r.farcaster && !r.fc_fid
      );

      // Enrich FIDs in background (don't block UI)
      if (needsFidEnrichment.length > 0) {
        setEnrichingFids(true);

        const enrichFids = async () => {
          try {
            const usernames = needsFidEnrichment.map((r) => r.farcaster!);
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
                concurrentBatches.map((batch) =>
                  fetch('/api/enrich-fids', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ usernames: batch }),
                  })
                    .then((r) => (r.ok ? r.json() : null))
                    .catch(() => null)
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
              setResults((prev) =>
                prev.map((r) => {
                  if (r.farcaster && !r.fc_fid) {
                    const fid = allFids[r.farcaster.toLowerCase()];
                    if (fid) {
                      return { ...r, fc_fid: fid };
                    }
                  }
                  return r;
                })
              );
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
      const existingWallets = (data.results as WalletSocialResult[]).map(
        (r) => r.wallet
      );
      setAddAddressesLookupId(lookupId);
      setAddAddressesExistingWallets(existingWallets);
      setShowAddAddressesModal(true);
    } catch (err) {
      console.error('Failed to load lookup for add addresses:', err);
    }
  }, []);

  // Handle adding addresses to existing lookup
  const handleAddToLookup = useCallback(
    async (lookupId: string, newAddresses: string[]) => {
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
            handleOpenUpgradeModal();
            setState('ready');
            return;
          }
          // Handle rate limit response
          if (response.status === 429) {
            setRateLimitMessage(
              errorData.error ||
                `Rate limit exceeded. Sign in for ${FREE_MATCHES_PER_WINDOW} free matches every ${FREE_WINDOW_DAYS} days.`
            );
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
    },
    [scanDepth, userEmail, handleOpenUpgradeModal]
  );

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
    setSourceFileName(null);
    setState('ready');
  }, []);

  // Handle importing wallets from contract address
  const handleContractImport = useCallback(
    (importedWallets: string[], source: ImportedContract) => {
      if (importedWallets.length === 0) return;
      setWallets(importedWallets);
      /**
       * Feed the bag sizes in as a "Bag" column rather than as a new field.
       *
       * `/api/lookup` already finds a holdings column by name in `originalData`
       * and parses it into `result.holdings`, which the table already renders and
       * sorts and the priority score already uses. Naming the column is the whole
       * integration; a second path for the same number would be a second thing to
       * keep in step.
       *
       * EVERY wallet carries the key, and an unmeasured one carries an empty
       * string. The map must not be sparse: `/api/lookup` detects the holdings
       * column from the keys of the FIRST wallet alone, so a first wallet with no
       * measured balance would leave it finding no column at all and silently
       * dropping every bag in the import, hiding the column and sending priority
       * scoring back to treating holdings as 1.
       *
       * An empty string is not a zero. `parseHoldingsValue` returns null for it
       * and the caller skips it before parsing, so an unmeasured wallet still
       * ends up with no holdings rather than a confident 0.
       */
      const bags = source.balances;
      setOriginalData(
        bags
          ? Object.fromEntries(
              importedWallets.map((w) => {
                const key = w.toLowerCase();
                const bag = bags[key];
                return [
                  key,
                  { Bag: typeof bag === 'number' ? String(bag) : '' },
                ];
              })
            )
          : {}
      );
      setExtraColumns([]);
      setInputSource('contract_import');
      setSourceContract(source);
      setSourceFileName(null);
      setState('ready');
    },
    []
  );

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
    const existingWallets = results.map((r) => r.wallet);
    setAddAddressesLookupId(currentLookupId);
    setAddAddressesExistingWallets(existingWallets);
    setShowAddAddressesModal(true);
  }, [currentLookupId, results]);

  return (
    <PageShell onBrandClick={handleReset}>
      {/* Owns its own bottom spacing. It used to sit in the header, where the
          separation came from main's py-12 below it; as a sibling inside main
          there is nothing between it and the upload UI. It no longer draws a
          rule of its own: that rule stopped at the container edge while the
          shell's ran edge to edge on every other page, and the shell's is the
          one that stays. */}
      <div className="mb-8">
        {/* The same opening as every other page: a display h1 with the one
            emphasis span, a 300-weight lede, then the proof row as Figures.
            This was the only page without the signature, a muted 14px line
            at 400 with the competitor link underlined inside the h1. The
            link is gone from here; the footer's Compare column carries it.
            No `sm:text-5xl` step on this page, so the dropzone stays above
            the fold at 1280x900. */}
        <h1 className="max-w-[17ch] text-4xl font-extralight leading-[1.02] tracking-[var(--tracking-display)]">
          Wallets in.{' '}
          <em className="font-semibold not-italic text-accent-brand">People</em>{' '}
          out.
        </h1>
        <p className="mt-4 max-w-[46ch] text-lg font-light leading-snug tracking-[var(--tracking-lead)] text-muted-foreground">
          Turn a wallet list into the{' '}
          <XMark className="inline h-4 w-4 align-[-0.125em]" label="X" /> and
          Farcaster accounts behind it.
        </p>
        {/* The proof row, the same three figures the /vs pages set as
            Figure. They were 12px spans on one line with middots between
            them, and on a phone the middot dangled at the end of line one;
            flex-wrap with gaps needs no separator. The green mark sits on
            the measured claim, coverage, as it does on the /vs proof strip
            (`Figure attested` on the same 100%); the count is context. No
            pulse: a pulse says the system is running, and Recent wins
            already carries that one below. Gaps 48/16, pt 16: the /vs row's
            40/20/20 are not spacing steps. */}
        <dl className="mt-6 flex flex-wrap gap-x-12 gap-y-4 border-t border-border pt-4">
          <Figure
            value={indexedWallets ?? INDEXED_WALLETS}
            label="wallets indexed"
          />
          <Figure value="100%" label="Farcaster coverage" attested />
          <Figure value="13K+" label="AI agents flagged" />
        </dl>
      </div>

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
      <AuthModal
        open={showAuthModal}
        onOpenChange={(open) => {
          setShowAuthModal(open);
          if (!open) setRateLimitMessage(null);
        }}
      />

      {/* Contract Import Modal (needs credits: included in every pack, gated
          on `entitled` where the card is clicked) */}
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

      {/* Farcaster DM Modal. Offered to any entitled account; see the state
          declaration. */}
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
                  rather than hidden on accounts without credits, so the layout
                  is stable and the feature is discoverable before it is
                  bought. */}
            <InputMethodPicker
              onFileLoaded={handleFileLoaded}
              onPasteClick={handlePasteToggle}
              pasteActive={showPasteInput}
              // Yielding to open dialogs is handled inside the component by
              // asking the DOM, not enumerated here: dialogs also open from
              // the access banner and lookup history, which this file does
              // not track, and any list would go stale on the next one added
              contractLocked={!entitled}
              onContractClick={handleContractCardClick}
            />

            {/* Paste panel, opened by the middle card */}
            {/* A Card, not a `bg-muted/30` wash with a hairline: that tint
                was an unnamed surface, and in dark mode it read as the page
                with a line round it. Card stack `gap-4`. */}
            <div className="text-center">
              {showPasteInput && (
                <Card className="gap-4 p-6 text-left">
                  <Textarea
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                    aria-label="Wallet addresses"
                    placeholder={
                      'Paste wallet addresses in any format\n0x1234..., 0xabcd...\nor one per line\nor mixed with other text'
                    }
                    rows={7}
                    className="font-mono text-sm"
                  />
                  {/* Stacks on a phone, the same shape as the ready panel
                      below: at 375px the count broke into three lines beside
                      the buttons. */}
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <span className="text-sm text-muted-foreground">
                      {countValidAddresses(pasteText)} valid addresses detected
                    </span>
                    <div className="flex gap-2 self-end sm:self-auto">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setShowPasteInput(false);
                          setPasteText('');
                        }}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        onClick={handlePasteAddresses}
                        disabled={countValidAddresses(pasteText) === 0}
                      >
                        Load addresses
                      </Button>
                    </div>
                  </div>
                </Card>
              )}
            </div>

            {/* The other direction. Featured on the front page rather than
                  buried, because it is the differentiator and it was previously
                  sold in the upgrade modal with no interface anywhere. */}
            <ReverseLookup
              locked={!entitled}
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
            {/* `entitled`, not the tier: a pack buyer's tier stays 'free', and
                  history depth and growing a lookup are included in every
                  pack. The server applies the same rule on the write. */}
            <LookupHistory
              onLoadLookup={handleLoadHistory}
              entitled={entitled}
              onAddAddresses={handleOpenAddAddresses}
            />
          </div>
        )}

        {/* Ready State */}
        {state === 'ready' && (
          <div className="space-y-4">
            {/* The file is larger than this account may submit at once. One
                  sentence per situation, each stating the rule that actually
                  applies (see `walletLimit`), and the control that moves it:
                  sign in, buy a pack, or for a legacy cap, split the file.
                  It used to print "the free plan allows a maximum of 500",
                  which named a ladder that no longer exists. */}
            {overWalletLimit && walletLimit !== null && (
              <div className="p-4 bg-caution-tint border border-caution rounded-lg flex items-center justify-between gap-4">
                <p className="text-sm text-caution">
                  Your file has{' '}
                  <span className="font-semibold">
                    {wallets.length.toLocaleString()}
                  </span>{' '}
                  wallets.{' '}
                  {!user ? (
                    <>
                      Lookups are capped at {TIER_LIMITS.free.toLocaleString()}{' '}
                      wallets until you buy a pack. Sign in for{' '}
                      {FREE_MATCHES_PER_WINDOW} free matches every{' '}
                      {FREE_WINDOW_DAYS} days, or split the file.
                    </>
                  ) : credits.unmetered ? (
                    <>
                      This account can look up {walletLimit.toLocaleString()}{' '}
                      wallets at a time. Split the file into smaller lists to
                      run it all.
                    </>
                  ) : credits.onFreeAllowance ? (
                    walletLimit === 0 ? (
                      <>
                        The free allowance of {FREE_MATCHES_PER_WINDOW} matches
                        is used up for this {FREE_WINDOW_DAYS}-day window. Buy a
                        pack to keep going.
                      </>
                    ) : walletLimit < TIER_LIMITS.free ? (
                      // The remaining free matches, not the demo cap, are what
                      // binds here, so the sentence names them.
                      <>
                        You have {(credits.available ?? 0).toLocaleString()}{' '}
                        free matches left this window, which covers up to{' '}
                        {walletLimit.toLocaleString()} wallets at once. Buy a
                        pack to run larger lists.
                      </>
                    ) : (
                      <>
                        A free account can look up{' '}
                        {TIER_LIMITS.free.toLocaleString()} wallets at a time.
                        Buy a pack to run larger lists.
                      </>
                    )
                  ) : (
                    <>
                      You have {(credits.available ?? 0).toLocaleString()}{' '}
                      matches left, which covers up to{' '}
                      {walletLimit.toLocaleString()} wallets at once. Buy a pack
                      for more.
                    </>
                  )}
                </p>
                {!user ? (
                  <Button
                    size="sm"
                    onClick={() => setShowAuthModal(true)}
                    className="shrink-0"
                  >
                    Sign in
                  </Button>
                ) : (
                  !credits.unmetered && (
                    <Button
                      size="sm"
                      onClick={handleOpenUpgradeModal}
                      className="shrink-0"
                    >
                      Buy credits
                    </Button>
                  )
                )}
              </div>
            )}

            {/* Two questions, asked in words rather than in pipeline terms.
                  This was four checkboxes in one wrapping row, two of which
                  ("ENS onchain lookup", "Fast mode") named implementation
                  details and pulled in opposite directions. What a person
                  actually decides here is how long to wait and whether to keep
                  the result, so those are the two things the panel asks.

                  A Card, the one top-level panel. It was a borderless
                  `bg-muted` block at p-4 beside panels that were Card and
                  panels that were a `bg-muted/30` wash with a hairline: four
                  surfaces on one page. The segmented control inside it also
                  painted itself out on a muted ground (docs/DESIGN-LANGUAGE.md,
                  "A control carries its own edge"). Card stack `gap-4`. */}
            <Card className="gap-4 p-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  {/* 600, the card-title weight: this is the preflight
                      panel's title, and it sat at 500 beside 600 card titles. */}
                  <p className="font-semibold">
                    {wallets.length.toLocaleString()} wallet addresses loaded
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Estimated processing time:{' '}
                    {estimateTime(wallets.length, scanDepth)}
                  </p>
                  {extraColumns.length > 0 && (
                    <p className="text-sm text-muted-foreground">
                      Extra columns: {extraColumns.join(', ')}
                    </p>
                  )}
                </div>
                <Button
                  variant="outline"
                  onClick={handleReset}
                  className="shrink-0"
                >
                  <Swap className="h-4 w-4" aria-hidden />
                  Choose different file
                </Button>
              </div>

              <div className="space-y-4 border-t pt-4">
                {/* How long against how thorough */}
                <div className="grid gap-2 sm:grid-cols-[8rem_1fr] sm:items-start sm:gap-4">
                  <Eyebrow className="sm:pt-2.5">Scan depth</Eyebrow>
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
                  <Eyebrow className="sm:pt-2.5">History</Eyebrow>
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
                        Results are not kept. Export them before you leave this
                        page.
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
                          localStorage.setItem(
                            'notifyOnComplete',
                            granted.toString()
                          );
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
            </Card>
          </div>
        )}

        {/* Processing State */}
        {state === 'processing' && (
          <ProgressBar
            progress={progress}
            displayedProcessed={displayedProcessed}
            timeRemaining={getTimeRemaining()}
            onCancel={handleCancel}
            scanDepth={scanDepth}
            includesEns={entitled}
          />
        )}

        {/* Error State. The tint token and a full-opacity edge, the same
            recipe as the caution panels: the red was hand-mixed from
            `destructive/10` and `destructive/20` here and in two dialogs. */}
        {state === 'error' && (
          <div className="p-4 bg-destructive-tint border border-destructive rounded-lg">
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
                <AlertTriangle
                  className="mt-0.5 h-4 w-4 flex-none text-caution"
                  aria-hidden
                />
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
                  /* Every control in a row resolves to `--h-ctl`: the Input
                     at its default height and the two icon Buttons at
                     `size="icon"`. They were three 32px overrides (`h-8`,
                     `h-8 w-8 p-0`), the only controls in the product at that
                     height. The icon buttons are named, since a glyph alone
                     is not a name a screen reader can announce. */
                  <div className="flex items-center gap-2">
                    <Input
                      value={editNameValue}
                      onChange={(e) => setEditNameValue(e.target.value)}
                      placeholder="Enter lookup name..."
                      className="max-w-xs"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveLookupName();
                        if (e.key === 'Escape') setIsEditingName(false);
                      }}
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={handleSaveLookupName}
                      aria-label="Save name"
                    >
                      <Check className="h-4 w-4" aria-hidden />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setIsEditingName(false)}
                      aria-label="Cancel renaming"
                    >
                      <X className="h-4 w-4" aria-hidden />
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
                    {/* gap-2, the step: 10px is not one. */}
                    <div className="flex items-center gap-2">
                      {/* Every path that reaches here sets a name; the
                          size is the last resort, never a generic noun.
                          20px takes the title tracking token; `-0.02em` was
                          a fifth value the four-step scale does not have. */}
                      <h2 className="text-xl font-semibold tracking-[var(--tracking-title)]">
                        {currentLookupName ||
                          `${results.length.toLocaleString()} wallets`}
                      </h2>
                      {/* Any signed-in owner may rename. The server allows it
                            for whoever owns the lookup, and a history you cannot
                            label is a worse product for no reason.

                            Button outline at `size="sm"`, so it resolves to
                            `--h-ctl` like every control in a row. It was a
                            hand-rolled pill whose height came from `px-2.5
                            py-1` around 12px text, about 26px, which no other
                            control in the product agreed with. The brand edge
                            and text say it acts on the name beside it. */}
                      {currentLookupId && user && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setEditNameValue(currentLookupName || '');
                            setIsEditingName(true);
                          }}
                          className="border-accent-brand text-accent-brand hover:bg-accent-brand-tint hover:text-accent-brand"
                        >
                          <Pencil className="h-4 w-4" aria-hidden />
                          Rename
                        </Button>
                      )}
                    </div>
                  </div>
                )}
                {/* The window comes from the constant the cache reads, so the
                    copy cannot say 24h while the TTL says a week. */}
                {cacheHits > 0 && (
                  <p className="text-sm text-muted-foreground">
                    {cacheHits.toLocaleString()}{' '}
                    {cacheHits === 1 ? 'result' : 'results'} from cache (
                    {CACHE_TTL_DAYS} days)
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
                      controls, and the name sits beside all of it.

                      Entitled accounts: any pack or a legacy tier. */}
                {entitled &&
                  (results.some((r) => r.fc_fid) || enrichingFids) && (
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
                        : `DM ${results.filter((r) => r.fc_fid).length.toLocaleString()}`}
                    </Button>
                  )}

                <ExportButton
                  results={results}
                  extraColumns={extraColumns}
                  entitled={entitled}
                  onUpgradeClick={handleOpenUpgradeModal}
                  lookupName={currentLookupName}
                />

                <OverflowMenu>
                  {entitled &&
                    (results.some((r) => r.fc_fid) || enrichingFids) && (
                      <div className="sm:hidden">
                        <MenuItem onClick={() => setShowFarcasterDMModal(true)}>
                          <Send className="h-4 w-4" aria-hidden />
                          DM{' '}
                          {results
                            .filter((r) => r.fc_fid)
                            .length.toLocaleString()}{' '}
                          on Farcaster
                        </MenuItem>
                      </div>
                    )}
                  {/* Growing a saved lookup is included in every pack, and the
                        server charges the added wallets against the same
                        balance. */}
                  {currentLookupId && entitled && (
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
                    twitterCount={
                      results.filter((r) => r.twitter_handle).length
                    }
                    farcasterCount={results.filter((r) => r.farcaster).length}
                    totalWallets={results.length}
                    /* Same predicate as StatsCards, so the shared figure and
                         the one on screen can never disagree. */
                    reachableCount={
                      results.filter(
                        (r) =>
                          r.twitter_handle || r.farcaster || r.lens || r.github
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
              <div className="flex items-start gap-2 rounded-lg border border-caution bg-caution-tint p-3">
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
              entitled={entitled}
              onUpgradeClick={handleOpenUpgradeModal}
              enrichedWallets={enrichedWallets}
              holdingsLabel={
                inputSource === 'contract_import' ? 'Bag' : 'Holdings'
              }
            />
          </div>
        )}
      </div>
    </PageShell>
  );
}
