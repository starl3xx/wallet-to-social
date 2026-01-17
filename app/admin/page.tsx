'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
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
import {
  Trash2,
  Plus,
  Loader2,
  Lock,
  Users,
  Crown,
  Zap,
  Sparkles,
  Eye,
  EyeOff,
  RefreshCw,
  XCircle,
  Activity,
  Briefcase,
  History,
  Search,
} from 'lucide-react';

// Tab types
type Tab = 'whitelist' | 'activity' | 'jobs' | 'history' | 'users';

// Interfaces
interface WhitelistEntry {
  id: string;
  email: string | null;
  wallet: string | null;
  note: string | null;
  createdAt: string;
}

interface ActivityJob {
  id: string;
  walletCount: number;
  twitterFound: number;
  farcasterFound: number;
  completedAt: string;
  hidden: boolean;
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
}

interface UserEntry {
  id: string;
  email: string;
  tier: string;
  stripeCustomerId: string | null;
  paidAt: string | null;
  createdAt: string;
}

interface Stats {
  free: number;
  pro: number;
  unlimited: number;
  whitelisted: number;
}

type AuthState = 'password' | 'loading' | 'authenticated' | 'error';

export default function AdminPage() {
  const [authState, setAuthState] = useState<AuthState>('password');
  const [password, setPassword] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('whitelist');
  const [error, setError] = useState<string | null>(null);

  // Whitelist state
  const [entries, setEntries] = useState<WhitelistEntry[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [newEmail, setNewEmail] = useState('');
  const [newWallet, setNewWallet] = useState('');
  const [newNote, setNewNote] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Activity state
  const [activityJobs, setActivityJobs] = useState<ActivityJob[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Jobs state
  const [jobs, setJobs] = useState<JobEntry[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobStatusFilter, setJobStatusFilter] = useState<string>('');
  const [actioningJobId, setActioningJobId] = useState<string | null>(null);

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

  // Fetch activity jobs
  const fetchActivity = useCallback(async () => {
    setActivityLoading(true);
    try {
      const response = await fetch('/api/admin/activity', {
        headers: { 'x-admin-password': password },
      });
      if (!response.ok) throw new Error('Failed to fetch activity');
      const data = await response.json();
      setActivityJobs(data.jobs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load activity');
    } finally {
      setActivityLoading(false);
    }
  }, [password]);

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
      case 'activity':
        if (activityJobs.length === 0) fetchActivity();
        break;
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
    activityJobs.length,
    jobs.length,
    historyEntries.length,
    usersList.length,
    fetchActivity,
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

  // Activity handlers
  const handleToggleHidden = async (id: string, hidden: boolean) => {
    setTogglingId(id);
    try {
      const response = await fetch('/api/admin/activity', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-password': password,
        },
        body: JSON.stringify({ id, hidden: !hidden }),
      });

      if (!response.ok) throw new Error('Failed to toggle visibility');

      setActivityJobs((prev) =>
        prev.map((job) => (job.id === id ? { ...job, hidden: !hidden } : job))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle');
    } finally {
      setTogglingId(null);
    }
  };

  const handleDeleteActivity = async (id: string) => {
    setDeletingId(id);
    try {
      const response = await fetch(`/api/admin/activity?id=${id}`, {
        method: 'DELETE',
        headers: { 'x-admin-password': password },
      });

      if (!response.ok) throw new Error('Failed to delete');

      setActivityJobs((prev) => prev.filter((job) => job.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    } finally {
      setDeletingId(null);
    }
  };

  // Jobs handlers
  const handleJobAction = async (id: string, action: 'retry' | 'cancel') => {
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
      pending: 'bg-gray-100 text-gray-800',
      processing: 'bg-blue-100 text-blue-800',
      completed: 'bg-green-100 text-green-800',
      failed: 'bg-red-100 text-red-800',
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
  const TierBadge = ({ tier }: { tier: string }) => {
    const colors: Record<string, string> = {
      free: 'bg-gray-100 text-gray-800',
      pro: 'bg-blue-100 text-blue-800',
      unlimited: 'bg-yellow-100 text-yellow-800',
    };
    return (
      <span
        className={`px-2 py-1 rounded-full text-xs font-medium ${colors[tier] || colors.free}`}
      >
        {tier}
      </span>
    );
  };

  // Password screen
  if (authState === 'password') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-sm w-full">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <Lock className="h-12 w-12 text-muted-foreground" />
            </div>
            <CardTitle>Admin Access</CardTitle>
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
                <Zap className="h-4 w-4 text-blue-500" />
                <span className="text-sm text-muted-foreground">Pro</span>
              </div>
              <p className="text-2xl font-bold">{stats.pro}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <Crown className="h-4 w-4 text-yellow-500" />
                <span className="text-sm text-muted-foreground">Unlimited</span>
              </div>
              <p className="text-2xl font-bold">{stats.unlimited}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-purple-500" />
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
          <CardTitle>Add to Whitelist</CardTitle>
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
          <CardTitle>Whitelist Entries ({entries.length})</CardTitle>
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

  const renderActivityTab = () => (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Live Activity ({activityJobs.length})</CardTitle>
        <Button variant="outline" size="sm" onClick={fetchActivity} disabled={activityLoading}>
          {activityLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </Button>
      </CardHeader>
      <CardContent>
        {activityLoading && activityJobs.length === 0 ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : activityJobs.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">No activity yet</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Wallets</TableHead>
                  <TableHead>Twitter</TableHead>
                  <TableHead>Farcaster</TableHead>
                  <TableHead>Match Rate</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Hidden</TableHead>
                  <TableHead className="w-24">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activityJobs.map((job) => {
                  const matchRate =
                    job.walletCount > 0
                      ? Math.round(
                          ((job.twitterFound + job.farcasterFound) / job.walletCount) * 100
                        )
                      : 0;
                  return (
                    <TableRow key={job.id} className={job.hidden ? 'opacity-50' : ''}>
                      <TableCell className="font-mono text-xs">
                        {job.id.slice(0, 8)}...
                      </TableCell>
                      <TableCell>{job.walletCount.toLocaleString()}</TableCell>
                      <TableCell>{job.twitterFound}</TableCell>
                      <TableCell>{job.farcasterFound}</TableCell>
                      <TableCell>{matchRate}%</TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {job.completedAt
                          ? new Date(job.completedAt).toLocaleString()
                          : '-'}
                      </TableCell>
                      <TableCell>
                        {job.hidden ? (
                          <EyeOff className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <Eye className="h-4 w-4 text-green-500" />
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => handleToggleHidden(job.id, job.hidden)}
                            disabled={togglingId === job.id}
                            title={job.hidden ? 'Show' : 'Hide'}
                          >
                            {togglingId === job.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : job.hidden ? (
                              <Eye className="h-4 w-4" />
                            ) : (
                              <EyeOff className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => handleDeleteActivity(job.id)}
                            disabled={deletingId === job.id}
                          >
                            {deletingId === job.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4 text-destructive" />
                            )}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );

  const renderJobsTab = () => (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle>Jobs ({jobs.length})</CardTitle>
        <div className="flex items-center gap-2">
          <select
            className="px-3 py-1.5 text-sm border rounded-md bg-background"
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
                  <TableHead>User</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Error</TableHead>
                  <TableHead className="w-24">Actions</TableHead>
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
                    <TableCell className="font-mono text-xs">
                      {job.userId ? `${job.userId.slice(0, 8)}...` : '-'}
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
                              <RefreshCw className="h-4 w-4 text-blue-500" />
                            )}
                          </Button>
                        )}
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
  );

  const renderHistoryTab = () => (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle>Lookup History ({historyEntries.length})</CardTitle>
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
            className="px-3 py-1.5 text-sm border rounded-md bg-background"
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
                    <TableCell>{user.email}</TableCell>
                    <TableCell>
                      <TierBadge tier={user.tier} />
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {user.stripeCustomerId
                        ? `${user.stripeCustomerId.slice(0, 12)}...`
                        : '-'}
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
                          className="px-2 py-1 text-xs border rounded bg-background"
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

  // Main admin view
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto py-8 px-4 max-w-6xl">
        <header className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Admin Dashboard</h1>
          <p className="text-muted-foreground">
            Manage whitelist, activity, jobs, history, and users
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

        {/* Tab navigation */}
        <div className="flex gap-2 mb-8 overflow-x-auto pb-2">
          <Button
            variant={activeTab === 'whitelist' ? 'default' : 'outline'}
            onClick={() => setActiveTab('whitelist')}
            className="flex items-center gap-2"
          >
            <Sparkles className="h-4 w-4" />
            Whitelist
          </Button>
          <Button
            variant={activeTab === 'activity' ? 'default' : 'outline'}
            onClick={() => setActiveTab('activity')}
            className="flex items-center gap-2"
          >
            <Activity className="h-4 w-4" />
            Activity
          </Button>
          <Button
            variant={activeTab === 'jobs' ? 'default' : 'outline'}
            onClick={() => setActiveTab('jobs')}
            className="flex items-center gap-2"
          >
            <Briefcase className="h-4 w-4" />
            Jobs
          </Button>
          <Button
            variant={activeTab === 'history' ? 'default' : 'outline'}
            onClick={() => setActiveTab('history')}
            className="flex items-center gap-2"
          >
            <History className="h-4 w-4" />
            History
          </Button>
          <Button
            variant={activeTab === 'users' ? 'default' : 'outline'}
            onClick={() => setActiveTab('users')}
            className="flex items-center gap-2"
          >
            <Users className="h-4 w-4" />
            Users
          </Button>
        </div>

        {/* Tab content */}
        {activeTab === 'whitelist' && renderWhitelistTab()}
        {activeTab === 'activity' && renderActivityTab()}
        {activeTab === 'jobs' && renderJobsTab()}
        {activeTab === 'history' && renderHistoryTab()}
        {activeTab === 'users' && renderUsersTab()}
      </div>
    </div>
  );
}
