'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { PageShell } from '@/components/ui/page-shell';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Modal,
  ModalContent,
  ModalDescription,
  ModalHeader,
  ModalTitle,
} from '@/components/ui/modal';
import { Segmented, type SegmentedOption } from '@/components/ui/segmented';
import { AdminNav, type AdminTab } from '@/components/admin/AdminNav';
import { HandleConflicts } from '@/components/admin/HandleConflicts';
import { Banner } from '@/components/admin/Banner';
import { StatTile } from '@/components/admin/Stat';
import { RefreshButton } from '@/components/admin/RefreshButton';
import { Empty, Loading } from '@/components/admin/PaneState';
import { shortId, shortWallet } from '@/components/admin/format';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Trash as Trash2,
  Plus,
  CircleNotch as Loader2,
  Lock,
  Eye,
  ArrowsClockwise as RefreshCw,
  XCircle,
  MagnifyingGlass as Search,
  ArrowCounterClockwise as RotateCcw,
  ArrowSquareOut,
} from '@phosphor-icons/react';
import { asSourceList } from '@/lib/api-sources';
import {
  ExecutivePulse,
  FunnelPane,
  GrowthRetention,
  RevenueDashboard,
  SystemHealth,
  DependencyHealth,
  UniversalSearch,
  WalletEnrichment,
  LookupDashboard,
  UsageMeter,
  AccountDetail,
} from '@/components/admin';

// The union lives with the nav that renders it, so a new destination cannot be
// added to one and forgotten in the other.
type Tab = AdminTab;

/**
 * The users tab filter. Four states, so it is a segmented control that shows
 * them all rather than a select that hides three. The empty string is "all",
 * kept as the value the API already treats as no filter.
 *
 * Module scope, not inline: `Segmented` keeps the thumb position in arithmetic
 * over this array, and rebuilding it every render gives the memoised children a
 * new identity for no reason.
 */
type TierFilter = '' | 'free' | 'pro' | 'unlimited';
const TIERS: SegmentedOption<TierFilter>[] = [
  { value: '', label: 'All tiers', content: 'All' },
  { value: 'free', label: 'Free', content: 'Free' },
  { value: 'pro', label: 'Pro', content: 'Pro' },
  { value: 'unlimited', label: 'Unlimited', content: 'Unlimited' },
];

// Interfaces
interface WhitelistEntry {
  id: string;
  email: string | null;
  wallet: string | null;
  note: string | null;
  createdAt: string;
}

interface JobEntry {
  id: string;
  status: string;
  walletCount: number;
  processedCount: number;
  currentStage: string | null;
  twitterFound: number;
  farcasterFound: number;
  userId: string | null;
  userEmail: string | null;
  userTier: string | null;
  inputSource: string | null;
  source: {
    contractAddress?: string;
    chain?: string;
    tokenName?: string;
    tokenSymbol?: string;
    contractType?: string;
    totalHolders?: number;
    truncated?: boolean;
  } | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  retryCount: number;
}

interface HistoryEntry {
  id: string;
  name: string | null;
  userId: string | null;
  walletCount: number;
  twitterFound: number;
  farcasterFound: number;
  createdAt: string;
  inputSource: string | null;
}

interface UserEntry {
  id: string;
  email: string;
  tier: string;
  stripeCustomerId: string | null;
  stripePaymentId: string | null;
  paidAt: string | null;
  createdAt: string;
}

interface Stats {
  free: number;
  /** The two legacy accounts. Frozen: nothing sets these tiers any more. */
  pro: number;
  unlimited: number;
  whitelisted: number;
  /** Accounts with a live credit lot. Absent until `getAccessStats` returns it. */
  creditHolders?: number;
}

interface WalletResult {
  wallet: string;
  twitter_handle?: string;
  twitter_url?: string;
  farcaster?: string;
  farcaster_url?: string;
  ens_name?: string;
  fc_followers?: number;
  /**
   * Typed as the list it is supposed to be, read through `asSourceList`.
   *
   * The type is a claim about JSON that arrived over the wire, so it is not
   * enforced anywhere. `unknown` would be more honest and would make every
   * reader deal with it; the narrower type plus one coercion at the single
   * render site is the smaller change and says the same thing.
   */
  source?: string[];
}

type AuthState = 'password' | 'loading' | 'authenticated' | 'error';

