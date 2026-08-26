'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Stack } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FREE_MATCHES_PER_WINDOW, FREE_WINDOW_DAYS } from '@/lib/packs';

/** The shape /api/starter-collections returns. Kept local so this component
 *  does not pull the corpus module, and its database imports, into the page. */
interface StarterCollection {
  chain: string;
  address: string;
  name: string;
  symbol: string | null;
  holders: number;
  reachableAny: number;
}

export interface StarterRun {
  chain: string;
  address: string;
  name: string;
}

interface StarterCollectionsProps {
  onRun: (collection: StarterRun) => void;
}

const shortAddress = (wallet: string) =>
  `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;

/**
 * A first action for somebody who has brought nothing.
 *
 * Every other way in asks for a file, a contract address or a handle, so an
 * account with no data of its own has nothing to press. These collections are
 * already in the index: we hold the holder lists, so running one costs no
 * external call and needs no upload.
 *
 * It is an alternative to bringing a file, not an advert, and the copy has to
 * earn that. So it says what the click does before it happens and what it
 * costs, in the same shape ReverseLookup states its free/paid split: the run
 * is metered exactly like any other lookup, and nothing here claims a match
 * rate. What comes back is the people we can resolve.
 */
export function StarterCollections({ onRun }: StarterCollectionsProps) {
  const [collections, setCollections] = useState<StarterCollection[]>([]);
  const [walletCap, setWalletCap] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/starter-collections');
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) {
            setCollections(data.collections ?? []);
            setWalletCap(data.walletCap ?? 0);
          }
        }
      } catch (error) {
        console.error('Failed to fetch starter collections:', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const run = useCallback(
    (c: StarterCollection) => {
      onRun({ chain: c.chain, address: c.address, name: c.name });
    },
    [onRun]
  );

  // Nothing to offer is not a broken panel: every other way in is still on the
  // page, so this says nothing rather than apologising for itself.
  if (loading || collections.length === 0 || walletCap === 0) return null;

  return (
    <Card className="gap-4 p-6">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Stack className="h-4 w-4 text-accent-brand" aria-hidden />
          <h2 className="text-base font-semibold">
            Or start with a collection we already hold
          </h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Nothing to upload. We supply the wallet list, and you get back the
          people we can resolve from it.
        </p>
        <p className="text-sm text-muted-foreground">
          A run reads {walletCap} holders and is metered like any other lookup:
          at most one match per holder we resolve, and a wallet we cannot
          resolve costs nothing. Free covers {FREE_MATCHES_PER_WINDOW} matches
          in a rolling {FREE_WINDOW_DAYS}-day window.
        </p>
      </div>

      <ul className="space-y-3">
        {collections.map((c) => (
          <li
            key={`${c.chain}:${c.address}`}
            className="flex items-center justify-between gap-4 rounded-lg border border-border p-4"
          >
            <div className="min-w-0">
              {/* The name is a name, so it is not mono. The chain and the
                  contract address on the line below are machine data and take
                  the mono face, which is also what keeps them from reading as
                  part of the sentence above. */}
              <p className="truncate font-medium">{c.name}</p>
              <p className="truncate font-mono text-xs text-muted-foreground">
                {c.chain} · {shortAddress(c.address)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                <span className="tabular-nums">
                  {c.reachableAny.toLocaleString()}
                </span>{' '}
                reachable people in the{' '}
                <Button asChild variant="link" size="inline">
                  <Link href={`/holders/${c.chain}/${c.address}`}>
                    full report
                  </Link>
                </Button>
              </p>
            </div>
            {/* The count is in the label because it is what the press costs.
                A wrapper div, so the button is not a flex item on the axis
                carrying its height. */}
            <div className="flex-none">
              <Button size="sm" onClick={() => run(c)}>
                Run {Math.min(c.holders, walletCap)} holders
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
