'use client';

import { memo, useMemo } from 'react';
import { XMark, FarcasterMark } from '@/components/ui/brand-marks';
import type { WalletSocialResult } from '@/lib/types';

interface StatsCardsProps {
  results: WalletSocialResult[];
}

/**
 * The outcome, stated once, with its components subordinate to it.
 *
 * This was five equal cards: a total, three parts, and the one figure that is
 * actually the answer, all at the same size in the same box. Giving identical
 * emphasis to "Total wallets" and "Any social" makes the reader do the work of
 * deciding which number the lookup was for.
 *
 * Only one of these figures gets planned against, so only one gets display
 * scale. The rest become a strip beneath it, which also makes the overlap
 * legible for free: 231 𝕏 plus 285 Farcaster against 306 reachable says 210
 * people have both, and five equal cards said nothing about that at all.
 *
 * The hero figure is green, because a hit rate is a measured outcome: "this
 * lookup returned this" (docs/DESIGN-LANGUAGE.md, Colour, which names the hit
 * rate beside the gutter dot and the live pulse). It was brand violet, which
 * marks an affordance, and nothing about the count can be pressed; Recent wins
 * already painted the same measure green forty pixels of scroll away. The
 * earlier worry, that `twitter` counts handles correlated from an index, is
 * answered by where the claim sits: green on the figure says the lookup found
 * this many, and the per-row gutter dots carry whether each one is attested.
 * The three parts beneath stay plain, which is what makes the outcome read.
 *
 * Weight 200: the one weight for a figure standing alone at 24px and up.
 */
export const StatsCards = memo(function StatsCards({
  results,
}: StatsCardsProps) {
  const stats = useMemo(
    () => ({
      total: results.length,
      twitter: results.filter((r) => r.twitter_handle).length,
      farcaster: results.filter((r) => r.farcaster).length,
      agents: results.filter((r) => r.is_agent).length,
      anySocial: results.filter(
        (r) => r.twitter_handle || r.farcaster || r.lens || r.github
      ).length,
    }),
    [results]
  );

  const pct =
    stats.total > 0
      ? ((stats.anySocial / stats.total) * 100).toFixed(1)
      : '0.0';

  return (
    <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-5 border-t border-border pt-5">
      <div>
        <p className="text-5xl font-extralight leading-none tracking-[var(--tracking-display)] tabular-nums text-attested">
          {stats.anySocial.toLocaleString()}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          reachable of{' '}
          <span className="tabular-nums">{stats.total.toLocaleString()}</span>{' '}
          wallets
          {' · '}
          <span className="tabular-nums">{pct}</span>%
        </p>
      </div>

      <dl className="flex flex-wrap gap-x-8 gap-y-3 text-sm text-muted-foreground">
        <Split
          icon={<XMark className="h-3 w-3" />}
          label="handles"
          value={stats.twitter}
        />
        <Split
          icon={<FarcasterMark className="h-3 w-3" />}
          label="Farcaster"
          value={stats.farcaster}
        />
        <Split label="agents" value={stats.agents} />
      </dl>
    </div>
  );
});

function Split({
  icon,
  label,
  value,
}: {
  icon?: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    /* dt before dd in the DOM, because a definition list requires the term first
       and assistive tech reads the pairing from that order. flex-col-reverse puts
       the figure on top visually without lying about the structure. */
    <div className="flex flex-col-reverse">
      <dt className="mt-0.5 flex items-center gap-1.5">
        {icon}
        {label}
      </dt>
      <dd className="ml-0 text-lg font-semibold tabular-nums text-foreground">
        {value.toLocaleString()}
      </dd>
    </div>
  );
}
