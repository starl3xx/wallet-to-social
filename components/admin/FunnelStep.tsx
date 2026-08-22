import { Stat } from './Stat';

/**
 * One step of a funnel: a centred `Stat`, with the share of the first step
 * beneath it when the pane has a denominator to divide by.
 *
 * Both funnels render through this inside a grid that wraps, so a phone gets
 * two or three steps to a row rather than six squeezed into one. The revenue
 * funnel was a `flex` row with a caret between every step, which cannot wrap:
 * the carets are gone from both, because an arrow at the end of a wrapped row
 * points at nothing, and the order of the steps already reads left to right.
 */
export function FunnelStep({
  label,
  count,
  rate,
  valueClassName,
}: {
  label: string;
  count: number;
  /**
   * Share of the first step. `null` when there is no denominator, which is
   * rendered as "n/a" rather than as a percentage of one. Omit it entirely on
   * a funnel that does not show shares.
   */
  rate?: number | null;
  /** A colour for the figure, e.g. `text-attested` on the paid step. */
  valueClassName?: string;
}) {
  return (
    <Stat
      className="text-center"
      label={label}
      value={count.toLocaleString()}
      valueClassName={valueClassName}
      note={
        rate === undefined ? undefined : rate === null ? (
          <span title="No page views recorded in this window, so a rate cannot be computed">
            n/a
          </span>
        ) : (
          <span className="tabular-nums">{rate.toFixed(0)}%</span>
        )
      }
    />
  );
}
