'use client';

import { useRef } from 'react';
import { cn } from '@/lib/utils';

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
 * options there are: segments are `flex-1` on a zero basis, so every one is the
 * same width and `translateX(index * 100%)` lands precisely.
 *
 * Movement is also why the segments cannot size to their content. The 𝕏 option
 * holds a 14px mark and the Farcaster option holds nine characters; letting them
 * size naturally would mean the thumb has to measure the DOM to know where to
 * stop. Equal widths make it arithmetic.
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
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const active = options[index];

  const move = (from: number, delta: number) => {
    const next = (from + delta + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    const k = e.key;
    if (k === 'ArrowRight' || k === 'ArrowDown') { e.preventDefault(); move(i, 1); }
    else if (k === 'ArrowLeft' || k === 'ArrowUp') { e.preventDefault(); move(i, -1); }
    else if (k === 'Home') { e.preventDefault(); move(0, 0); }
    else if (k === 'End') { e.preventDefault(); move(options.length - 1, 0); }
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn('relative inline-flex h-control items-center rounded-full bg-muted p-1', className)}
    >
      <span
        aria-hidden
        className="segmented-thumb absolute inset-y-1 left-1 rounded-full bg-surface-raised"
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
            'segmented-option relative z-10 flex h-full flex-1 basis-0 items-center justify-center gap-1.5 rounded-full',
            'px-3 text-sm focus-visible:outline-none focus-visible:ring-2',
            'focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            o.value === value ? 'font-semibold' : 'text-muted-foreground hover:text-foreground'
          )}
          style={
            o.value === value ? { color: o.activeColor ?? 'var(--accent-brand)' } : undefined
          }
        >
          {o.content}
        </button>
      ))}
    </div>
  );
}
