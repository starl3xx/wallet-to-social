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
import { Trash2, Plus, Loader2, Lock, Users, Crown, Zap, Sparkles } from 'lucide-react';

interface WhitelistEntry {
  id: string;
  email: string | null;
  wallet: string | null;
  note: string | null;
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
  const [entries, setEntries] = useState<WhitelistEntry[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [newEmail, setNewEmail] = useState('');
  const [newWallet, setNewWallet] = useState('');
  const [newNote, setNewNote] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Check for stored password on mount
  useEffect(() => {
    const storedPassword = sessionStorage.getItem('admin_password');
    if (storedPassword) {
      setPassword(storedPassword);
      fetchWhitelist(storedPassword);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchWhitelist = useCallback(async (pwd: string) => {
    setAuthState('loading');
    setError(null);

    try {
      const response = await fetch('/api/admin/whitelist', {
        headers: {
          'x-admin-password': pwd,
        },
      });

      if (response.status === 401) {
        setAuthState('password');
        setError('Invalid password');
        sessionStorage.removeItem('admin_password');
        return;
      }

      if (!response.ok) {
        throw new Error('Failed to fetch whitelist');
      }

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

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (password) {
      fetchWhitelist(password);
    }
  };

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

      // Refresh list
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
        headers: {
          'x-admin-password': password,
        },
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete');
      }

      // Remove from local state
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

  // Main admin view
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto py-8 px-4 max-w-4xl">
        <header className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Admin Dashboard</h1>
          <p className="text-muted-foreground">
            Manage whitelist and view user stats
          </p>
        </header>

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

        {/* Error display */}
        {error && (
          <div className="mb-4 p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
            <p className="text-sm text-destructive">{error}</p>
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
      </div>
    </div>
  );
}
