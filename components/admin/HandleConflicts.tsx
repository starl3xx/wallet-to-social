'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Segmented, type SegmentedOption } from '@/components/ui/segmented';
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
import { StatTile } from './Stat';
import { RefreshButton } from './RefreshButton';
import { Empty, Loading } from './PaneState';

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

/** The groups the API filters on. `all` is every unresolved disagreement. */
type Filter = 'all' | 'ours-dead' | 'both-live' | 'unchecked';

/**
 * Four mutually exclusive groups, so a segmented control that shows them all.
 * It was four buttons swapping between filled and outline, which painted the
 * selection in place instead of moving it, and gave a keyboard no arrow keys.
 *
 * `content` is the short word that fits a segment; `label` is the full name a
 * screen reader and the tooltip get. Segments are equal width, so the longest
 * content sets the width of all four: "Ours unreachable" would have made the
 * control wider than a phone.
 *
 * Module scope, not inline: `Segmented` keeps the thumb position in arithmetic
 * over this array, and rebuilding it every render gives it a new identity for
 * no reason.
 */
/**
 * Two renderings of each segment: a short word below `sm` and the full one
 * above. Four equal segments in a 375px row give each about 79px, and
 * "Unreachable" needs 106, so on a phone the long labels overflowed their
 * cells. The `label` (the accessible name) stays the full phrase at every
 * width; only what is painted shortens.
 */
function short(narrow: string, wide: string) {
  return (
    <>
      <span className="sm:hidden">{narrow}</span>
      <span className="hidden sm:inline">{wide}</span>
    </>
  );
}

const FILTER_OPTIONS: Array<SegmentedOption<Filter> & { hint: string }> = [
  {
    value: 'all',
    label: 'All',
    content: 'All',
    hint: 'Every unresolved disagreement',
  },
  {
    value: 'ours-dead',
    label: 'Ours unreachable',
    content: short('Dead', 'Unreachable'),
    hint: 'What we serve reaches nobody and the other side works. The clearest cases.',
  },
  {
    value: 'both-live',
    label: 'Both live',
    content: short('Live', 'Both live'),
    hint: 'Both handles resolve. Ours may belong to somebody who took a freed name.',
  },
  {
    value: 'unchecked',
    label: 'Unchecked',
    content: short('Pending', 'Unchecked'),
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
  const [filter, setFilter] = useState<Filter>('ours-dead');
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

  const active = FILTER_OPTIONS.find((f) => f.value === filter);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h2 className="text-2xl font-light tracking-[var(--tracking-title)]">
            Handle conflicts
          </h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Wallets where two owner-attested sources name different X accounts.
            Recorded by every ingest and resolved by none of them, because a
            disagreement between two attested sources is evidence rather than a
            race to write last.
          </p>
        </div>
        <RefreshButton onClick={() => void load()} loading={loading} />
      </div>

      {counts && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {[
            { label: 'Open', value: counts.total },
            { label: 'Ours unreachable', value: counts.ours_dead },
            { label: 'Both live', value: counts.both_live },
            { label: 'Unchecked', value: counts.unchecked },
          ].map((s) => (
            <StatTile
              key={s.label}
              label={s.label}
              value={s.value.toLocaleString()}
            />
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Segmented
          ariaLabel="Conflict group"
          value={filter}
          onChange={setFilter}
          options={FILTER_OPTIONS}
          className="w-full sm:w-auto"
        />
        {active && (
          <p className="text-xs text-muted-foreground">{active.hint}</p>
        )}
      </div>

      {error && <Banner tone="error">{error}</Banner>}
      {loading && <Loading />}

      {!loading && conflicts.length === 0 && (
        <Empty>Nothing in this group.</Empty>
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
