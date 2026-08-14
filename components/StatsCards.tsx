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
   * Colour carries meaning here or it carries nothing, which is why four
   * unrelated hues are gone.
   *
   * These are counts of identities *present*, not identities *attested*. They
   * are deliberately not green: `stats.twitter` counts any row with a handle,
   * including ones correlated from an index, and marking that with the
   * attestation colour would claim a provenance the number does not have.
   * Green here waits on per-identity verification reaching the client.
   *
   * The brand goes on "Any social" because that is the figure a campaign gets
   * planned against.
   */
  const cards = [
    { title: 'Total wallets', value: stats.total, tone: 'neutral' as const },
    { title: '𝕏 handles', value: stats.twitter, tone: 'neutral' as const },
    { title: 'Farcaster', value: stats.farcaster, tone: 'neutral' as const },
    { title: 'Agents detected', value: stats.agents, tone: 'neutral' as const },
    { title: 'Any social', value: stats.anySocial, tone: 'brand' as const },
  ];

  const TONE = {
    neutral: { card: '', value: 'text-foreground', badge: 'bg-muted text-muted-foreground' },
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
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {card.title}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className={`text-2xl font-medium tabular-nums ${tone.value}`}>
                {card.value.toLocaleString()}
              </p>
              {card.title !== 'Total wallets' && stats.total > 0 && (
                <span className={`inline-block text-xs font-medium mt-1 px-2 py-0.5 rounded-lg ${tone.badge}`}>
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
