'use client';

import { memo, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { WalletSocialResult } from '@/lib/types';

interface StatsCardsProps {
  results: WalletSocialResult[];
}

export const StatsCards = memo(function StatsCards({ results }: StatsCardsProps) {
  const stats = useMemo(() => ({
    total: results.length,
    twitter: results.filter((r) => r.twitter_handle).length,
    farcaster: results.filter((r) => r.farcaster).length,
    lens: results.filter((r) => r.lens).length,
    github: results.filter((r) => r.github).length,
    agents: results.filter((r) => r.is_agent).length,
    anySocial: results.filter(
      (r) => r.twitter_handle || r.farcaster || r.lens || r.github
    ).length,
  }), [results]);

  /**
   * Colour carries meaning here or it carries nothing.
   *
   * `attested` marks the two counts where the identity was published by the
   * owner: an 𝕏 handle or a Farcaster account. "Agents detected" is
   * deliberately neutral, because detection is inference and dressing it in the
   * same green would claim a provenance it does not have. The reachable figure
   * takes the brand, because it is the number a campaign is planned against.
   */
  const cards = [
    { title: 'Total wallets', value: stats.total, tone: 'neutral' as const },
    { title: '𝕏 attested', value: stats.twitter, tone: 'attested' as const },
    { title: 'Farcaster attested', value: stats.farcaster, tone: 'attested' as const },
    { title: 'Agents detected', value: stats.agents, tone: 'neutral' as const },
    { title: 'Any social', value: stats.anySocial, tone: 'brand' as const },
  ];

  const TONE = {
    neutral: { card: '', value: 'text-foreground', badge: 'bg-muted text-muted-foreground' },
    attested: {
      card: 'border-attested/25 bg-attested-tint/40',
      value: 'text-foreground',
      badge: 'bg-attested-tint text-attested',
    },
    brand: {
      card: 'border-accent-brand/25 bg-accent-brand-tint/40',
      value: 'text-accent-brand',
      badge: 'bg-accent-brand-tint text-accent-brand',
    },
  };

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
      {cards.map((card) => {
        const tone = TONE[card.tone];
        return (
          <Card key={card.title} className={tone.card}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                {card.tone === 'attested' && (
                  <span
                    className="h-2 w-2 shrink-0 rounded-full bg-attested"
                    // The mark is never the only signal: the label says
                    // "attested" beside it, so nothing depends on seeing hue.
                    aria-hidden="true"
                  />
                )}
                {card.title}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className={`text-2xl font-medium tabular-nums ${tone.value}`}>
                {card.value.toLocaleString()}
              </p>
              {card.title !== 'Total wallets' && stats.total > 0 && (
                <span className={`inline-block text-xs font-medium mt-1 px-2 py-0.5 rounded-md ${tone.badge}`}>
                  {((card.value / stats.total) * 100).toFixed(1)}% of total
                </span>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
});
