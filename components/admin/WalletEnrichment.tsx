'use client';

import { useState, useCallback, useEffect, useId, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  MagnifyingGlass as Search,
  CircleNotch as Loader2,
  FloppyDisk as Save,
  X,
  ArrowSquareOut,
} from '@phosphor-icons/react';
import { Banner } from './Banner';
import { shortWallet } from './format';
import { Empty, Loading } from './PaneState';

/**
 * A handle as a link to the account it names, in the one treatment a text
 * link gets: the link variant at the inline size, mono because a handle in its
 * own cell is machine data. `size-3` rather than `h-3 w-3` on the glyph:
 * Button forces `size-4` on any svg whose class lacks "size-", so that
 * spelling is the only one that renders at 12px inside a Button.
 */
function HandleLink({ href, handle }: { href: string; handle: string }) {
  return (
    <Button asChild variant="link" size="inline" className="font-mono text-xs">
      <a href={href} target="_blank" rel="noopener noreferrer">
        @{handle}
        <ArrowSquareOut className="size-3" aria-hidden />
      </a>
    </Button>
  );
}

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
  /**
   * The three edit fields carried a `<label>` that wrapped nothing and pointed
   * at nothing, which is a heading in label's clothing: a screen reader reaches
   * the input and announces "edit text, blank". `useId` rather than a constant
   * because the pane is mounted per admin tab and a duplicate `id` silently
   * re-points the first label at the second input.
   */
  const fieldId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  /**
   * Whether the search FIELD is at fault. `saveMessage` is the pane's one
   * banner and it also carries save failures and request failures, neither of
   * which is a bad address; and the empty box is not the only bad entry, since
   * a value that fails the 0x-and-40-hex check is one too. Both of those
   * cases, and only those, set this.
   */
  const [searchInvalid, setSearchInvalid] = useState(false);
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
  const [saveMessage, setSaveMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

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
    /**
     * The empty case is answered rather than ignored, because Search is no
     * longer disabled on an empty field: `disabled` takes a control out of the
     * tab order, so the dimming did not say "type an address", it deleted the
     * button from a keyboard pass. It reports through the same banner as the
     * format error a line below, which is the message it is a precursor to.
     */
    if (!searchQuery.trim()) {
      setSaveMessage({
        type: 'error',
        text: 'Enter a wallet address to look up.',
      });
      setSearchInvalid(true);
      // Focus goes to the field, as it does in the other seven forms this
      // change touched. Reporting alone leaves a keyboard user standing on
      // Search with the banner talking about an input they now have to go
      // find, which is most of the way back to the disabled button.
      //
      // The loaded wallet deliberately STAYS, unlike the other lookups, which
      // all drop their previous answer here. The edit form below is bound to
      // it and may hold unsaved handles somebody has typed, so clearing on a
      // stray Enter in an empty search box would throw that away. A stale
      // result is recoverable; a discarded edit is not.
      searchRef.current?.focus();
      return;
    }

    // Validate wallet format
    const wallet = searchQuery.trim();
    if (!/^0x[a-fA-F0-9]{40}$/i.test(wallet)) {
      setSaveMessage({ type: 'error', text: 'Invalid wallet address format' });
      setSearchInvalid(true);
      searchRef.current?.focus();
      return;
    }

    setSearching(true);
    setSearched(true);
    setSaveMessage(null);
    // The address parsed, so anything that fails from here is the request,
    // not the entry.
    setSearchInvalid(false);
    // The address parsed, so anything that fails from here is the request.
    setSearchInvalid(false);

    try {
      const res = await fetch(
        `/api/admin/social-graph?wallet=${encodeURIComponent(wallet)}`,
        {
          headers: { 'x-admin-password': password },
        }
      );
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
      setSaveMessage({
        type: 'error',
        text: 'At least one social field required',
      });
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
        setSaveMessage({
          type: 'success',
          text: 'Saved successfully with manual source',
        });

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
        setSaveMessage({
          type: 'error',
          text: error.error || 'Failed to save',
        });
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
      const searchBtn = document.querySelector(
        '[data-search-btn]'
      ) as HTMLButtonElement;
      if (searchBtn) searchBtn.click();
    }, 0);
  }, []);

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
      {/* The pane heading, at the pane tier like every other pane. The card
          title beneath it names what the card does rather than repeating the
          pane's name with an icon in front of it. */}
      <h2 className="text-2xl font-light tracking-[var(--tracking-title)]">
        Wallet enrichment
      </h2>

      {/* Search Section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Look up a wallet</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Search Input */}
          <div className="flex gap-2">
            <Input
              placeholder="Enter wallet address (0x…)"
              ref={searchRef}
              aria-label="Wallet address"
              aria-invalid={searchInvalid}
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                if (searchInvalid) setSearchInvalid(false);
              }}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className="font-mono"
            />
            <Button
              onClick={handleSearch}
              disabled={searching}
              aria-label="Search"
              data-search-btn
            >
              {searching ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Search className="h-4 w-4" aria-hidden />
              )}
            </Button>
          </div>

          {/* Message. A save that went through is a real outcome, so it is
              green; violet would say there is something here to click. */}
          {saveMessage && (
            <Banner
              tone={saveMessage.type === 'success' ? 'success' : 'error'}
              className="mt-4"
            >
              {saveMessage.text}
            </Banner>
          )}

          {/* Search Results */}
          {searched && (
            <div className="mt-6 space-y-4">
              {/* Current Data Display. Each value sits in its own cell beside
                  its label, so the machine data (ENS name, handles, the
                  timestamp) is mono. */}
              {/* The inset well: `bg-fill-well` at `p-4`, the one named wash
                  for interior panels. These two were `/30` washes. */}
              {walletData ? (
                <div className="rounded-lg border border-border bg-fill-well p-4">
                  <h4 className="font-medium mb-3">Current data</h4>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-muted-foreground">ENS:</span>{' '}
                      {walletData.ensName ? (
                        <span className="font-mono text-xs">
                          {walletData.ensName}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </div>
                    <div>
                      <span className="text-muted-foreground">X:</span>{' '}
                      {walletData.twitterHandle ? (
                        <HandleLink
                          href={
                            walletData.twitterUrl ||
                            `https://x.com/${walletData.twitterHandle}`
                          }
                          handle={walletData.twitterHandle}
                        />
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Farcaster:</span>{' '}
                      {walletData.farcaster ? (
                        <HandleLink
                          href={
                            walletData.farcasterUrl ||
                            `https://warpcast.com/${walletData.farcaster}`
                          }
                          handle={walletData.farcaster}
                        />
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </div>
                    <div>
                      <span className="text-muted-foreground">
                        Farcaster followers:
                      </span>{' '}
                      <span className="tabular-nums">
                        {walletData.fcFollowers?.toLocaleString() || (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </span>
                    </div>
                    {/* `manual` is ours, so it takes the brand tint; every
                        pipeline source is muted, because `source` holds stage
                        markers and says nothing about provenance. */}
                    <div>
                      <span className="text-muted-foreground">Sources:</span>{' '}
                      <div className="inline-flex gap-1 flex-wrap">
                        {walletData.sources?.map((s) => (
                          <Badge
                            key={s}
                            tone={s === 'manual' ? 'brand' : 'muted'}
                            title={s}
                          >
                            {s}
                          </Badge>
                        )) || <span className="text-muted-foreground">-</span>}
                      </div>
                    </div>
                    <div>
                      <span className="text-muted-foreground">
                        Last updated:
                      </span>{' '}
                      <span className="font-mono text-xs tabular-nums">
                        {formatDate(walletData.lastUpdatedAt)}
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-border bg-fill-well p-4">
                  <p className="text-sm text-muted-foreground">
                    No existing data for this wallet. Add social data below.
                  </p>
                </div>
              )}

              {/* Edit Form */}
              <div className="rounded-lg border border-border p-4">
                <h4 className="font-medium mb-3">
                  {walletData ? 'Edit social data' : 'Add social data'}
                </h4>
                <div className="space-y-3">
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label
                        htmlFor={`${fieldId}-twitter`}
                        className="text-xs text-muted-foreground mb-1 block"
                      >
                        X handle
                      </label>
                      <Input
                        id={`${fieldId}-twitter`}
                        placeholder="@handle"
                        value={editTwitter}
                        onChange={(e) => setEditTwitter(e.target.value)}
                      />
                    </div>
                    <div>
                      <label
                        htmlFor={`${fieldId}-farcaster`}
                        className="text-xs text-muted-foreground mb-1 block"
                      >
                        Farcaster
                      </label>
                      <Input
                        id={`${fieldId}-farcaster`}
                        placeholder="@handle"
                        value={editFarcaster}
                        onChange={(e) => setEditFarcaster(e.target.value)}
                      />
                    </div>
                    <div>
                      <label
                        htmlFor={`${fieldId}-ens`}
                        className="text-xs text-muted-foreground mb-1 block"
                      >
                        ENS
                      </label>
                      <Input
                        id={`${fieldId}-ens`}
                        placeholder="name.eth"
                        value={editEns}
                        onChange={(e) => setEditEns(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="soft"
                      size="sm"
                      onClick={() => {
                        setEditTwitter(walletData?.twitterHandle || '');
                        setEditFarcaster(walletData?.farcaster || '');
                        setEditEns(walletData?.ensName || '');
                      }}
                    >
                      <X className="h-4 w-4" aria-hidden />
                      Cancel
                    </Button>
                    {/* Disabled only while the request is in flight. The
                        "at least one field" rule is already enforced in
                        `handleSave`, which says so in the banner; repeating it
                        here as a `disabled` said the same thing in the one
                        form that cannot be read out, and took Save off the tab
                        order while it did. */}
                    <Button size="sm" onClick={handleSave} disabled={saving}>
                      {saving ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      ) : (
                        <Save className="h-4 w-4" aria-hidden />
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
            <Loading />
          ) : recentEdits.length === 0 ? (
            <Empty>No manual edits yet</Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Wallet</TableHead>
                  <TableHead>X handle</TableHead>
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
                      {shortWallet(edit.wallet)}
                    </TableCell>
                    {/* The same links the Current data block shows. These
                        were violet spans with no href: affordance colour on
                        text nothing happened to when you clicked it. */}
                    <TableCell>
                      {edit.twitterHandle ? (
                        <HandleLink
                          href={
                            edit.twitterUrl ||
                            `https://x.com/${edit.twitterHandle}`
                          }
                          handle={edit.twitterHandle}
                        />
                      ) : (
                        '-'
                      )}
                    </TableCell>
                    <TableCell>
                      {edit.farcaster ? (
                        <HandleLink
                          href={
                            edit.farcasterUrl ||
                            `https://warpcast.com/${edit.farcaster}`
                          }
                          handle={edit.farcaster}
                        />
                      ) : (
                        '-'
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {edit.ensName || '-'}
                    </TableCell>
                    <TableCell className="font-mono text-xs tabular-nums text-muted-foreground">
                      {formatDate(edit.lastUpdatedAt)}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="compact"
                        onClick={() => handleViewWallet(edit.wallet)}
                      >
                        View
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
