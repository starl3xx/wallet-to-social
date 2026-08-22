import { Card, CardContent } from '@/components/ui/card';
import { Eyebrow } from '@/components/ui/eyebrow';
import { cn } from '@/lib/utils';

/**
 * The one figure treatment in the admin: the same string
 * `components/ui/figure.tsx` sets, so a number standing alone is one weight
 * and one tracking on every surface. 200 is the hero-figure cut; the admin had
 * it at 700, 600 and 500 across the panes, and 700 is not one of the five
 * weights at all.
 */
export const FIGURE =
  'text-2xl font-extralight tabular-nums tracking-[var(--tracking-title)]';

/**
 * One stat: an `Eyebrow` label over a 200-weight figure, with an optional
 * aside beside the figure (a sparkline, a trend, a delta) and an optional note
 * beneath it.
 *
 * There were four anatomies for this object: `text-xs` label with a 12px icon,
 * `text-sm` label with a coloured 16px icon, `text-xs` label with a 600 figure,
 * and `Eyebrow` with a 600 figure. The label is the eyebrow, with no icon: the
 * affordance table gives a label no icon, and the violet and caution the
 * whitelist icons carried said nothing the label did not.
 *
 * Not the `Figure` primitive, which renders its own `text-xs` term and takes
 * no aside; the admin tiles put a sparkline or a delta beside the number, so
 * the anatomy is spelled out here once instead.
 */
export function Stat({
  label,
  value,
  aside,
  note,
  attested,
  className,
  valueClassName,
}: {
  label: string;
  value: React.ReactNode;
  /** Sits at the figure's baseline, right-aligned: a sparkline or a delta. */
  aside?: React.ReactNode;
  /** One muted line under the figure. */
  note?: React.ReactNode;
  /** The green dot: this figure is a measured fact, not an estimate. */
  attested?: boolean;
  className?: string;
  /** A colour for the figure itself, e.g. `text-attested` on an outcome. */
  valueClassName?: string;
}) {
  // `inline-flex` rather than `flex`, so the figure follows the container's
  // text alignment: a funnel step centres it, a tile leaves it at the left.
  const figure = (
    <span
      className={cn(FIGURE, 'inline-flex items-center gap-2', valueClassName)}
    >
      {attested && (
        <span
          className="h-1.5 w-1.5 flex-none rounded-full bg-attested"
          aria-hidden
        />
      )}
      {value}
    </span>
  );
  return (
    <div className={cn('min-w-0', className)}>
      <Eyebrow>{label}</Eyebrow>
      {aside ? (
        <div className="mt-1 flex items-end justify-between gap-2">
          {figure}
          {aside}
        </div>
      ) : (
        <div className="mt-1">{figure}</div>
      )}
      {note && <div className="mt-1 text-xs text-muted-foreground">{note}</div>}
    </div>
  );
}

/**
 * The stat inside its own card. `Card` carries `py-6` and `CardContent`
 * `px-6`, which together are the `p-6` card padding; the tiles used to add
 * `pt-4 pb-3`, `pt-6` or `p-3` on top of that, which is where the 12, 16 and
 * 24px paddings for one object came from.
 *
 * `relative`, so a `CardActivator` child can stretch over it.
 */
export function StatTile({
  className,
  children,
  ...stat
}: React.ComponentProps<typeof Stat> & { children?: React.ReactNode }) {
  return (
    <Card className={cn('relative', className)}>
      {children}
      <CardContent>
        <Stat {...stat} />
      </CardContent>
    </Card>
  );
}
