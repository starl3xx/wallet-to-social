'use client';

import * as React from 'react';
import * as ProgressPrimitive from '@radix-ui/react-progress';

import { cn } from '@/lib/utils';

/**
 * A determinate bar. Radix supplies the `progressbar` role and its value
 * attributes; appearance comes from the design language.
 *
 * The fill moves by `transform`, which the compositor animates without laying
 * the page out, and it moves on the 220ms state-change duration with the
 * arriving curve, named from the tokens. It was `transition-all`, which would
 * have animated width or height had anything ever set them, and brought
 * Tailwind's duration rather than ours. `motion-reduce:transition-none` is
 * what the doc asks of every transform: under reduced motion the bar still
 * lands at the right value, it just lands there at once.
 *
 * The fill is `accent-brand` because it used to be `bg-primary`, the
 * unadapted shadcn token that painted the bar near-black in light mode.
 */
function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn(
        'bg-muted relative h-2 w-full overflow-hidden rounded-full',
        className
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="bg-accent-brand h-full w-full flex-1 transition-transform duration-[var(--duration-base)] ease-[var(--ease-out-soft)] motion-reduce:transition-none"
        style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };
