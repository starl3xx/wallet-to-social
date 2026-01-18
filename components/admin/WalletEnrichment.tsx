'use client';

import { useState, useCallback, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Search, Loader2, Save, X, ExternalLink, Pencil } from 'lucide-react';

interface SocialGraphData {
  wallet: string;
  ensName: string | null;
  twitterHandle: string | null;
  twitterUrl: string | null;
  farcaster: string | null;
  farcasterUrl: string | null;
  fcFollowers: number | null;
  sources: string[] | null;
  lastUpdatedAt: string | null;
}

interface WalletEnrichmentProps {
  password: string;
}

export function WalletEnrichment({ password }: WalletEnrichmentProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [walletData, setWalletData] = useState<SocialGraphData | null>(null);
  const [searched, setSearched] = useState(false);

  // Edit form state
  const [isEditing, setIsEditing] = useState(false);
  const [editTwitter, setEditTwitter] = useState('');
  const [editFarcaster, setEditFarcaster] = useState('');
  const [editEns, setEditEns] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Recent manual edits
  const [recentEdits, setRecentEdits] = useState<SocialGraphData[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(true);

  // Fetch recent manual edits on mount
  useEffect(() => {
    async function fetchRecent() {
      try {
        const res = await fetch('/api/admin/social-graph', {
          headers: { 'x-admin-password': password },
        });
        if (res.ok) {
          const data = await res.json();
          setRecentEdits(data.recentEdits || []);
        }
      } catch (err) {
        console.error('Failed to fetch recent edits:', err);
      } finally {
        setLoadingRecent(false);
      }
    }
    fetchRecent();
  }, [password]);

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;

    // Validate wallet format
    const wallet = searchQuery.trim();
    if (!/^0x[a-fA-F0-9]{40}$/i.test(wallet)) {
      setSaveMessage({ type: 'error', text: 'Invalid wallet address format' });
      return;
    }

    setSearching(true);
    setSearched(true);
    setSaveMessage(null);

    try {
      const res = await fetch(`/api/admin/social-graph?wallet=${encodeURIComponent(wallet)}`, {
        headers: { 'x-admin-password': password },
      });
      if (res.ok) {
        const data = await res.json();
        setWalletData(data.wallet);
        if (data.wallet) {
          setEditTwitter(data.wallet.twitterHandle || '');
          setEditFarcaster(data.wallet.farcaster || '');
          setEditEns(data.wallet.ensName || '');
        } else {
          // Wallet not found - allow creating new entry
          setEditTwitter('');
          setEditFarcaster('');
          setEditEns('');
        }
      }
    } catch (err) {
      console.error('Search error:', err);
      setSaveMessage({ type: 'error', text: 'Failed to search wallet' });
    } finally {
      setSearching(false);
    }
  }, [searchQuery, password]);

  const handleSave = useCallback(async () => {
    if (!searchQuery.trim()) return;

    // At least one field required
    if (!editTwitter.trim() && !editFarcaster.trim() && !editEns.trim()) {
      setSaveMessage({ type: 'error', text: 'At least one social field required' });
      return;
    }

    setSaving(true);
    setSaveMessage(null);

    try {
      const res = await fetch('/api/admin/social-graph', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-password': password,
        },
        body: JSON.stringify({
          wallet: searchQuery.trim(),
          twitterHandle: editTwitter.trim() || undefined,
          farcaster: editFarcaster.trim() || undefined,
          ensName: editEns.trim() || undefined,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setWalletData(data.wallet);
        setIsEditing(false);
        setSaveMessage({ type: 'success', text: 'Saved successfully with manual source' });

        // Refresh recent edits
        const recentRes = await fetch('/api/admin/social-graph', {
          headers: { 'x-admin-password': password },
        });
        if (recentRes.ok) {
          const recentData = await recentRes.json();
          setRecentEdits(recentData.recentEdits || []);
        }
      } else {
        const error = await res.json();
        setSaveMessage({ type: 'error', text: error.error || 'Failed to save' });
      }
    } catch (err) {
      console.error('Save error:', err);
      setSaveMessage({ type: 'error', text: 'Failed to save' });
    } finally {
      setSaving(false);
    }
  }, [searchQuery, editTwitter, editFarcaster, editEns, password]);

  const handleViewWallet = useCallback((wallet: string) => {
    setSearchQuery(wallet);
    setIsEditing(false);
    // Trigger search
    setTimeout(() => {
      const searchBtn = document.querySelector('[data-search-btn]') as HTMLButtonElement;
      if (searchBtn) searchBtn.click();
    }, 0);
  }, []);

  const truncateWallet = (wallet: string) => {
    return `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <div className="space-y-6">
      {/* Search Section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Pencil className="h-4 w-4" />
            Wallet enrichment
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Search Input */}
          <div className="flex gap-2">
            <Input
              placeholder="Enter wallet address (0x...)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className="font-mono"
            />
            <Button onClick={handleSearch} disabled={searching || !searchQuery.trim()} data-search-btn>
              {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            </Button>
          </div>

          {/* Message */}
          {saveMessage && (
            <div
              className={`mt-4 p-3 rounded-lg text-sm ${
                saveMessage.type === 'success'
                  ? 'bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-300'
                  : 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300'
              }`}
            >
              {saveMessage.text}
            </div>
          )}

          {/* Search Results */}
          {searched && (
            <div className="mt-6 space-y-4">
              {/* Current Data Display */}
              {walletData ? (
                <div className="p-4 border rounded-lg bg-muted/30">
                  <h4 className="font-medium mb-3">Current data</h4>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-muted-foreground">ENS:</span>{' '}
                      {walletData.ensName || <span className="text-muted-foreground">-</span>}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Twitter:</span>{' '}
                      {walletData.twitterHandle ? (
                        <a
                          href={walletData.twitterUrl || `https://x.com/${walletData.twitterHandle}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-500 hover:underline inline-flex items-center gap-1"
                        >
                          @{walletData.twitterHandle}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Farcaster:</span>{' '}
                      {walletData.farcaster ? (
                        <a
                          href={walletData.farcasterUrl || `https://warpcast.com/${walletData.farcaster}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-purple-500 hover:underline inline-flex items-center gap-1"
                        >
                          @{walletData.farcaster}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </div>
                    <div>
                      <span className="text-muted-foreground">FC Followers:</span>{' '}
                      {walletData.fcFollowers?.toLocaleString() || <span className="text-muted-foreground">-</span>}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Sources:</span>{' '}
                      <div className="inline-flex gap-1 flex-wrap">
                        {walletData.sources?.map((s) => (
                          <span
                            key={s}
                            className={`px-1.5 py-0.5 text-xs rounded ${
                              s === 'manual' ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300' : 'bg-muted'
                            }`}
                          >
                            {s}
                          </span>
                        )) || <span className="text-muted-foreground">-</span>}
                      </div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Last updated:</span>{' '}
                      {formatDate(walletData.lastUpdatedAt)}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-4 border rounded-lg bg-muted/30">
                  <p className="text-sm text-muted-foreground">
                    No existing data for this wallet. Add social data below.
                  </p>
                </div>
              )}

              {/* Edit Form */}
              <div className="p-4 border rounded-lg">
                <h4 className="font-medium mb-3">
                  {walletData ? 'Edit social data' : 'Add social data'}
                </h4>
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">Twitter</label>
                      <Input
                        placeholder="@handle"
                        value={editTwitter}
                        onChange={(e) => setEditTwitter(e.target.value)}
                        className="h-9"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">Farcaster</label>
                      <Input
                        placeholder="@handle"
                        value={editFarcaster}
                        onChange={(e) => setEditFarcaster(e.target.value)}
                        className="h-9"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">ENS</label>
                      <Input
                        placeholder="name.eth"
                        value={editEns}
                        onChange={(e) => setEditEns(e.target.value)}
                        className="h-9"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setEditTwitter(walletData?.twitterHandle || '');
                        setEditFarcaster(walletData?.farcaster || '');
                        setEditEns(walletData?.ensName || '');
                      }}
                    >
                      <X className="h-4 w-4 mr-1" />
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleSave}
                      disabled={saving || (!editTwitter.trim() && !editFarcaster.trim() && !editEns.trim())}
                    >
                      {saving ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-1" />
                      ) : (
                        <Save className="h-4 w-4 mr-1" />
                      )}
                      Save as manual
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Manual Edits */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent manual edits</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingRecent ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : recentEdits.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              No manual edits yet
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Wallet</TableHead>
                    <TableHead>Twitter</TableHead>
                    <TableHead>Farcaster</TableHead>
                    <TableHead>ENS</TableHead>
                    <TableHead>Last updated</TableHead>
                    <TableHead className="w-16"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentEdits.map((edit) => (
                    <TableRow key={edit.wallet}>
                      <TableCell className="font-mono text-xs">
                        {truncateWallet(edit.wallet)}
                      </TableCell>
                      <TableCell>
                        {edit.twitterHandle ? (
                          <span className="text-blue-500">@{edit.twitterHandle}</span>
                        ) : (
                          '-'
                        )}
                      </TableCell>
                      <TableCell>
                        {edit.farcaster ? (
                          <span className="text-purple-500">@{edit.farcaster}</span>
                        ) : (
                          '-'
                        )}
                      </TableCell>
                      <TableCell>{edit.ensName || '-'}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(edit.lastUpdatedAt)}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleViewWallet(edit.wallet)}
                        >
                          View
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
  );
}
