import { cn } from '@/lib/utils';

/**
 * A filled track. The fill is a full-width element scaled by `transform`
 * from its left edge, so a change of value moves on the compositor: the admin
 * drew these with an inline `width` and `transition-all`, which animated
 * width, and the design language names width as a property that is never
 * animated. The move takes the state-change duration on the arriving curve,
 * from the tokens, and stops under reduced motion.
 *
 * `rounded-sm` on track and fill. The chip radius rather than the pill, so a
 * bar does not read as a control; two of the four bars in the admin already
 * had it and the other two were `rounded-full`.
 *
 * Two heights, named: a meter (`h-1.5`, the default) shows a share of a
 * limit; a chart bar (`bar`, `h-4`) is one row of a bar chart beside a
 * figure, where six pixels would disappear next to the text.
 *
 * Not a progress bar for a match rate. The CLAUDE.md rule against drawing a
 * rate as a bar is written for customers, and it is applied in the admin too:
 * a 12% rate drawn as a fill reads as 88% unfinished. Rates are figures.
 */
export function Meter({
  value,
  tone = 'brand',
  bar,
  className,
}: {
  /** 0 to 1. Anything past 1 is drawn full. */
  value: number;
  /**
   * `brand` for a plain share; `caution` when a limit is near; `destructive`
   * when it is passed.
   */
  tone?: 'brand' | 'caution' | 'destructive';
  /** A chart row rather than a meter. */
  bar?: boolean;
  className?: string;
}) {
  const fill = {
    brand: 'bg-accent-brand',
    caution: 'bg-caution',
    destructive: 'bg-destructive',
  }[tone];
  return (
    <div
      className={cn(
        'min-w-0 overflow-hidden rounded-sm bg-muted',
        bar ? 'h-4' : 'h-1.5',
        className
      )}
    >
      <div
        className={cn(
          'h-full w-full origin-left rounded-sm transition-transform duration-[var(--duration-base)] ease-[var(--ease-out-soft)] motion-reduce:transition-none',
          fill
        )}
        style={{ transform: `scaleX(${Math.min(1, Math.max(0, value))})` }}
      />
    </div>
  );
}
