'use client';

import { useRef } from 'react';
import { cn } from '@/lib/utils';
import { FOCUS_RING } from '@/components/ui/button';

export interface SegmentedOption<T extends string> {
  value: T;
  /** Accessible name. The visible content may be an icon with no text. */
  label: string;
  content: React.ReactNode;
  /** Optional per-option thumb colour, for platform brand marks. */
  thumbStyle?: React.CSSProperties;
  /**
   * Colour of the option's own content when selected. It travels with the thumb
   * colour rather than with the theme: an 𝕏 mark on a white thumb has to be
   * black, and the default accent would be unreadable on it.
   */
  activeColor?: string;
}

/**
 * One segmented control, with a thumb that moves.
 *
 * There were two hand-rolled versions of this, and neither animated: the
 * selected background simply appeared under the new option. That reads as two
 * unrelated states rather than one control changing, and it loses the only
 * information the transition carries, which is *which option you came from*.
 *
 * The thumb is a single absolutely positioned element translated by whole
 * multiples of its own width, so the maths stays exact regardless of how many
 * options there are: every segment is the same width, so `translateX(index *
 * 100%)` lands precisely.
 *
 * Movement is also why the segments cannot size to their content. The 𝕏 option
 * holds a 14px mark and the Farcaster option holds nine characters; letting them
 * size naturally would mean the thumb has to measure the DOM to know where to
 * stop. Equal widths make it arithmetic.
 *
 * **The equal widths have to be real, and with flexbox they were not.** This
 * was `inline-flex` with `flex-1 basis-0` segments, which reads as equal and
 * is not: a flex item's `min-width` defaults to `auto`, which floors it at its
 * own content width, so the control settled at its min-content size with every
 * segment its natural width. Measured in Chrome, "All / Free / Pro /
 * Unlimited" came out 39.6 / 52.8 / 45.8 / 82.4 — and the thumb, sized and
 * stepped by the *average*, covered 61% of the selected segment and spilled
 * into its neighbour. Constrained or not made no difference; the assumption
 * was simply false whenever two labels differed in length, which is every
 * call site with words in it.
 *
 * A grid fixes it where the claim is actually made. `grid-auto-columns: 1fr`
 * with `min-w-0` segments gives columns that are equal by construction: at
 * their natural size the control is N times the widest label, and squeezed by
 * a narrow parent they shrink together rather than one at a time. The thumb
 * arithmetic below is unchanged, because it was never the broken half.
 *
 * `role="radiogroup"` is a behavioural promise, so it is kept: one tab stop,
 * arrows move selection, Home and End jump to the ends.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value)
  );
  const active = options[index];

  const move = (from: number, delta: number) => {
    const next = (from + delta + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    const k = e.key;
    if (k === 'ArrowRight' || k === 'ArrowDown') {
      e.preventDefault();
      move(i, 1);
    } else if (k === 'ArrowLeft' || k === 'ArrowUp') {
      e.preventDefault();
      move(i, -1);
    } else if (k === 'Home') {
      e.preventDefault();
      move(0, 0);
    } else if (k === 'End') {
      e.preventDefault();
      move(options.length - 1, 0);
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      /**
       * The hairline is not decoration. The track is `bg-muted`, and this
       * control gets dropped onto surfaces that are also `bg-muted`: on the
       * upload panel it painted itself invisible, so the unselected half had no
       * edge and the selected half read as a white pill floating in the page
       * rather than as one control with two sides.
       *
       * A border fixes it at the component rather than at each call site,
       * because the next `bg-muted` surface someone puts this on would break it
       * again. It is also what the design language already prescribes:
       * separation is carried by one hairline at full token opacity.
       *
       * Height is unaffected: `box-sizing: border-box` is global, so the border
       * sits inside the 34px. The thumb's arithmetic is unaffected too, since an
       * absolutely positioned child resolves its percentages against the padding
       * box, which the border does not touch.
       */
      className={cn(
        'relative inline-grid grid-flow-col [grid-auto-columns:1fr] h-control items-center rounded-full border border-border bg-muted p-1',
        className
      )}
    >
      <span
        aria-hidden
        className="segmented-thumb absolute inset-y-1 left-1 rounded-full bg-surface-raised"
        data-thumb
        style={{
          width: `calc((100% - 0.5rem) / ${options.length})`,
          transform: `translateX(${index * 100}%)`,
          ...active?.thumbStyle,
        }}
      />
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          aria-label={o.label}
          title={o.label}
          tabIndex={i === index ? 0 : -1}
          onKeyDown={(e) => onKeyDown(e, i)}
          onClick={() => onChange(o.value)}
          className={cn(
            // `min-w-0` is load-bearing, not tidying: it is what lets a grid
            // column shrink below the label inside it, so a squeezed control
            // narrows every segment together instead of holding the widest at
            // its content size and unequalising the row.
            'segmented-option relative z-10 flex h-full min-w-0 items-center justify-center gap-2 rounded-full',
            'px-3 text-sm font-medium',
            // The ring Button and Input draw, from the one string, so the
            // segment beside a button lights up the same way it does.
            FOCUS_RING,
            // An unselected segment reads at near-full contrast rather than as
            // muted grey. Muted is the colour of text you cannot act on, and it
            // was telling people the other half of the control was disabled.
            o.value === value
              ? 'font-semibold'
              : 'text-foreground/75 hover:text-foreground'
          )}
          style={
            o.value === value
              ? { color: o.activeColor ?? 'var(--accent-brand)' }
              : undefined
          }
        >
          {o.content}
        </button>
      ))}
    </div>
  );
}
