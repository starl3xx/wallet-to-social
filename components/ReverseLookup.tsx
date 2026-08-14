'use client';

import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, Loader2, AlertTriangle, Lock } from 'lucide-react';
import type { WalletSocialResult } from '@/lib/types';

type Platform = 'twitter' | 'farcaster';

interface ReverseLookupProps {
  locked: boolean;
  onUpgradeClick?: () => void;
  onResults: (
    results: WalletSocialResult[],
    label: string,
    meta: ReverseMeta,
    lookupId: string | null
  ) => void;
  onSignInRequired?: () => void;
}

export interface ReverseMeta {
  totalCount: number;
  returnedCount: number;
  truncated: boolean;
}

export function ReverseLookup({
  locked,
  onUpgradeClick,
  onResults,
  onSignInRequired,
}: ReverseLookupProps) {
  const [platform, setPlatform] = useState<Platform>('twitter');
  const [handle, setHandle] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Pins the platform that was actually queried, not the live toggle. The two
  // networks get opposite explanations for an empty result, so reading the
  // toggle at render time meant flipping it after a miss rewrote the reason:
  // an X miss could be explained as complete Farcaster coverage, which is the
  // exact conflation the copy exists to prevent.
  const [empty, setEmpty] = useState<{ handle: string; platform: Platform } | null>(null);

  const submit = useCallback(async () => {
    const value = handle.trim();
    if (!value || loading) return;

    // Locked accounts still get to press the button. Bouncing them here, with
    // the thing they typed still on screen, converts better than hiding the
    // feature and is the same pattern as the locked contract-import card.
    if (locked) {
      onUpgradeClick?.();
      return;
    }

    setLoading(true);
    setError(null);
    setEmpty(null);
    try {
      const res = await fetch('/api/reverse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, handle: value }),
      });
      const data = await res.json();

      if (res.status === 401) {
        onSignInRequired?.();
        return;
      }
      if (res.status === 403 && data.upgradeRequired) {
        onUpgradeClick?.();
        return;
      }
      if (!res.ok) throw new Error(data.error || 'Lookup failed');

      if (!data.results?.length) {
        setEmpty({ handle: value.replace(/^@/, ''), platform });
        return;
      }

      onResults(
        data.results,
        `${platform === 'twitter' ? '@' : ''}${data.meta.handle}`,
        {
          totalCount: data.meta.total_count,
          returnedCount: data.meta.returned_count,
          truncated: data.meta.truncated,
        },
        data.lookup_id ?? null
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lookup failed');
    } finally {
      setLoading(false);
    }
  }, [handle, loading, locked, platform, onResults, onUpgradeClick, onSignInRequired]);

  return (
    <div className="rounded-lg border bg-muted/30 p-4">
      <div className="mb-3 flex items-center gap-2">
        <Search className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">Reverse lookup</h2>
        {locked && (
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            <Lock className="h-3 w-3" />
            Pro
          </span>
        )}
        <span className="ml-auto hidden text-xs text-muted-foreground sm:inline">
          find the wallets behind any account
        </span>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        {/* Segmented pill rather than two separate buttons. The raised chip
            carries the selected state by shape and elevation, so the brand
            colour is doing emphasis rather than the whole job. Native radios
            underneath keep arrow-key movement and a single tab stop. */}
        <fieldset
          className="flex gap-0.5 rounded-full bg-muted p-0.5"
          aria-label="Platform"
        >
          {(['twitter', 'farcaster'] as const).map((p) => (
            <label key={p} className="cursor-pointer">
              <input
                type="radio"
                name="reverse-platform"
                value={p}
                checked={platform === p}
                onChange={() => setPlatform(p)}
                className="peer sr-only"
                // The visible label is 𝕏, which a screen reader announces as
                // "mathematical double-struck capital X". A radio takes its
                // accessible name from that label unless one is given here.
                aria-label={p === 'twitter' ? 'X' : 'Farcaster'}
              />
              <span className="block rounded-full px-4 py-1.5 text-sm text-muted-foreground transition-colors peer-checked:bg-background peer-checked:font-semibold peer-checked:text-accent-brand peer-checked: peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-1">
                {p === 'twitter' ? '𝕏' : 'Farcaster'}
              </span>
            </label>
          ))}
        </fieldset>

        <Input
          value={handle}
          onChange={(e) => {
            setHandle(e.target.value);
            // The previous miss describes a handle the user is no longer asking
            // about, so drop it rather than leave it hanging under a new query.
            if (empty) setEmpty(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
          placeholder={platform === 'twitter' ? '@vitalikbuterin' : 'dwr'}
          className="flex-1"
          aria-label={platform === 'twitter' ? 'X handle' : 'Farcaster username'}
        />

        <Button onClick={submit} disabled={!handle.trim() || loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Find wallets'}
        </Button>
      </div>

      {error && (
        <div className="mt-3 flex items-start gap-2 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {empty && (
        <p className="mt-3 text-sm text-muted-foreground">
          No wallets found for{' '}
          <span className="font-medium text-foreground">
            {empty.platform === 'twitter' ? '@' : ''}
            {empty.handle}
          </span>
          .{' '}
          {empty.platform === 'farcaster'
            ? 'Farcaster coverage is complete, so this account genuinely has no addresses attached.'
            : '𝕏 handles are only known when the owner published the link, so this is an absence of evidence rather than evidence of absence.'}
        </p>
      )}
    </div>
  );
}
