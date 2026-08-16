import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium transition-control disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-accent-brand/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default: 'bg-accent-brand text-accent-brand-foreground hover:bg-accent-brand-hover active:scale-[0.97]',
        // No dark:bg-destructive/60. That wash was there to soften a fixed red
        // against white text; the token now lifts on its own in dark mode and
        // its paired foreground is near-black, so washing the fill into the
        // page left dark text on a translucent red. The pair handles both
        // themes, and diluting either half breaks the contrast it guarantees.
        destructive:
          'bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40',
        // `border-input` in both themes, not only dark. This is the variant
        // whose entire affordance is its edge, so that edge has to clear 3:1;
        // it was inheriting the decorative `--border` in light and reading at
        // 1.26:1. The fills move to `--muted`, because a fill should come from
        // a surface token: while they rode on `--input` they inherited every
        // change made to the boundary for contrast reasons.
        outline:
          'border border-input bg-background hover:bg-accent hover:text-accent-foreground dark:bg-muted/30 dark:hover:bg-muted/50',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost:
          'hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50',
        link: 'text-accent-brand underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-control px-5 has-[>svg]:px-4',
        sm: 'h-control gap-1.5 px-4 has-[>svg]:px-3',
        lg: 'h-12 px-7 has-[>svg]:px-5',
        icon: 'size-control',
        'icon-sm': 'size-8',
        'icon-lg': 'size-12',
        /**
         * For a `link` button sitting inside running text or a table cell, where
         * the 34px control height and its padding would push the row open.
         *
         * It exists because two call sites had already hand-copied the `link`
         * variant's classes rather than use it, purely to escape the height, and
         * a third copy was the alternative to naming it here. Type comes from the
         * cell: `cn` runs tailwind-merge, so a caller's `text-xs` beats the base.
         */
        inline: 'h-auto p-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : 'button';

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
