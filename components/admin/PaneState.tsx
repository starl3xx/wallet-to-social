'use client';

import { CircleNotch } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

/**
 * The one loading block. A 20px spinner (the control step of the icon scale)
 * centred in 48px of padding, announced as a status so a screen reader hears
 * "Loading" once rather than nothing.
 *
 * The panes had it at 32px, 24px and 20px, and two of them wrote the word
 * "Loading…" in muted text instead. One block, one size.
 */
export function Loading({ className }: { className?: string }) {
  return (
    <div role="status" className={cn('flex justify-center py-12', className)}>
      <CircleNotch
        className="h-5 w-5 animate-spin text-muted-foreground"
        aria-hidden
      />
      <span className="sr-only">Loading</span>
    </div>
  );
}

/**
 * The one empty state: a centred muted sentence in 32px of padding. It was
 * `py-8` in some panes, `py-4` in others, left-aligned `text-sm` in a third
 * group, and a table row with `colSpan` in a fourth.
 */
export function Empty({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        'py-8 text-center text-sm text-muted-foreground',
        className
      )}
    >
      {children}
    </p>
  );
}
