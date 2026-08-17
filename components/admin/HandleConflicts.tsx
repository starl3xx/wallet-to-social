'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Eyebrow } from '@/components/ui/eyebrow';
import { cn } from '@/lib/utils';

/**
 * The queue of wallets where two attested sources name different X accounts.
 *
 * Every attested ingest records these and none of them resolves one, which is
 * the right design and left the rows unreadable. This is the reader.
 *
 * It deliberately offers no resolve button. The evidence usually points one way,
 * and pointing is not the same as acting: an X handle can come back, a
 * suspension can be lifted, and a wallet can genuinely belong to somebody with
 * two accounts. Reading the queue is the thing that was missing.
 */

type Verdict = 'ours-unreachable' | 'both-live' | 'unchecked';

interface Conflict {
  wallet: string;
  ours: string;
  oursSources: string[] | null;
  oursStatus: string | null;
  theirs: string;
  theirSource: string;
  theirsStatus: string | null;
  theirUserId: string | null;
  lastSeenAt: string;
  farcaster: string | null;
  quality: number | null;
  verdict: Verdict;
}

interface Counts {
  total: number;
  ours_dead: number;
  both_live: number;
  unchecked: number;
}

const FILTERS: Array<{ value: string; label: string; hint: string }> = [
  { value: 'all', label: 'All', hint: 'Every unresolved disagreement' },
  {
    value: 'ours-dead',
    label: 'Ours unreachable',
    hint: 'What we serve reaches nobody and the other side works. The clearest cases.',
  },
  {
    value: 'both-live',
    label: 'Both live',
    hint: 'Both handles resolve. Ours may belong to somebody who took a freed name.',
  },
  { value: 'unchecked', label: 'Unchecked', hint: 'One side has not been resolved yet' },
];

/** Reachability, said plainly. Null means nobody has looked. */
function StatusChip({ status }: { status: string | null }) {
  if (!status) return <span className="text-xs text-muted-foreground">not checked</span>;
  const live = status === 'live';
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-sm px-1.5 py-0.5 text-xs font-medium',
        live ? 'bg-attested-tint text-attested' : 'bg-caution-tint text-caution'
      )}
    >
      {live ? 'live' : status === 'unavailable' ? 'suspended' : 'unclaimed'}
    </span>
  );
}

export function HandleConflicts({ password }: { password: string }) {
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [filter, setFilter] = useState('ours-dead');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/conflicts?filter=${filter}&limit=100`, {
        headers: { 'x-admin-password': password },
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const data = await res.json();
      setConflicts(data.conflicts ?? []);
      setCounts(data.counts ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load conflicts');
    } finally {
      setLoading(false);
    }
  }, [filter, password]);

  useEffect(() => {
    void load();
  }, [load]);

  const active = FILTERS.find((f) => f.value === filter);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Eyebrow as="h2">Handle conflicts</Eyebrow>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Wallets where two owner-attested sources name different X accounts. Recorded
          by every ingest and resolved by none of them, because a disagreement between
          two attested sources is evidence rather than a race to write last.
        </p>
      </div>

      {counts && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {[
            { label: 'Open', value: counts.total },
            { label: 'Ours unreachable', value: counts.ours_dead },
            { label: 'Both live', value: counts.both_live },
            { label: 'Unchecked', value: counts.unchecked },
          ].map((s) => (
            <Card key={s.label} className="p-3">
              <div className="text-xs text-muted-foreground">{s.label}</div>
              <div className="text-xl font-semibold tabular-nums">
                {s.value.toLocaleString()}
              </div>
            </Card>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <Button
              key={f.value}
              size="sm"
              variant={filter === f.value ? 'default' : 'outline'}
              onClick={() => setFilter(f.value)}
            >
              {f.label}
            </Button>
          ))}
        </div>
        {active && <p className="text-xs text-muted-foreground">{active.hint}</p>}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {!loading && conflicts.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nothing in this group.
        </p>
      )}

      {!loading && conflicts.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted text-left">
                <th className="px-3 py-2 font-medium">Wallet</th>
                <th className="px-3 py-2 font-medium">We serve</th>
                <th className="px-3 py-2 font-medium">Other source says</th>
                <th className="px-3 py-2 font-medium">Seen</th>
              </tr>
            </thead>
            <tbody>
              {conflicts.map((c) => (
                <tr key={c.wallet} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 font-mono text-xs">
                    {c.wallet.slice(0, 10)}…{c.wallet.slice(-6)}
                    {c.farcaster && (
                      <div className="text-muted-foreground">fc: {c.farcaster}</div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs">@{c.ours}</span>
                      <StatusChip status={c.oursStatus} />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {(c.oursSources ?? []).join(', ') || 'unknown source'}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs">@{c.theirs}</span>
                      <StatusChip status={c.theirsStatus} />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {c.theirSource}
                      {c.theirUserId ? ` · id ${c.theirUserId}` : ''}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground tabular-nums">
                    {new Date(c.lastSeenAt).toISOString().slice(0, 10)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
