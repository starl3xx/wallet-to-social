'use client';

import { Warning, CheckCircle } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

/**
 * The one error banner and the one success banner in the admin panel.
 *
 * There were five error treatments: a faded `/20` border in the page, a `/10`
 * one in SystemHealth, a full-opacity border with an icon in UsageMeter and
 * AccountDetail, a borderless tint in WalletEnrichment, and a bare red
 * paragraph in DependencyHealth and HandleConflicts. The `/20` and `/10`
 * borders passed CI only because the border-opacity guard does not list
 * `destructive`; the rule bans them regardless.
 *
 * Both tones use the full-opacity tint tokens rather than `bg-x/10`. The tint
 * is a real colour in both themes, so the banner reads the same on the page
 * and inside a card; a 10% wash changes with whatever sits behind it.
 *
 * Success is `attested`, not `accent-brand`: a saved edit is a real outcome,
 * and violet would say there is something here to click.
 */
const TONES = {
  error: {
    box: 'border-destructive bg-destructive-tint text-destructive',
    Icon: Warning,
  },
  success: {
    box: 'border-attested bg-attested-tint text-attested',
    Icon: CheckCircle,
  },
} as const;

export function Banner({
  tone,
  children,
  className,
}: {
  tone: keyof typeof TONES;
  children: React.ReactNode;
  className?: string;
}) {
  const { box, Icon } = TONES[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-3 rounded-lg border p-4 text-sm',
        box,
        className
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 flex-none" aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