export default function AdminPage() {
  const [authState, setAuthState] = useState<AuthState>('password');
  const [password, setPassword] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('pulse');
  /**
   * The account currently opened for a closer look, by email.
   *
   * Held here rather than inside a tab, so any table anywhere in the panel can
   * open one without each of them growing its own copy of the view. It takes
   * over the content area while set, which is what makes it a drill-down rather
   * than a thirteenth tab nobody would think to visit.
   */
  const [openAccount, setOpenAccount] = useState<string | null>(null);

  /**
   * Change tab, and close any open account.
   *
   * Every tab button goes through this rather than calling setActiveTab
   * directly. An open account replaces the whole content area, so a tab that
   * only moved the highlight left the panel looking broken: the button lit up
   * and the screen did not change. Doing it in one place also means the next
   * tab someone adds cannot forget.
   */
  const selectTab = useCallback((tab: Tab) => {
    setActiveTab(tab);
    setOpenAccount(null);
  }, []);
  const [error, setError] = useState<string | null>(null);

  // Whitelist state
  const [entries, setEntries] = useState<WhitelistEntry[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [newEmail, setNewEmail] = useState('');
  const [newWallet, setNewWallet] = useState('');
  const [newNote, setNewNote] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Jobs state
  const [jobs, setJobs] = useState<JobEntry[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobStatusFilter, setJobStatusFilter] = useState<string>('');
  const [actioningJobId, setActioningJobId] = useState<string | null>(null);
  const [viewingJobId, setViewingJobId] = useState<string | null>(null);
  const [jobResults, setJobResults] = useState<WalletResult[] | null>(null);
  const [jobResultsLoading, setJobResultsLoading] = useState(false);

  // History state
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [userIdFilter, setUserIdFilter] = useState('');
  const [deletingHistoryId, setDeletingHistoryId] = useState<string | null>(
    null
  );

  // Users state
  const [usersList, setUsersList] = useState<UserEntry[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [tierFilter, setTierFilter] = useState<TierFilter>('');
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);

  // Check for stored password on mount
  useEffect(() => {
    const storedPassword = sessionStorage.getItem('admin_password');
    if (storedPassword) {
      setPassword(storedPassword);
      fetchWhitelist(storedPassword);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch whitelist
  const fetchWhitelist = useCallback(async (pwd: string) => {
    setAuthState('loading');
    setError(null);

    try {
      const response = await fetch('/api/admin/whitelist', {
        headers: { 'x-admin-password': pwd },
      });

      if (response.status === 401) {
        setAuthState('password');
        setError('Invalid password');
        sessionStorage.removeItem('admin_password');
        return;
      }

      if (!response.ok) throw new Error('Failed to fetch whitelist');

      const data = await response.json();
      setEntries(data.entries);
      setStats(data.stats);
      setAuthState('authenticated');
      sessionStorage.setItem('admin_password', pwd);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
      setAuthState('error');
    }
  }, []);

  // Fetch all jobs
  const fetchJobs = useCallback(async () => {
    setJobsLoading(true);
    try {
      const url = jobStatusFilter
        ? `/api/admin/jobs?status=${jobStatusFilter}`
        : '/api/admin/jobs';
      const response = await fetch(url, {
        headers: { 'x-admin-password': password },
      });
      if (!response.ok) throw new Error('Failed to fetch jobs');
      const data = await response.json();
      setJobs(data.jobs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load jobs');
    } finally {
      setJobsLoading(false);
    }
  }, [password, jobStatusFilter]);

  // Fetch history
  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const url = userIdFilter
        ? `/api/admin/history?userId=${encodeURIComponent(userIdFilter)}`
        : '/api/admin/history';
      const response = await fetch(url, {
        headers: { 'x-admin-password': password },
      });
      if (!response.ok) throw new Error('Failed to fetch history');
      const data = await response.json();
      setHistoryEntries(data.entries);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load history');
    } finally {
      setHistoryLoading(false);
    }
  }, [password, userIdFilter]);

  // Fetch users
  const fetchUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const url = tierFilter
        ? `/api/admin/users?tier=${tierFilter}`
        : '/api/admin/users';
      const response = await fetch(url, {
        headers: { 'x-admin-password': password },
      });
      if (!response.ok) throw new Error('Failed to fetch users');
      const data = await response.json();
      setUsersList(data.users);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setUsersLoading(false);
    }
  }, [password, tierFilter]);

  // Load data when tab changes
  useEffect(() => {
    if (authState !== 'authenticated') return;

    // Records holds both lists, so opening it loads both. They were two
    // destinations and one of them was always the wrong guess: a job and the
    // saved lookup it produced are the same run seen twice.
    switch (activeTab) {
      case 'records':
        if (jobs.length === 0) fetchJobs();
        if (historyEntries.length === 0) fetchHistory();
        break;
      case 'accounts':
        if (usersList.length === 0) fetchUsers();
        break;
    }
  }, [
    activeTab,
    authState,
    jobs.length,
    historyEntries.length,
    usersList.length,
    fetchJobs,
    fetchHistory,
    fetchUsers,
  ]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (password) fetchWhitelist(password);
  };

  // Whitelist handlers
  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail && !newWallet) {
      setError('Email or wallet required');
      return;
    }

    setIsAdding(true);
    setError(null);

    try {
      const response = await fetch('/api/admin/whitelist', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-password': password,
        },
        body: JSON.stringify({
          email: newEmail || undefined,
          wallet: newWallet || undefined,
          note: newNote || undefined,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to add');
      }

      await fetchWhitelist(password);
      setNewEmail('');
      setNewWallet('');
      setNewNote('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add');
    } finally {
      setIsAdding(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    setError(null);

    try {
      const response = await fetch(`/api/admin/whitelist?id=${id}`, {
        method: 'DELETE',
        headers: { 'x-admin-password': password },
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete');
      }

      setEntries((prev) => prev.filter((e) => e.id !== id));
      if (stats) {
        setStats({ ...stats, whitelisted: stats.whitelisted - 1 });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    } finally {
      setDeletingId(null);
    }
  };

  // Jobs handlers
  const handleJobAction = async (
    id: string,
    action: 'retry' | 'cancel' | 'rerun'
  ) => {
    setActioningJobId(id);
    try {
      const response = await fetch('/api/admin/jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-password': password,
        },
        body: JSON.stringify({ id, action }),
      });

      if (!response.ok) throw new Error(`Failed to ${action} job`);

      await fetchJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${action}`);
    } finally {
      setActioningJobId(null);
    }
  };

  // Fetch job results for viewing
  const fetchJobResults = async (jobId: string) => {
    setViewingJobId(jobId);
    setJobResultsLoading(true);
    try {
      const response = await fetch(`/api/admin/jobs?id=${jobId}`, {
        headers: { 'x-admin-password': password },
      });
      if (!response.ok) throw new Error('Failed to fetch job results');
      const data = await response.json();
      setJobResults(data.job.results || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load results');
      setViewingJobId(null);
    } finally {
      setJobResultsLoading(false);
    }
  };

  const closeJobResults = () => {
    setViewingJobId(null);
    setJobResults(null);
  };

  // History handlers
  const handleDeleteHistory = async (id: string) => {
    setDeletingHistoryId(id);
    try {
      const response = await fetch(`/api/admin/history?id=${id}`, {
        method: 'DELETE',
        headers: { 'x-admin-password': password },
      });

      if (!response.ok) throw new Error('Failed to delete');

      setHistoryEntries((prev) => prev.filter((entry) => entry.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    } finally {
      setDeletingHistoryId(null);
    }
  };

  // Users handlers
  const handleUpdateTier = async (id: string, newTier: string) => {
    setUpdatingUserId(id);
    try {
      const response = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-password': password,
        },
        body: JSON.stringify({ id, tier: newTier }),
      });

      if (!response.ok) throw new Error('Failed to update tier');

      setUsersList((prev) =>
        prev.map((user) => (user.id === id ? { ...user, tier: newTier } : user))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update');
    } finally {
      setUpdatingUserId(null);
    }
  };

  // Job status, as a Badge tone. A completed job is a measured outcome, so it
  // is green: violet is for things you can act on, and a finished job is not
  // one of them. A failed job takes the one red tone a badge has.
  const jobStatusTone = (
    status: string
  ): 'muted' | 'brand' | 'attested' | 'destructive' =>
    status === 'failed'
      ? 'destructive'
      : status === 'processing'
        ? 'brand'
        : status === 'completed'
          ? 'attested'
          : 'muted';

  // Legacy tier, as a Badge tone. Pro and Unlimited are ours rather than good
  // or bad, so they share the brand tint; the whitelist is a measured grant of
  // access, so it is green, the same as AccountDetail paints it.
  const tierTone = (tier: string): 'muted' | 'brand' =>
    tier === 'pro' || tier === 'unlimited' ? 'brand' : 'muted';

  // Get set of whitelisted emails for quick lookup
  const whitelistedEmails = new Set(
    entries.filter((e) => e.email).map((e) => e.email!.toLowerCase())
  );

  // Password screen
  if (authState === 'password') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-sm w-full">
          <CardHeader className="text-center">
            {/* Display scale, `h-10 w-10`, duotone: the illustrative weight
                for an illustrative moment. It was 48px, which is not a step. */}
            <div className="flex justify-center mb-4">
              <Lock
                weight="duotone"
                className="h-10 w-10 text-muted-foreground"
                aria-hidden
              />
            </div>
            <CardTitle>Admin access</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <Input
                type="password"
                placeholder="Enter admin password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
              />
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full">
                Sign in
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Loading state
  if (authState === 'loading') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loading />
      </div>
    );
  }

  // Tab content renderers
  const renderWhitelistTab = () => (
    <>
      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {/* `free` is every account without a legacy tier, which includes
              every pack buyer. The paying base is the credit-holder count. */}
          <StatTile label="No legacy tier" value={stats.free} />
          <StatTile
            label="Credit holders"
            value={stats.creditHolders ?? '-'}
            note="accounts with a live pack"
          />
          <StatTile
            label="Legacy"
            value={stats.pro + stats.unlimited}
            note={`${stats.pro} pro, ${stats.unlimited} unlimited, honoured forever`}
          />
          <StatTile label="Whitelisted" value={stats.whitelisted} />
        </div>
      )}

      {/* Add to whitelist form */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Add to whitelist</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAdd} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <Input
                placeholder="Email (optional)"
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
              />
              <Input
                placeholder="Wallet (optional)"
                value={newWallet}
                onChange={(e) => setNewWallet(e.target.value)}
              />
              <Input
                placeholder="Note (optional)"
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
              />
            </div>
            <Button
              type="submit"
              disabled={isAdding || (!newEmail && !newWallet)}
            >
              {isAdding ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Adding…
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4" aria-hidden />
                  Add to whitelist
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Whitelist table */}
      <Card>
        <CardHeader>
          <CardTitle>Whitelist entries ({entries.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <Empty>No whitelist entries yet</Empty>
          ) : (
            /* No wrapper: `Table` already renders its own overflow-x-auto
               container, and a second one outside it never scrolls. */
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Wallet</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead className="w-16"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>{entry.email || '-'}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {entry.wallet ? shortWallet(entry.wallet) : '-'}
                    </TableCell>
                    <TableCell>{entry.note || '-'}</TableCell>
                    <TableCell className="font-mono text-xs tabular-nums text-muted-foreground">
                      {new Date(entry.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => handleDelete(entry.id)}
                        disabled={deletingId === entry.id}
                        aria-label="Remove from whitelist"
                      >
                        {deletingId === entry.id ? (
                          <Loader2
                            className="h-4 w-4 animate-spin"
                            aria-hidden
                          />
                        ) : (
                          <Trash2
                            className="h-4 w-4 text-destructive"
                            aria-hidden
                          />
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );

  const renderJobsTab = () => (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle>Jobs ({jobs.length})</CardTitle>
          <div className="flex items-center gap-2">
            {/* Five states, one past what a segmented control shows, so it
                stays a select. `h-control` so it agrees with the button beside
                it, and `border-input` because a control's edge has to clear
                3:1; the bare `border` it had was the decorative card hairline. */}
            <select
              className="h-control rounded-lg border border-input bg-background px-3 text-sm"
              aria-label="Filter by status"
              value={jobStatusFilter}
              onChange={(e) => {
                setJobStatusFilter(e.target.value);
                setJobs([]); // Clear to trigger refetch
              }}
            >
              <option value="">All statuses</option>
              <option value="pending">Pending</option>
              <option value="processing">Processing</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
            </select>
            <RefreshButton onClick={fetchJobs} loading={jobsLoading} />
          </div>
        </CardHeader>
        <CardContent>
          {jobsLoading && jobs.length === 0 ? (
            <Loading />
          ) : jobs.length === 0 ? (
            <Empty>No jobs found</Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Wallets</TableHead>
                  <TableHead className="text-right">Progress</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Error</TableHead>
                  <TableHead className="w-32">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell className="font-mono text-xs">
                      {shortId(job.id)}
                    </TableCell>
                    <TableCell>
                      <Badge tone={jobStatusTone(job.status)}>
                        {job.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {job.walletCount.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {job.processedCount}/{job.walletCount}
                    </TableCell>
                    <TableCell>{job.currentStage || '-'}</TableCell>
                    {/* What was looked up, not just how many. A contract
                          import names the token; anything else names how the
                          wallets arrived. */}
                    <TableCell className="text-sm">
                      {job.source?.contractAddress ? (
                        <span
                          title={`${job.source.contractAddress} on ${job.source.chain ?? 'unknown chain'}`}
                        >
                          <span className="font-medium">
                            {job.source.tokenSymbol ||
                              job.source.tokenName ||
                              'contract'}
                          </span>
                          <span className="text-muted-foreground">
                            {' '}
                            {job.source.chain}
                          </span>
                          {job.source.truncated && (
                            <span
                              className="ml-1 text-caution"
                              title="The holder list was cut off at the limit"
                            >
                              truncated
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          {(job.inputSource || '-').replace(/_/g, ' ')}
                        </span>
                      )}
                    </TableCell>
                    {/* The email when the job was signed in. An anonymous job
                          stores a localStorage uuid that identifies nobody, so
                          say so rather than print eight meaningless characters. */}
                    <TableCell className="text-sm">
                      {job.userEmail ? (
                        <span
                          title={
                            job.userTier ? `tier: ${job.userTier}` : undefined
                          }
                        >
                          {job.userEmail}
                        </span>
                      ) : job.userId ? (
                        <span
                          className="text-muted-foreground"
                          title={`anonymous visitor ${job.userId}`}
                        >
                          anonymous
                        </span>
                      ) : (
                        <span className="text-muted-foreground">system</span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs tabular-nums text-muted-foreground">
                      {new Date(job.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell
                      className="text-xs text-destructive max-w-[200px] truncate"
                      title={job.errorMessage || ''}
                    >
                      {job.errorMessage || '-'}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {/* View Results - for completed or partially processed jobs */}
                        {job.processedCount > 0 && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => fetchJobResults(job.id)}
                            disabled={
                              viewingJobId === job.id && jobResultsLoading
                            }
                            title="View results"
                          >
                            {viewingJobId === job.id && jobResultsLoading ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Eye className="h-4 w-4 text-accent-brand" />
                            )}
                          </Button>
                        )}
                        {/* Rerun - for completed jobs */}
                        {job.status === 'completed' && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => handleJobAction(job.id, 'rerun')}
                            disabled={actioningJobId === job.id}
                            title="Rerun job"
                          >
                            {actioningJobId === job.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <RotateCcw className="h-4 w-4 text-accent-brand" />
                            )}
                          </Button>
                        )}
                        {/* Retry - for failed jobs */}
                        {job.status === 'failed' && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => handleJobAction(job.id, 'retry')}
                            disabled={actioningJobId === job.id}
                            title="Retry"
                          >
                            {actioningJobId === job.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <RefreshCw className="h-4 w-4 text-caution" />
                            )}
                          </Button>
                        )}
                        {/* Cancel - for pending or processing jobs */}
                        {(job.status === 'pending' ||
                          job.status === 'processing') && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => handleJobAction(job.id, 'cancel')}
                            disabled={actioningJobId === job.id}
                            title="Cancel"
                          >
                            {actioningJobId === job.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <XCircle className="h-4 w-4 text-destructive" />
                            )}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Job results dialog. Radix owns the behaviour: overlay, focus trap,
          focus restore, Escape, the labelled close, and the 100dvh bound with
          a body that scrolls. This was a `fixed inset-0` div around a Card,
          which had none of that, and an unnamed X to close it. */}
      <Modal
        open={!!viewingJobId}
        onOpenChange={(open) => {
          if (!open) closeJobResults();
        }}
      >
        <ModalContent className="max-w-5xl">
          <ModalHeader>
            <ModalTitle>Job results</ModalTitle>
            <ModalDescription>
              Job {viewingJobId ? shortId(viewingJobId) : ''} ·{' '}
              {jobResults?.length || 0} results
            </ModalDescription>
          </ModalHeader>
          {jobResultsLoading ? (
            <Loading />
          ) : !jobResults || jobResults.length === 0 ? (
            <Empty>No results found</Empty>
          ) : (
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead>Wallet</TableHead>
                  <TableHead>ENS</TableHead>
                  <TableHead>X handle</TableHead>
                  <TableHead>Farcaster</TableHead>
                  <TableHead className="text-right">
                    Farcaster followers
                  </TableHead>
                  <TableHead>Sources</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobResults.map((result, idx) => (
                  <TableRow key={idx}>
                    <TableCell className="font-mono text-xs">
                      {shortWallet(result.wallet)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {result.ens_name || '-'}
                    </TableCell>
                    {/* A handle in its own cell is mono (it is machine data)
                        and a link is the link variant, at the inline size so
                        the row keeps its height. `size-3` rather than
                        `h-3 w-3` on the glyph: Button forces `size-4` on any
                        svg whose class lacks "size-", so that spelling is the
                        only one that renders at 12px inside a Button. */}
                    <TableCell>
                      {result.twitter_handle ? (
                        <Button
                          asChild
                          variant="link"
                          size="inline"
                          className="font-mono text-xs"
                        >
                          <a
                            href={
                              result.twitter_url ||
                              `https://x.com/${result.twitter_handle}`
                            }
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            @{result.twitter_handle}
                            <ArrowSquareOut className="size-3" aria-hidden />
                          </a>
                        </Button>
                      ) : (
                        '-'
                      )}
                    </TableCell>
                    <TableCell>
                      {result.farcaster ? (
                        <Button
                          asChild
                          variant="link"
                          size="inline"
                          className="font-mono text-xs"
                        >
                          <a
                            href={
                              result.farcaster_url ||
                              `https://warpcast.com/${result.farcaster}`
                            }
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            @{result.farcaster}
                            <ArrowSquareOut className="size-3" aria-hidden />
                          </a>
                        </Button>
                      ) : (
                        '-'
                      )}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {result.fc_followers?.toLocaleString() || '-'}
                    </TableCell>
                    {/* Pipeline stage markers, not provenance: `graph` and
                        `cache` sit in here too, so every one is muted. */}
                    <TableCell>
                      <div className="flex gap-1 flex-wrap">
                        {/* `title`: a marker such as farcaster_sweep is
                            longer than the 12ch a badge shows. */}
                        {/* `asSourceList`, not `.map`. The field is typed
                            `string[]` and that type is a claim about JSON
                            nothing validated: two stored rows held the
                            comma-joined string our own CSV export writes,
                            re-uploaded by a customer, and this line threw
                            `source?.map is not a function` and took the whole
                            page down with it. The writer is fixed in
                            lib/job-processor.ts; this is what makes the rows
                            already in the database readable. */}
                        {asSourceList(result.source).map((s) => (
                          <Badge key={s} tone="muted" title={s}>
                            {s}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </ModalContent>
      </Modal>
    </>
  );

  const renderHistoryTab = () => (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        {/* The same words as the nav button that opens it. */}
        <CardTitle>Saved lookups ({historyEntries.length})</CardTitle>
        <div className="flex items-center gap-2">
          {/* `left-3`: the glyph sat at 10px, which is not a spacing step;
              12px is the nearest. */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by user ID"
              value={userIdFilter}
              onChange={(e) => setUserIdFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setHistoryEntries([]);
                }
              }}
              className="pl-8 w-48"
            />
          </div>
          <RefreshButton
            onClick={() => {
              setHistoryEntries([]);
              fetchHistory();
            }}
            loading={historyLoading}
          />
        </div>
      </CardHeader>
      <CardContent>
        {historyLoading && historyEntries.length === 0 ? (
          <Loading />
        ) : historyEntries.length === 0 ? (
          <Empty>No history found</Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Wallets</TableHead>
                <TableHead className="text-right">X</TableHead>
                <TableHead className="text-right">Farcaster</TableHead>
                <TableHead>User ID</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-16">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {historyEntries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="font-mono text-xs">
                    {shortId(entry.id)}
                  </TableCell>
                  <TableCell>{entry.name || '-'}</TableCell>
                  {/* How the wallets arrived. One tone for all three: the
                      chip used to paint File, Paste and Contract the same
                      violet, so the colour carried nothing. */}
                  <TableCell>
                    {entry.inputSource ? (
                      <Badge tone="muted">
                        {entry.inputSource === 'file_upload'
                          ? 'File'
                          : entry.inputSource === 'text_input'
                            ? 'Paste'
                            : entry.inputSource === 'contract_import'
                              ? 'Contract'
                              : entry.inputSource}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {entry.walletCount.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {entry.twitterFound}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {entry.farcasterFound}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {entry.userId ? shortId(entry.userId) : '-'}
                  </TableCell>
                  <TableCell className="font-mono text-xs tabular-nums text-muted-foreground">
                    {new Date(entry.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => handleDeleteHistory(entry.id)}
                      disabled={deletingHistoryId === entry.id}
                      aria-label="Delete lookup"
                    >
                      {deletingHistoryId === entry.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      ) : (
                        <Trash2
                          className="h-4 w-4 text-destructive"
                          aria-hidden
                        />
                      )}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );

  const renderUsersTab = () => (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle>Users ({usersList.length})</CardTitle>
        <div className="flex items-center gap-2">
          <Segmented
            ariaLabel="Tier"
            options={TIERS}
            value={tierFilter}
            onChange={(tier) => {
              setTierFilter(tier);
              setUsersList([]); // Clear to trigger refetch
            }}
          />
          <RefreshButton onClick={fetchUsers} loading={usersLoading} />
        </div>
      </CardHeader>
      <CardContent>
        {usersLoading && usersList.length === 0 ? (
          <Loading />
        ) : usersList.length === 0 ? (
          <Empty>No users found</Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Tier</TableHead>
                <TableHead>Stripe ID</TableHead>
                <TableHead>Paid at</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-32">Change tier</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usersList.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    {/* Opens the same drill-down the Usage pane does, so the
                          panel has one account view rather than two. */}
                    <Button
                      variant="link"
                      size="inline"
                      onClick={() => setOpenAccount(user.email)}
                    >
                      {user.email}
                    </Button>
                  </TableCell>
                  <TableCell>
                    {whitelistedEmails.has(user.email.toLowerCase()) ? (
                      <Badge tone="attested">whitelisted</Badge>
                    ) : (
                      <Badge tone={tierTone(user.tier)}>{user.tier}</Badge>
                    )}
                  </TableCell>
                  {/* Customer id when one exists, otherwise the payment
                        intent. Every sale taken before `customer_creation:
                        'always'` has no Customer at all, so showing only the
                        customer id rendered a dash next to genuine paying
                        accounts. The payment intent identifies the sale in
                        Stripe just as well. */}
                  <TableCell
                    className="font-mono text-xs"
                    title={
                      user.stripeCustomerId || user.stripePaymentId || undefined
                    }
                  >
                    {user.stripeCustomerId
                      ? `${user.stripeCustomerId.slice(0, 14)}…`
                      : user.stripePaymentId
                        ? `${user.stripePaymentId.slice(0, 14)}…`
                        : '-'}
                  </TableCell>
                  <TableCell className="font-mono text-xs tabular-nums text-muted-foreground">
                    {user.paidAt ? new Date(user.paidAt).toLocaleString() : '-'}
                  </TableCell>
                  <TableCell className="font-mono text-xs tabular-nums text-muted-foreground">
                    {new Date(user.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    {/* Pro and Unlimited are retired and permanently
                          unmetered, so they are not offered here: the only
                          thing this control can do now is move one of the two
                          legacy accounts back to free. Goodwill credit is a
                          lot (`grantCredits`), not a tier. */}
                    {updatingUserId === user.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : user.tier === 'free' ? (
                      <span className="text-xs text-muted-foreground">
                        credits only
                      </span>
                    ) : (
                      /* A control, so it takes the control height and the
                           control edge rather than a chip radius and the
                           decorative hairline. At 34px inside a p-2 cell it
                           opens the two legacy rows to 50px; that is the
                           price of a select that can be seen and hit, and
                           there are only two such rows. */
                      <select
                        className="h-control rounded-lg border border-input bg-background px-3 text-sm"
                        aria-label="Change tier"
                        value={user.tier}
                        onChange={(e) =>
                          handleUpdateTier(user.id, e.target.value)
                        }
                      >
                        <option value={user.tier}>{user.tier} (legacy)</option>
                        <option value="free">Free</option>
                      </select>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );

  /*
   * The pulse tiles navigate through `selectTab` directly now.
   *
   * There was a `handleMetricClick(metric: string)` here that matched four
   * string literals and silently did nothing for anything else. It took a
   * `string`, so the tab rename in this change would have compiled cleanly and
   * left two tiles inert at runtime. `AdminTab` makes that a type error at the
   * call site instead.
   */

  // Main admin view
  return (
    /* wide: admin is the one surface where 1152px is genuinely too narrow. Its
       dashboards are dense tables with six or more numeric columns, and squeezing
       them would trade a real working constraint for a cosmetic one. */
    <PageShell wide>
      {/* The one page opening: an h1 at the display tier with the emphasis
          span (one 600-weight word inside a 200-weight line), then a
          300-weight lede. No `sm:text-5xl`: that step is for marketing pages,
          and this is a tool. */}
      <header className="mb-12">
        <h1 className="mb-4 text-4xl font-extralight tracking-[var(--tracking-display)]">
          Admin{' '}
          <em className="font-semibold not-italic text-accent-brand">
            dashboard
          </em>
        </h1>
        <p className="max-w-[68ch] text-lg font-light tracking-[var(--tracking-lead)] text-muted-foreground">
          Analytics, monitoring, and operational tools
        </p>
      </header>

      {/* Error display: the one error banner every pane uses. */}
      {error && (
        <Banner tone="error" className="mb-4">
          <p>{error}</p>
          {/* Dismiss is a neutral control, not a destructive one: it states
              its own colour so it does not inherit the banner's red. */}
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 text-foreground"
            onClick={() => setError(null)}
          >
            Dismiss
          </Button>
        </Banner>
      )}

      <AdminNav active={activeTab} onSelect={selectTab} />

      {/* An open account replaces the tab content entirely. Rendering it
            above a tab would leave two subjects on screen at once, and the
            reader would have to work out which numbers belonged to which. */}
      {openAccount ? (
        <AccountDetail
          email={openAccount}
          password={password}
          onBack={() => setOpenAccount(null)}
        />
      ) : (
        <>
          {/* Tab content - Analytics */}
          {activeTab === 'pulse' && (
            <div className="space-y-6">
              <ExecutivePulse password={password} onMetricClick={selectTab} />
              <UniversalSearch password={password} />
            </div>
          )}
          {activeTab === 'funnel' && <FunnelPane password={password} />}
          {activeTab === 'growth' && <GrowthRetention password={password} />}
          {activeTab === 'revenue' && <RevenueDashboard password={password} />}
          {activeTab === 'health' && (
            <div className="space-y-6">
              {/* One heading over both cards, in the words the nav button
                  uses. Each card keeps its own title beneath it. */}
              <h2 className="text-2xl font-light tracking-[var(--tracking-title)]">
                Health
              </h2>
              {/* Above SystemHealth on purpose: "is it configured and running"
                has to be answered before "how did it perform", or a panel of
                zeroes reads as calm rather than as switched off. */}
              <DependencyHealth password={password} />
              <SystemHealth password={password} />
            </div>
          )}

          {/* Tab content - Operations.

              Four destinations, each holding the panes that answer one
              question. They were eight, and four of the pairs below sat under
              separate nav buttons answering the same thing from two places.
              Composed here rather than merged inside the panes: each pane still
              owns its own fetch, its own error and its own heading, so this is
              a change to where they are read, not to what they measure. */}
          {activeTab === 'usage' && (
            <div className="space-y-6">
              {/* Both count lookups and wallets over a period. The first does
                  it for the system, the second per account, and reading one
                  without the other was how "we are busy" and "one account is
                  busy" got confused. */}
              <LookupDashboard password={password} />
              <UsageMeter password={password} onAccountClick={setOpenAccount} />
            </div>
          )}
          {activeTab === 'records' && (
            <div className="space-y-6">
              {renderJobsTab()}
              {renderHistoryTab()}
            </div>
          )}
          {activeTab === 'accounts' && (
            <div className="space-y-6">
              {renderUsersTab()}
              {/* A whitelist entry is an entitlement on an account, so it
                  belongs beside the accounts rather than in a destination of
                  its own. */}
              {renderWhitelistTab()}
            </div>
          )}
          {activeTab === 'data' && (
            <div className="space-y-6">
              <WalletEnrichment password={password} />
              <HandleConflicts password={password} />
            </div>
          )}
        </>
      )}
    </PageShell>
  );
}
