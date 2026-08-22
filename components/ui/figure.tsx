/**
 * One proof figure with its caption.
 *
 * The figure is set at 200, the hero-figure weight, because a figure standing
 * alone at 24px is a display object: the same cut the hero and the Recent wins
 * tiles use, so every standalone figure in the product is one weight. It was
 * 300 here, 200 in RecentWins, 500 in the upgrade modal and 700 on the pack
 * prices, four weights for one object.
 *
 * Figures sit in `text-foreground`. There was a `brand` prop that painted the
 * reachable rate violet, argued on the grounds that it is the number a campaign
 * gets planned against; but violet marks an affordance and a rate nobody can
 * act on is not one. The doc names the hit rate as a measured fact, and the
 * `attested` dot is the mark for that. A caller that wants the figure itself
 * green because it is an outcome (a reachable count, a delivered link) sets
 * `text-attested` on its own markup; nothing here paints a number a colour.
 *
 * `dt` before `dd` in the DOM, because a definition list pairs a term with what
 * follows it. `flex-col-reverse` puts the figure on top visually without lying
 * about the structure.
 */
export function Figure({
  value,
  label,
  attested,
}: {
  value: string;
  label: string;
  /** The green dot: this figure is a measured fact, not an estimate. */
  attested?: boolean;
}) {
  return (
    <div className="flex flex-col-reverse">
      <dt className="mt-1 text-xs text-muted-foreground">{label}</dt>
      <dd className="ml-0 flex items-center gap-2 text-2xl font-extralight tabular-nums tracking-[var(--tracking-title)] text-foreground">
        {attested && (
          <span
            className="h-1.5 w-1.5 flex-none rounded-full bg-attested"
            aria-hidden
          />
        )}
        {value}
      </dd>
    </div>
  );
}
