'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { PageShell } from '@/components/ui/page-shell';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Trash as Trash2, Plus, CircleNotch as Loader2, Lock, Users, Crown, Lightning as Zap, Sparkle as Sparkles, Eye, ArrowsClockwise as RefreshCw, XCircle, Briefcase, ClockCounterClockwise as History, MagnifyingGlass as Search, ChartBar as BarChart3, TrendUp as TrendingUp, CurrencyDollar as DollarSign, Wrench, Gauge, ArrowCounterClockwise as RotateCcw, X, ArrowSquareOut as ExternalLink, PencilSimple as Pencil } from '@phosphor-icons/react';
import {
  ExecutivePulse,
  UserBehavior,
  GrowthRetention,
  RevenueDashboard,
  SystemHealth,
  UniversalSearch,
  WalletEnrichment,
  LookupDashboard,
  UsageMeter,
  AccountDetail,
} from '@/components/admin';

// Tab types - Analytics tabs first, then Operations tabs
type Tab = 'pulse' | 'behavior' | 'growth' | 'revenue' | 'health' | 'usage' | 'whitelist' | 'dashboard' | 'jobs' | 'history' | 'users' | 'enrichment';

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
  pro: number;
  unlimited: number;
  whitelisted: number;
}

interface WalletResult {
  wallet: string;
  twitter_handle?: string;
  twitter_url?: string;
  farcaster?: string;
  farcaster_url?: string;
  ens_name?: string;
  fc_followers?: number;
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
  const [deletingHistoryId, setDeletingHistoryId] = useState<string | null>(null);

