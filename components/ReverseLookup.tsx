'use client';

import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Detective,
  CircleNotch as Loader2,
  Warning as AlertTriangle,
  Wallet,
} from '@phosphor-icons/react';
import { XMark } from '@/components/ui/brand-marks';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Segmented } from '@/components/ui/segmented';
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
  const [empty, setEmpty] = useState<{
    handle: string;
    platform: Platform;
  } | null>(null);

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
  }, [
    handle,
    loading,
    locked,
    platform,
    onResults,
    onUpgradeClick,
    onSignInRequired,
  ]);

  return (
    /* A Card, the one top-level panel, at the card padding. It was a
       `bg-muted/30` wash at p-4: an unnamed tint that in dark mode read as the
       page with a line round it, beside a preflight panel that was a
       borderless grey block and a "My lookups" panel that was a Card. The
       Card's own gap owns the vertical rhythm (card stack, 16px); the children
       carry no margins, because flex gap and child margin silently add. */
    <Card className="gap-4 p-6">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          {/* h-4 w-4 regular: an icon beside a 16px heading is UI scale, and
              duotone is reserved for display moments (docs/DESIGN-LANGUAGE.md,
              Icons). It was an 18px duotone, off the 4/5/10 scale. */}
          <Detective className="h-4 w-4 text-accent-brand" aria-hidden />
          <h2 className="text-base font-semibold">Reverse lookup</h2>
          {/* Named by what unlocks it, not by a tier nobody can buy. Any pack
              does (the free allowance does not), so "Credits" is the honest
              one-word answer. A Badge, with no lock icon: it states a fact
              beside a heading, and the old sentence-case pill with a leading
              icon shared three of a button's four axes. */}
          {locked && <Badge>Credits</Badge>}
        </div>
        {/* The panel's one-line description, under the title at every width,
            the shape CardDescription gives a Card. It was a lowercase fragment
            right-aligned in the title row and hidden below sm, so a phone got
            the heading alone. */}
        <p className="text-sm text-muted-foreground">
          Find the wallets behind any account.
        </p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        {/* Shares the Segmented primitive with ThemeToggle. The two were separate
            implementations of one idea and had already drifted apart on height,
            keyboard handling and whether the thumb moved. */}
        <Segmented<Platform>
          ariaLabel="Platform"
          value={platform}
          onChange={setPlatform}
          className="w-[11rem]"
          options={[
            {
              value: 'twitter',
              label: 'X',
              content: <XMark className="h-3.5 w-3.5" />,
              // The selected platform takes that platform's own colours: the one
              // named exception to violet being the only interactive hue.
              thumbStyle: { background: 'var(--x-bg)' },
              activeColor: 'var(--x-fg)',
            },
            {
              value: 'farcaster',
              label: 'Farcaster',
              content: 'Farcaster',
              thumbStyle: { background: '#8A63D2' },
              activeColor: '#FFFFFF',
            },
          ]}
        />

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
          aria-label={
            platform === 'twitter' ? 'X handle' : 'Farcaster username'
          }
        />

        <Button onClick={submit} disabled={!handle.trim() || loading}>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              <Wallet className="h-4 w-4" aria-hidden />
              Find wallets
            </>
          )}
        </Button>
      </div>

      {error && (
        <div className="flex items-start gap-2 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {empty && (
        <p className="text-sm text-muted-foreground">
          No wallets found for{' '}
          <span className="font-medium text-foreground">
            {empty.platform === 'twitter' ? '@' : ''}
            {empty.handle}
          </span>
          .{' '}
          {empty.platform === 'farcaster' ? (
            'Farcaster coverage is complete, so this account genuinely has no addresses attached.'
          ) : (
            <>
              <XMark className="inline h-3 w-3 align-[-0.1em]" label="X" />{' '}
              handles are only known when the owner published the link, so this
              is an absence of evidence rather than evidence of absence.
            </>
          )}
        </p>
      )}
    </Card>
  );
}
