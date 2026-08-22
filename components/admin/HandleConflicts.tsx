'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Eyebrow } from '@/components/ui/eyebrow';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Banner } from './Banner';
import { shortWallet } from './format';

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
  {
    value: 'unchecked',
    label: 'Unchecked',
    hint: 'One side has not been resolved yet',
  },
];

/**
 * Reachability, said plainly, as a `Badge`. Live is a measured fact, so it is
 * green; a suspended or unclaimed handle is a stale record, so it is caution.
 * Null means nobody has looked, which is the absence of a fact, so it is muted.
 */
function StatusChip({ status }: { status: string | null }) {
  if (!status) return <Badge tone="muted">not checked</Badge>;
  const live = status === 'live';
  return (
    <Badge tone={live ? 'attested' : 'caution'}>
      {live ? 'live' : status === 'unavailable' ? 'suspended' : 'unclaimed'}
    </Badge>
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
      const res = await fetch(
        `/api/admin/conflicts?filter=${filter}&limit=100`,
        {
          headers: { 'x-admin-password': password },
        }
      );
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
          Wallets where two owner-attested sources name different X accounts.
          Recorded by every ingest and resolved by none of them, because a
          disagreement between two attested sources is evidence rather than a
          race to write last.
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
        {active && (
          <p className="text-xs text-muted-foreground">{active.hint}</p>
        )}
      </div>

      {error && <Banner tone="error">{error}</Banner>}
      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {!loading && conflicts.length === 0 && (
        <p className="text-sm text-muted-foreground">Nothing in this group.</p>
      )}

      {/* The `Table` primitive inside a `Card`, as every other pane. This was
          a raw table in its own bordered box with a filled `bg-muted` header
          and `px-3 py-2` cells: a second header fill and a third row height
          for the one object the panel is mostly made of. */}
      {!loading && conflicts.length > 0 && (
        <Card>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Wallet</TableHead>
                  <TableHead>We serve</TableHead>
                  <TableHead>Other source says</TableHead>
                  <TableHead>Seen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {conflicts.map((c) => (
                  <TableRow key={c.wallet}>
                    <TableCell className="font-mono text-xs">
                      {shortWallet(c.wallet)}
                      {c.farcaster && (
                        <div className="text-muted-foreground">
                          Farcaster: {c.farcaster}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs">@{c.ours}</span>
                        <StatusChip status={c.oursStatus} />
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {(c.oursSources ?? []).join(', ') || 'unknown source'}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs">@{c.theirs}</span>
                        <StatusChip status={c.theirsStatus} />
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {c.theirSource}
                        {c.theirUserId ? ` · id ${c.theirUserId}` : ''}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs tabular-nums text-muted-foreground">
                      {new Date(c.lastSeenAt).toISOString().slice(0, 10)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
