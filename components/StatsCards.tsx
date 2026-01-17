'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { WalletSocialResult } from '@/lib/types';

interface StatsCardsProps {
  results: WalletSocialResult[];
}

export function StatsCards({ results }: StatsCardsProps) {
  const stats = {
    total: results.length,
    twitter: results.filter((r) => r.twitter_handle).length,
    farcaster: results.filter((r) => r.farcaster).length,
    lens: results.filter((r) => r.lens).length,
    github: results.filter((r) => r.github).length,
    anySocial: results.filter(
      (r) => r.twitter_handle || r.farcaster || r.lens || r.github
    ).length,
  };

  const cards = [
    { title: 'Total Wallets', value: stats.total, color: 'text-foreground', badgeColor: '' },
    { title: 'Twitter Found', value: stats.twitter, color: 'text-blue-500', badgeColor: 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400' },
    {
      title: 'Farcaster Found',
      value: stats.farcaster,
      color: 'text-purple-500',
      badgeColor: 'bg-purple-50 text-purple-600 dark:bg-purple-500/10 dark:text-purple-400',
    },
    { title: 'Any Social', value: stats.anySocial, color: 'text-emerald-500', badgeColor: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400' },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {cards.map((card) => (
        <Card key={card.title}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {card.title}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className={`text-2xl font-bold ${card.color}`}>
              {card.value.toLocaleString()}
            </p>
            {card.title !== 'Total Wallets' && stats.total > 0 && (
              <span className={`inline-block text-xs font-medium mt-1 px-2 py-0.5 rounded-md ${card.badgeColor}`}>
                {((card.value / stats.total) * 100).toFixed(1)}% of total
              </span>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