  // Users state
  const [usersList, setUsersList] = useState<UserEntry[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [tierFilter, setTierFilter] = useState<string>('');
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

    switch (activeTab) {
      case 'jobs':
        if (jobs.length === 0) fetchJobs();
        break;
      case 'history':
        if (historyEntries.length === 0) fetchHistory();
        break;
      case 'users':
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
  const handleJobAction = async (id: string, action: 'retry' | 'cancel' | 'rerun') => {
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

  // Status badge helper
  const StatusBadge = ({ status }: { status: string }) => {
    const colors: Record<string, string> = {
      pending: 'bg-muted text-muted-foreground',
      processing: 'bg-accent-brand-tint text-accent-brand',
      completed: 'bg-accent-brand-tint text-accent-brand',
      failed: 'bg-destructive/10 text-destructive',
    };
    return (
      <span
        className={`px-2 py-1 rounded-full text-xs font-medium ${colors[status] || colors.pending}`}
      >
        {status}
      </span>
    );
  };

  // Tier badge helper
  const TierBadge = ({ tier, isWhitelisted }: { tier: string; isWhitelisted?: boolean }) => {
    if (isWhitelisted) {
      return (
        <span className="px-2 py-1 rounded-full text-xs font-medium bg-accent-brand-tint text-accent-brand">
          whitelisted
        </span>
      );
    }
    const colors: Record<string, string> = {
      free: 'bg-muted text-muted-foreground',
      pro: 'bg-accent-brand-tint text-accent-brand',
      unlimited: 'bg-caution-tint text-caution',
    };
    return (
      <span
        className={`px-2 py-1 rounded-full text-xs font-medium ${colors[tier] || colors.free}`}
      >
        {tier}
      </span>
    );
  };

  // Get set of whitelisted emails for quick lookup
  const whitelistedEmails = new Set(
    entries.filter(e => e.email).map(e => e.email!.toLowerCase())
  );

  // Password screen
  if (authState === 'password') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-sm w-full">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <Lock className="h-12 w-12 text-muted-foreground" />
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
                Login
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
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Tab content renderers
  const renderWhitelistTab = () => (
    <>
      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Free</span>
              </div>
              <p className="text-2xl font-bold">{stats.free}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-accent-brand" />
                <span className="text-sm text-muted-foreground">Pro</span>
              </div>
              <p className="text-2xl font-bold">{stats.pro}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <Crown className="h-4 w-4 text-caution" />
                <span className="text-sm text-muted-foreground">Unlimited</span>
              </div>
              <p className="text-2xl font-bold">{stats.unlimited}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-accent-brand" />
                <span className="text-sm text-muted-foreground">Whitelisted</span>
              </div>
              <p className="text-2xl font-bold">{stats.whitelisted}</p>
            </CardContent>
          </Card>
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
            <Button type="submit" disabled={isAdding || (!newEmail && !newWallet)}>
              {isAdding ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Adding...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  Add to Whitelist
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
            <p className="text-center text-muted-foreground py-8">
              No whitelist entries yet
            </p>
          ) : (
            <div className="overflow-x-auto">
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
                        {entry.wallet
                          ? `${entry.wallet.slice(0, 6)}...${entry.wallet.slice(-4)}`
                          : '-'}
                      </TableCell>
                      <TableCell>{entry.note || '-'}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {new Date(entry.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => handleDelete(entry.id)}
                          disabled={deletingId === entry.id}
                        >
                          {deletingId === entry.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4 text-destructive" />
                          )}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
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
            <select
              className="px-3 py-1.5 text-sm border rounded-lg bg-background"
              value={jobStatusFilter}
              onChange={(e) => {
                setJobStatusFilter(e.target.value);
                setJobs([]); // Clear to trigger refetch
              }}
            >
              <option value="">All Status</option>
              <option value="pending">Pending</option>
              <option value="processing">Processing</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
            </select>
            <Button variant="outline" size="sm" onClick={fetchJobs} disabled={jobsLoading}>
              {jobsLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {jobsLoading && jobs.length === 0 ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : jobs.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No jobs found</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Wallets</TableHead>
                    <TableHead>Progress</TableHead>
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
                        {job.id.slice(0, 8)}...
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={job.status} />
                      </TableCell>
                      <TableCell>{job.walletCount.toLocaleString()}</TableCell>
                      <TableCell>
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
                              {job.source.tokenSymbol || job.source.tokenName || 'contract'}
                            </span>
                            <span className="text-muted-foreground">
                              {' '}
                              {job.source.chain}
                            </span>
                            {job.source.truncated && (
                              <span className="ml-1 text-caution" title="The holder list was cut off at the limit">
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
                          <span title={job.userTier ? `tier: ${job.userTier}` : undefined}>
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
                      <TableCell className="text-muted-foreground text-sm">
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
                              disabled={viewingJobId === job.id && jobResultsLoading}
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
                          {(job.status === 'pending' || job.status === 'processing') && (
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
            </div>
          )}
        </CardContent>
      </Card>

      {/* Job Results Modal */}
      {viewingJobId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-5xl max-h-[80vh] flex flex-col">
            <CardHeader className="flex flex-row items-center justify-between border-b">
              <div>
                <CardTitle>Job results</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Job ID: {viewingJobId.slice(0, 8)}... • {jobResults?.length || 0} results
                </p>
              </div>
              <Button variant="ghost" size="icon-sm" onClick={closeJobResults}>
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent className="flex-1 overflow-auto p-0">
              {jobResultsLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : !jobResults || jobResults.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">No results found</p>
              ) : (
                <Table>
                  <TableHeader className="sticky top-0 bg-background">
                    <TableRow>
                      <TableHead>Wallet</TableHead>
                      <TableHead>ENS</TableHead>
                      <TableHead>Twitter</TableHead>
                      <TableHead>Farcaster</TableHead>
                      <TableHead>FC Followers</TableHead>
                      <TableHead>Sources</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {jobResults.map((result, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-mono text-xs">
                          {result.wallet.slice(0, 6)}...{result.wallet.slice(-4)}
                        </TableCell>
                        <TableCell>{result.ens_name || '-'}</TableCell>
                        <TableCell>
                          {result.twitter_handle ? (
                            <a
                              href={result.twitter_url || `https://x.com/${result.twitter_handle}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-accent-brand hover:underline flex items-center gap-1"
                            >
                              @{result.twitter_handle}
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : (
                            '-'
                          )}
                        </TableCell>
                        <TableCell>
                          {result.farcaster ? (
                            <a
                              href={result.farcaster_url || `https://warpcast.com/${result.farcaster}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-accent-brand hover:underline flex items-center gap-1"
                            >
                              @{result.farcaster}
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : (
                            '-'
                          )}
                        </TableCell>
                        <TableCell>
                          {result.fc_followers?.toLocaleString() || '-'}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1 flex-wrap">
                            {result.source?.map((s) => (
                              <span
                                key={s}
                                className="px-1.5 py-0.5 text-xs rounded-sm bg-muted"
                              >
                                {s}
                              </span>
                            ))}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );

  const renderHistoryTab = () => (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle>Lookup history ({historyEntries.length})</CardTitle>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by User ID"
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
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setHistoryEntries([]);
              fetchHistory();
            }}
            disabled={historyLoading}
          >
            {historyLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {historyLoading && historyEntries.length === 0 ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : historyEntries.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">No history found</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Wallets</TableHead>
                  <TableHead>Twitter</TableHead>
                  <TableHead>Farcaster</TableHead>
                  <TableHead>User ID</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-16">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {historyEntries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="font-mono text-xs">
                      {entry.id.slice(0, 8)}...
                    </TableCell>
                    <TableCell>{entry.name || '-'}</TableCell>
                    <TableCell>
                      {entry.inputSource ? (
                        <span className={`px-2 py-0.5 text-xs rounded-full ${
                          entry.inputSource === 'file_upload'
                            ? 'bg-accent-brand-tint text-accent-brand'
                            : entry.inputSource === 'text_input'
                            ? 'bg-accent-brand-tint text-accent-brand'
                            : entry.inputSource === 'contract_import'
                            ? 'bg-accent-brand-tint text-accent-brand'
                            : 'bg-muted text-muted-foreground'
                        }`}>
                          {entry.inputSource === 'file_upload' ? 'File' : entry.inputSource === 'text_input' ? 'Paste' : entry.inputSource === 'contract_import' ? 'Contract' : entry.inputSource}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>{entry.walletCount.toLocaleString()}</TableCell>
                    <TableCell>{entry.twitterFound}</TableCell>
                    <TableCell>{entry.farcasterFound}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {entry.userId ? `${entry.userId.slice(0, 8)}...` : '-'}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {new Date(entry.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => handleDeleteHistory(entry.id)}
                        disabled={deletingHistoryId === entry.id}
                      >
                        {deletingHistoryId === entry.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4 text-destructive" />
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );

  const renderUsersTab = () => (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle>Users ({usersList.length})</CardTitle>
        <div className="flex items-center gap-2">
          <select
            className="px-3 py-1.5 text-sm border rounded-lg bg-background"
            value={tierFilter}
            onChange={(e) => {
              setTierFilter(e.target.value);
              setUsersList([]); // Clear to trigger refetch
            }}
          >
            <option value="">All Tiers</option>
            <option value="free">Free</option>
            <option value="pro">Pro</option>
            <option value="unlimited">Unlimited</option>
          </select>
          <Button variant="outline" size="sm" onClick={fetchUsers} disabled={usersLoading}>
            {usersLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {usersLoading && usersList.length === 0 ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : usersList.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">No users found</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Stripe ID</TableHead>
                  <TableHead>Paid At</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-32">Change Tier</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {usersList.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell>
                      {/* Opens the same drill-down the Usage pane does, so the
                          panel has one account view rather than two. */}
                      <button
                        type="button"
                        onClick={() => setOpenAccount(user.email)}
                        className="text-accent-brand underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      >
                        {user.email}
                      </button>
                    </TableCell>
                    <TableCell>
                      <TierBadge tier={user.tier} isWhitelisted={whitelistedEmails.has(user.email.toLowerCase())} />
                    </TableCell>
                    {/* Customer id when one exists, otherwise the payment
                        intent. Every sale taken before `customer_creation:
                        'always'` has no Customer at all, so showing only the
                        customer id rendered a dash next to genuine paying
                        accounts. The payment intent identifies the sale in
                        Stripe just as well. */}
                    <TableCell className="font-mono text-xs" title={user.stripeCustomerId || user.stripePaymentId || undefined}>
                      {user.stripeCustomerId
                        ? `${user.stripeCustomerId.slice(0, 14)}…`
                        : user.stripePaymentId
                          ? `${user.stripePaymentId.slice(0, 14)}…`
                          : '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {user.paidAt ? new Date(user.paidAt).toLocaleString() : '-'}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {new Date(user.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      {updatingUserId === user.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <select
                          className="px-2 py-1 text-xs border rounded-sm bg-background"
                          value={user.tier}
                          onChange={(e) => handleUpdateTier(user.id, e.target.value)}
                        >
                          <option value="free">Free</option>
                          <option value="pro">Pro</option>
                          <option value="unlimited">Unlimited</option>
                        </select>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );

  // Handle metric click from pulse dashboard. Through selectTab for the same
  // reason the tab buttons are: this navigates, so it has to close an open
  // account or the jump would appear to do nothing.
  const handleMetricClick = (metric: string) => {
    if (metric === 'jobs') selectTab('jobs');
    else if (metric === 'behavior') selectTab('behavior');
    else if (metric === 'revenue') selectTab('revenue');
    else if (metric === 'health') selectTab('health');
  };

  // Main admin view
  return (
    /* wide: admin is the one surface where 1152px is genuinely too narrow. Its
       dashboards are dense tables with six or more numeric columns, and squeezing
       them would trade a real working constraint for a cosmetic one. */
    <PageShell wide>
        <header className="mb-8">
          <h1 className="mb-2 text-3xl font-semibold tracking-[var(--tracking-title)]">Admin dashboard</h1>
          <p className="text-muted-foreground">
            Analytics, monitoring, and operational tools
          </p>
        </header>

        {/* Error display */}
        {error && (
          <div className="mb-4 p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
            <p className="text-sm text-destructive">{error}</p>
            <Button
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={() => setError(null)}
            >
              Dismiss
            </Button>
          </div>
        )}

        {/* Tab navigation - Analytics section */}
        <div className="mb-2 font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">
          Analytics
        </div>
        <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
          <Button
            variant={activeTab === 'pulse' ? 'default' : 'outline'}
            onClick={() => selectTab('pulse')}
            className="flex items-center gap-2"
            size="sm"
          >
            <Gauge className="h-4 w-4" />
            Pulse
          </Button>
          <Button
            variant={activeTab === 'behavior' ? 'default' : 'outline'}
            onClick={() => selectTab('behavior')}
            className="flex items-center gap-2"
            size="sm"
          >
            <BarChart3 className="h-4 w-4" />
            Behavior
          </Button>
          <Button
            variant={activeTab === 'growth' ? 'default' : 'outline'}
            onClick={() => selectTab('growth')}
            className="flex items-center gap-2"
            size="sm"
          >
            <TrendingUp className="h-4 w-4" />
            Growth
          </Button>
          <Button
            variant={activeTab === 'revenue' ? 'default' : 'outline'}
            onClick={() => selectTab('revenue')}
            className="flex items-center gap-2"
            size="sm"
          >
            <DollarSign className="h-4 w-4" />
            Revenue
          </Button>
          <Button
            variant={activeTab === 'health' ? 'default' : 'outline'}
            onClick={() => selectTab('health')}
            className="flex items-center gap-2"
            size="sm"
          >
            <Wrench className="h-4 w-4" />
            Health
          </Button>
        </div>

        {/* Tab navigation - Operations section */}
        <div className="mb-2 font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground">
          Operations
        </div>
        <div className="flex gap-2 mb-8 overflow-x-auto pb-2">
          <Button
            variant={activeTab === 'whitelist' ? 'default' : 'outline'}
            onClick={() => selectTab('whitelist')}
            className="flex items-center gap-2"
            size="sm"
          >
            <Sparkles className="h-4 w-4" />
            Whitelist
          </Button>
          <Button
            variant={activeTab === 'dashboard' ? 'default' : 'outline'}
            onClick={() => selectTab('dashboard')}
            className="flex items-center gap-2"
            size="sm"
          >
            <BarChart3 className="h-4 w-4" />
            Dashboard
          </Button>
          <Button
            variant={activeTab === 'jobs' ? 'default' : 'outline'}
            onClick={() => selectTab('jobs')}
            className="flex items-center gap-2"
            size="sm"
          >
            <Briefcase className="h-4 w-4" />
            Jobs
          </Button>
          <Button
            variant={activeTab === 'history' ? 'default' : 'outline'}
            onClick={() => selectTab('history')}
            className="flex items-center gap-2"
            size="sm"
          >
            <History className="h-4 w-4" />
            Saved lookups
          </Button>
          <Button
            variant={activeTab === 'users' ? 'default' : 'outline'}
            onClick={() => selectTab('users')}
            className="flex items-center gap-2"
            size="sm"
          >
            <Users className="h-4 w-4" />
            Users
          </Button>
          <Button
            variant={activeTab === 'usage' ? 'default' : 'outline'}
            onClick={() => selectTab('usage')}
            className="flex items-center gap-2"
            size="sm"
          >
            <Gauge className="h-4 w-4" />
            Usage
          </Button>
          <Button
            variant={activeTab === 'enrichment' ? 'default' : 'outline'}
            onClick={() => selectTab('enrichment')}
            className="flex items-center gap-2"
            size="sm"
          >
            <Pencil className="h-4 w-4" />
            Enrichment
          </Button>
        </div>

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
            <ExecutivePulse password={password} onMetricClick={handleMetricClick} />
            <UniversalSearch password={password} />
          </div>
        )}
        {activeTab === 'behavior' && <UserBehavior password={password} />}
        {activeTab === 'growth' && <GrowthRetention password={password} />}
        {activeTab === 'revenue' && <RevenueDashboard password={password} />}
        {activeTab === 'health' && <SystemHealth password={password} />}

        {/* Tab content - Operations */}
        {activeTab === 'whitelist' && renderWhitelistTab()}
        {activeTab === 'dashboard' && <LookupDashboard password={password} />}
        {activeTab === 'jobs' && renderJobsTab()}
        {activeTab === 'history' && renderHistoryTab()}
        {activeTab === 'users' && renderUsersTab()}
        {activeTab === 'usage' && (
          <UsageMeter password={password} onAccountClick={setOpenAccount} />
        )}
        {activeTab === 'enrichment' && <WalletEnrichment password={password} />}
        </>
        )}
    </PageShell>
  );
}
