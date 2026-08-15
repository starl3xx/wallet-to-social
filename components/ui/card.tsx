import * as React from 'react';

import { cn } from '@/lib/utils';

function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card"
      className={cn(
        'bg-card text-card-foreground flex flex-col gap-6 rounded-lg border border-border py-6 transition-colors',
        className
      )}
      {...props}
    />
  );
}

/**
 * Turns the whole card into one control, for a card that navigates somewhere.
 *
 * The six tiles on the admin Pulse pane carried `onClick` on the card `div`
 * and nothing else: no role, no tab stop, no Enter or Space. They looked like
 * controls, because they had `cursor-pointer` and a hover border, and a
 * keyboard could not reach any of them.
 *
 * A stretched button rather than `role="button"` with a `keydown` handler,
 * which is the usual patch. A real `<button>` brings the whole contract at
 * once: focus, Enter, Space, the accessibility tree, and the browser's own
 * activation behaviour. The design language says not to reproduce an
 * accessible primitive by hand when the platform already ships it.
 *
 * It is also why this is an overlay instead of wrapping the card in a button:
 * `<button>` takes phrasing content, and these tiles are made of `div`s. The
 * overlay keeps the markup valid and still gives exactly one tab stop.
 *
 * The parent card needs `relative`.
 */
function CardActivator({
  label,
  onClick,
  className,
}: {
  /** What activating it does, for a reader who cannot see the tile. */
  label: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'absolute inset-0 rounded-lg focus-visible:outline-none focus-visible:ring-2',
        'focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        className
      )}
    >
      <span className="sr-only">{label}</span>
    </button>
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        '@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-2 px-6 has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:pb-6',
        className
      )}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-title"
      className={cn('leading-none font-semibold', className)}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-description"
      className={cn('text-muted-foreground text-sm', className)}
      {...props}
    />
  );
}

function CardAction({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        'col-start-2 row-span-2 row-start-1 self-start justify-self-end',
        className
      )}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-content"
      className={cn('px-6', className)}
      {...props}
    />
  );
}

function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-footer"
      className={cn('flex items-center px-6 [.border-t]:pt-6', className)}
      {...props}
    />
  );
}

export {
  Card,
  CardActivator,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
};
