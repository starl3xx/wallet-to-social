'use client';

import { useState, useCallback, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Eyebrow } from '@/components/ui/eyebrow';
import { isAttestedSource } from '@/lib/api-sources';
import { Banner } from './Banner';
import { Meter } from './Meter';
import { Stat } from './Stat';
import { RefreshButton } from './RefreshButton';
import { Loading, Empty } from './PaneState';

/**
 * What the graph is made of: the topline counts, and the per-source bar
 * chart that answers "which sources built this".
 *
 * Two figures per source, deliberately, because "best" is two different
 * questions. `wallets` is every row carrying the label, which rewards volume;
 * `sole` is rows where it is the ONLY label, which rewards knowing wallets
 * nobody else found. A source can win one and lose the other, and the sort
 * toggle exists exactly for that comparison.
 *
 * The bars are magnitude on a single hue, per the design language: identity
 * lives in the row label, never in a per-source color. Rates stay figures
 * (the Meter header states the rule); the bars here chart counts against the
 * largest source, which is a comparison, not a completion.
 */

interface Topline {
  total: number;
  with_any: number;
  with_x: number;
  with_fc: number;
  with_both: number;
  x_attested: number;
  negatives: number;
}

interface SourceRow {
  source: string;
  wallets: number;
  sole: number;
  with_x: number;
  with_fc: number;
  class: string;
}

interface Composition {
  topline: Topline;
  sources: SourceRow[];
  xByStatus: Record<string, number>;
  generatedAt: string;
}

const nf = new Intl.NumberFormat('en-US');
const pct = (part: number, whole: number) =>
  whole === 0 ? '0%' : `${((part / whole) * 100).toFixed(1)}%`;

type SortKey = 'wallets' | 'sole';

export function GraphComposition({ password }: { password: string }) {
  const [data, setData] = useState<Composition | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('wallets');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/graph-composition', {
        headers: { 'x-admin-password': password },
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      setData((await res.json()) as Composition);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  }, [password]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !data) return <Loading />;
  if (error) return <Banner tone="error">{error}</Banner>;
  if (!data) return <Empty>No composition data.</Empty>;

  const t = data.topline;
  const live = data.xByStatus.live ?? 0;
  const unavailable = data.xByStatus.unavailable ?? 0;
  const notFound = data.xByStatus.not_found ?? 0;

  const rows = [...data.sources].sort((a, b) => b[sortKey] - a[sortKey]);
  const max = rows.reduce((m, r) => Math.max(m, r[sortKey]), 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        <Stat
          label="Wallets"
          value={nf.format(t.total)}
          attested
          note={`${nf.format(t.negatives)} checked, nothing found`}
        />
        <Stat
          label="Resolve to a social"
          value={nf.format(t.with_any)}
          note={`${pct(t.with_any, t.total)} of the graph`}
        />
        <Stat
          label="Wallets with X"
          value={nf.format(t.with_x)}
          note={`${nf.format(t.x_attested)} owner-attested`}
        />
        <Stat
          label="Wallets with Farcaster"
          value={nf.format(t.with_fc)}
          note={`${nf.format(t.with_both)} carry both`}
        />
        <Stat
          label="Live X handles"
          value={nf.format(live)}
          note={`of ${nf.format(live + unavailable + notFound)} distinct handles checked`}
        />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle>Source breakdown</CardTitle>
          <div className="flex items-center gap-1">
            <Button
              variant={sortKey === 'wallets' ? 'soft' : 'ghost'}
              size="sm"
              onClick={() => setSortKey('wallets')}
            >
              By wallets
            </Button>
            <Button
              variant={sortKey === 'sole' ? 'soft' : 'ghost'}
              size="sm"
              onClick={() => setSortKey('sole')}
            >
              By sole source
            </Button>
            <RefreshButton onClick={() => void load()} loading={loading} />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            A wallet carries every source that touched it, so the columns sum
            past the total. Sole is wallets only that source knows: the
            best-source figure that volume can’t fake. The green dot marks an
            owner-attested evidence class.
          </p>
          <div className="grid grid-cols-[minmax(9rem,12rem)_1fr_auto_auto_auto] items-center gap-x-4 gap-y-2">
            <Eyebrow>Source</Eyebrow>
            <span />
            <Eyebrow className="text-right">Wallets</Eyebrow>
            <Eyebrow className="text-right">Sole</Eyebrow>
            <Eyebrow className="text-right">With X</Eyebrow>
            {rows.map((r) => (
              <SourceBar key={r.source} row={r} max={max} sortKey={sortKey} />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SourceBar({
  row,
  max,
  sortKey,
}: {
  row: SourceRow;
  max: number;
  sortKey: SortKey;
}) {
  const attested = isAttestedSource(row.class);
  return (
    <>
      <span className="flex min-w-0 items-center gap-2 font-mono text-xs">
        {attested ? (
          <span
            className="h-1.5 w-1.5 flex-none rounded-full bg-attested"
            aria-hidden
          />
        ) : (
          <span
            className="h-1.5 w-1.5 flex-none rounded-full bg-fill-well"
            aria-hidden
          />
        )}
        <span className="truncate" title={`${row.source} (${row.class})`}>
          {row.source}
        </span>
      </span>
      <Meter bar value={max === 0 ? 0 : row[sortKey] / max} />
      <span className="text-right font-mono text-xs tabular-nums">
        {nf.format(row.wallets)}
      </span>
      <span className="text-right font-mono text-xs tabular-nums">
        {nf.format(row.sole)}
      </span>
      <span className="text-right font-mono text-xs tabular-nums">
        {nf.format(row.with_x)}
      </span>
    </>
  );
}
