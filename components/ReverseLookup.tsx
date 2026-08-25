'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Detective,
  CircleNotch as Loader2,
  Wallet,
} from '@phosphor-icons/react';
import { XMark } from '@/components/ui/brand-marks';
import { InlineError } from '@/components/ui/inline-error';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Segmented } from '@/components/ui/segmented';
import { lockedReverseMessage } from '@/lib/reverse-access';
import type { WalletSocialResult } from '@/lib/types';

type Platform = 'twitter' | 'farcaster';

interface ReverseLookupProps {
  locked: boolean;
  onUpgradeClick?: (source?: string) => void;
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
  /**
   * The answer a caller without credits is entitled to: how many wallets carry
   * the handle, never which ones.
   *
   * Pinned to the queried platform for the same reason `empty` is. Flipping
   * the toggle after a locked answer would otherwise relabel an X count as a
   * Farcaster one, which is a wrong number rather than a stale one.
   */
  const [lockedCount, setLockedCount] = useState<{
    handle: string;
    platform: Platform;
    total: number;
  } | null>(null);

  const submit = useCallback(async () => {
    const value = handle.trim();
    if (!value || loading) return;

    /**
     * A locked account presses the button and gets a real answer.
     *
     * This used to open the pricing modal here, before the request was sent,
     * so the first thing a stranger saw after typing a handle was a price and
     * nothing else. The server now answers everyone with the count and
     * withholds only the addresses, so there is nothing left to bounce.
     */
    setLoading(true);
    setError(null);
    setEmpty(null);
    setLockedCount(null);
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
      // Kept as a fallback. The server answers a locked caller with 200 and a
      // count now, so this only fires if an older deploy is still serving.
      if (res.status === 403 && data.upgradeRequired) {
        onUpgradeClick?.('reverse');
        return;
      }
      if (!res.ok) throw new Error(data.error || 'Lookup failed');

      if (data.locked) {
        setLockedCount({
          handle: data.meta.handle,
          platform,
          total: data.meta.total_count ?? 0,
        });
        return;
      }

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
  }, [handle, loading, platform, onResults, onUpgradeClick, onSignInRequired]);

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
        {/* Change 03 on the optimisation plan: say what the free half is
            before the button is pressed, not after. A locked visitor used to
            learn the split by hitting it. */}
        <p className="text-sm text-muted-foreground">
          Find the wallets behind any account.{' '}
          {locked ? (
            <>
              Free: how many wallets carry a handle. Credits: which ones. You
              can also{' '}
              <Link
                href="/check"
                className="text-accent-brand underline underline-offset-4"
              >
                check a handle&rsquo;s reach
              </Link>{' '}
              without an account.
            </>
          ) : (
            <>
              Or{' '}
              <Link
                href="/check"
                className="text-accent-brand underline underline-offset-4"
              >
                check whether a handle still reaches anybody
              </Link>
              .
            </>
          )}
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
              thumbStyle: { background: 'var(--fc-bg)' },
              activeColor: 'var(--fc-fg)',
            },
          ]}
        />

        {/* A handle in its own field is machine data, so it takes the mono
            face like the paste textarea; spellcheck, autocapitalize and
            autocorrect are off because each one rewrites handles. */}
        <Input
          value={handle}
          onChange={(e) => {
            setHandle(e.target.value);
            // The previous miss describes a handle the user is no longer asking
            // about, so drop it rather than leave it hanging under a new query.
            if (empty) setEmpty(null);
            if (lockedCount) setLockedCount(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
          placeholder={platform === 'twitter' ? '@vitalikbuterin' : 'dwr'}
          // `sm:flex-1`, for the reason recorded in InputMethodPicker's
          // `altClass`: a bare `flex-1` on a control inside a `flex-col` row
          // replaces `h-control` with a 0% basis. This field measured 35.5px on
          // a phone against 34px for the Segmented above it and the button
          // below, so one control row showed three heights, which is the exact
          // failure `--height-control` was created to end.
          className="font-mono sm:flex-1"
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          aria-label={
            platform === 'twitter' ? 'X handle' : 'Farcaster username'
          }
        />

        <Button onClick={submit} disabled={!handle.trim() || loading}>
          {loading ? (
            /* The label stays through loading: a spinner alone is an icon-only
               button with no accessible name. */
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Finding…
            </>
          ) : (
            <>
              <Wallet className="h-4 w-4" aria-hidden />
              Find wallets
            </>
          )}
        </Button>
      </div>

      {error && <InlineError>{error}</InlineError>}

      {/* The answer a locked caller is entitled to. It is a real answer, so it
          is rendered as one rather than as a failed attempt: the count, the
          handle it belongs to, and the upgrade beside it rather than in front
          of it. */}
      {lockedCount && (
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/40 p-4">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-2xl font-semibold tabular-nums text-foreground">
              {lockedCount.total.toLocaleString()}
            </span>
            <span className="text-sm text-muted-foreground">
              {lockedCount.total === 1 ? 'wallet' : 'wallets'} for{' '}
              <span className="font-medium text-foreground">
                {lockedCount.platform === 'twitter' ? '@' : ''}
                {lockedCount.handle}
              </span>
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            {lockedReverseMessage(lockedCount.total, lockedCount.platform)}
          </p>
          {lockedCount.total > 0 && (
            <div>
              <Button size="sm" onClick={() => onUpgradeClick?.('reverse')}>
                <Wallet className="h-4 w-4" aria-hidden />
                See which wallets
              </Button>
            </div>
          )}
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
