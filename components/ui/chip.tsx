'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';
import { FOCUS_RING } from '@/components/ui/button';
import { CHAIN_MARKS, CHAIN_PLATES } from '@/components/ui/chain-marks';
import { CHAIN_LABELS, type SupportedChain } from '@/lib/chains';

/**
 * Brand chips: a pressable pill whose FIELD is tinted from the brand's own
 * plate colour, the way matcha tints a token selector from the token.
 *
 * The colour section's exception covers these ("brand marks, platform and
 * chain"): the tint identifies a brand, not an affordance. Two contracts keep
 * that honest:
 *
 * - **The border contract.** The chip is identified like a soft button: label,
 *   leading mark, pill enclosure (WCAG 1.4.11 permits a text-identified
 *   component). Its `border-border` hairline is decorative separation for
 *   tint-on-tint grounds, deliberately NOT a control boundary, the same way
 *   the spinner's arc is named out of the hairline-opacity rule. The
 *   translucent-boundary guard keeps its scope.
 *
 * - **The green fence.** A chip field may never be mistakable for
 *   `--attested-tint` or `--accent-brand-tint`. Every tint percentage in
 *   `CHAIN_PLATES` is measured against both reserved tints in OKLab, per
 *   theme, and `check-contrast.mjs` re-measures on every run. Where a plate
 *   cannot clear the fence (or cannot even be seen, HyperEVM's near-black
 *   teal on the dark card), the field falls back to `--fill-subtle` in that
 *   theme and the 24px mark alone carries identity: the mark keeps its true
 *   colour, only the FIELD may not. The attested anatomy (gutter dot, green
 *   foreground) never appears on a chip.
 *
 * Theme switching happens in CSS (`.chip-tint` in globals.css) through four
 * custom properties, because the two themes ship different measured
 * percentages and an inline `background` could only carry one.
 */

const pctVar = (hex: string, pct: number | null, hoverStep: number) =>
  pct === null
    ? {}
    : {
        rest: `color-mix(in oklab, ${hex} ${pct}%, var(--card))`,
        hover: `color-mix(in oklab, ${hex} ${pct + hoverStep}%, var(--card))`,
      };

interface ChainChipProps extends React.ComponentProps<'button'> {
  chain: SupportedChain;
  /** Selected keeps the deepened (hover) tint and states itself to AT. */
  selected?: boolean;
}

export function ChainChip({
  chain,
  selected = false,
  className,
  children,
  ...props
}: ChainChipProps) {
  const Mark = CHAIN_MARKS[chain];
  const { hex, light, dark } = CHAIN_PLATES[chain];
  const l = pctVar(hex, light, 4);
  const d = pctVar(hex, dark, 4);
  const style = {
    ...(l.rest && {
      '--chip-tint-light': selected ? l.hover : l.rest,
      '--chip-tint-light-hover': l.hover,
    }),
    ...(d.rest && {
      '--chip-tint-dark': selected ? d.hover : d.rest,
      '--chip-tint-dark-hover': d.hover,
    }),
  } as React.CSSProperties;

  return (
    <button
      type="button"
      aria-pressed={selected}
      style={style}
      className={cn(
        'chip-tint inline-flex h-control shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-border pl-1.5 pr-3 text-sm font-medium text-foreground transition-control active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50',
        selected && 'font-semibold',
        FOCUS_RING,
        className
      )}
      {...props}
    >
      <Mark className="h-6 w-6 shrink-0" />
      {children ?? CHAIN_LABELS[chain]}
    </button>
  );
}

/**
 * The platform pair, on the platform-mark exception that already covers the
 * segmented control: 𝕏 takes `--x-bg` (which inverts in dark, because a
 * near-black tint on a near-black card vanishes) and Farcaster takes its
 * violet. These identify a platform, not an affordance, and the field is a
 * quiet mix over the card, never the solid plate: the solid treatment stays
 * reserved for the segmented control's selected thumb.
 */
interface PlatformChipProps extends React.ComponentProps<'button'> {
  platform: 'x' | 'farcaster';
  selected?: boolean;
}

export function PlatformChip({
  platform,
  selected = false,
  className,
  children,
  ...props
}: PlatformChipProps) {
  const plate = platform === 'x' ? 'var(--x-bg)' : 'var(--fc-bg)';
  const style = {
    '--chip-tint-light': `color-mix(in oklab, ${plate} ${selected ? 18 : 14}%, var(--card))`,
    '--chip-tint-light-hover': `color-mix(in oklab, ${plate} 18%, var(--card))`,
    '--chip-tint-dark': `color-mix(in oklab, ${plate} ${selected ? 18 : 14}%, var(--card))`,
    '--chip-tint-dark-hover': `color-mix(in oklab, ${plate} 18%, var(--card))`,
  } as React.CSSProperties;

  return (
    <button
      type="button"
      aria-pressed={selected}
      style={style}
      className={cn(
        'chip-tint inline-flex h-control shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-border px-3 text-sm font-medium text-foreground transition-control active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50',
        selected && 'font-semibold',
        FOCUS_RING,
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}
