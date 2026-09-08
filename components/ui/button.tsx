import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/**
 * The one focus ring. Button, Input, Textarea and Segmented import this string;
 * the other controls in the product already carry it by hand.
 *
 * Three treatments existed: Button drew a 3px half-opacity halo with no gap,
 * Input turned its edge brand and added a 2px ring at 20%, and ten other sites
 * drew this offset ring. The offset ring is the one kept, and not only because
 * it was the majority. A translucent halo is visible on a white field and
 * invisible on a filled brand button or on a platform-coloured thumb, because
 * it is the same hue as the fill it sits on. A 2px solid `--ring` ring held 2px
 * off the control by a gap of page colour shows on every surface a control can
 * sit on, which is what a focus indicator is for: WCAG 2.4.11 wants 3:1 against
 * the colours beside it. `--ring` is the token that exists for exactly this.
 *
 * `outline-none` belongs in the string. The base layer gives every element an
 * `outline-ring/50` colour, so a control without it draws the agent's outline
 * and the ring at once.
 *
 * Focus never animates. `transition-control` does not list box-shadow, which is
 * what a ring is drawn with, so the ring is there the instant focus lands.
 */
export const FOCUS_RING =
  'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

/**
 * The one WRAPPER spelling of the same ring, for a container whose CHILD holds
 * focus: the panel-as-field card, a chip rendered as a link wrapper. FOCUS_RING
 * is a `focus-visible:` string and does nothing on an element that never holds
 * focus itself, and a builder left without this spelling hand-rolls a fourth
 * treatment, which is how the pre-consolidation history started.
 *
 * `has-[:focus-visible]` rather than `focus-within` so a mouse click into the
 * field paints no ring, matching focus-visible semantics. The inner input
 * carries `outline-none` explicitly; it does not inherit this one's. Two
 * spellings, one treatment, both never animated.
 */
export const FOCUS_RING_WITHIN =
  'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background';

const buttonVariants = cva(
  // Press is the only transform, and every variant gets it: it is the one
  // feedback that works on touch, and a pill that presses while the link beside
  // it does not is two controls pretending to be one system.
  // `transition-control` carries the 80ms press duration and the reduced-motion
  // override that removes it.
  `inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium transition-control active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 ${FOCUS_RING}`,
  {
    variants: {
      variant: {
        default:
          'bg-accent-brand text-accent-brand-foreground hover:bg-accent-brand-hover',
        // No dark:bg-destructive/60. That wash was there to soften a fixed red
        // against white text; the token now lifts on its own in dark mode and
        // its paired foreground is near-black, so washing the fill into the
        // page left dark text on a translucent red. The pair handles both
        // themes, and diluting either half breaks the contrast it guarantees.
        // Its focus ring is the shared one: a red ring on a red pill was a
        // second treatment that could not be seen.
        destructive:
          'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        // `border-input` in both themes, not only dark. This is the variant
        // whose entire affordance is its edge, so that edge has to clear 3:1;
        // it was inheriting the decorative `--border` in light and reading at
        // 1.26:1. The fill is the surface it sits on, and the hover fill is
        // `--muted` in both themes. It hovered to shadcn's `accent`, which is
        // the same grey under a name that reads like a brand token, and rested
        // in dark mode on `bg-muted/30`, a wash whose contrast changed with
        // whatever sat behind it. The same argument that makes a control
        // boundary opaque makes its fill opaque: a value that depends on the
        // surface is a value that is wrong on one of them.
        // The default secondary. No border: identification is carried by the
        // label, the leading icon and the pill enclosure (the four-axis
        // affordance table), which WCAG 1.4.11 permits for a text-identified
        // component; the fill is hover-ground, not identification. Rests on
        // the subtle wash, hovers one named step deeper. A wash cannot paint
        // itself out on a matching surface, which is what retired the opaque
        // alternative.
        soft: 'bg-fill-subtle text-foreground hover:bg-fill-hover',
        // Demoted from default secondary to the variant for arbitrary or
        // unknown surfaces: this is the one whose entire affordance is its
        // edge, so it keeps the opaque 3:1 `--input` boundary. Its hover
        // moved to the subtle wash so one mechanism serves all three
        // fill-hovering variants.
        outline:
          'border border-input bg-transparent hover:bg-fill-subtle hover:text-foreground',
        ghost: 'hover:bg-fill-subtle hover:text-foreground',
        link: 'text-accent-brand underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-control px-5 has-[>svg]:px-4',
        sm: 'h-control gap-2 px-4 has-[>svg]:px-3',
        /**
         * The single primary action of a view, at the scale that makes it one.
         * Body content only, never the header (the 320px arithmetic). 16px
         * label at the lead tracking step, because 16-19px is the lead tier.
         * At most one per view; the guard measures it at 48px rendered.
         */
        hero: 'h-control-hero px-6 text-base tracking-[var(--tracking-lead)] has-[>svg]:px-5',
        /** Table-row and dense admin controls. Hit area per axis; see the
         *  ladder comment in globals.css before adding an ::after inset. */
        compact: 'h-control-compact px-3 has-[>svg]:px-2.5',
        /**
         * Chart timeframe/filter rows only: the WCAG 2.2 floor exactly. Sans,
         * sentence case, pill: the affordance table's micro-pill row is what
         * keeps it from impersonating the mono/uppercase Badge at the same
         * font size. A SELECTED micro pill takes `bg-fill-well
         * text-accent-brand font-semibold` at the call site: the enclosure
         * alone measures ~1.1:1 and cannot carry state under 1.4.11; the
         * segmented control already answered this (weight plus the accent).
         */
        micro: 'h-control-micro gap-1 px-2 text-[11px]',
        icon: 'size-control',
        'icon-hero': 'size-control-hero',
        'icon-compact': 'size-control-compact',
        /**
         * The same box as `icon`. The name is kept because seven admin rows and
         * one field toggle ask for it; the 32px box it used to name was the
         * only control in the product at that height, and `--h-ctl` is the
         * height every control in a row resolves to. Reach for `icon` in new
         * code; this alias goes when its callers have moved.
         */
        'icon-sm': 'size-control',
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

/**
 * `secondary` and `lg` are gone; `hero` is not `lg` returned. `lg` was a
 * shadcn size with no placement rule, which is exactly what let it spread;
 * `hero` is 48px WITH a placement (the single primary action of a view, body
 * content only) and a guard that measures it. `bg-secondary` stays gone: a
 * token that states nothing. The `soft` variant is the default secondary now;
 * `outline` survives for controls that must read on arbitrary surfaces.
 */
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
