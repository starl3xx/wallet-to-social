import { cn } from '@/lib/utils';

/**
 * A badge states a fact. It is never pressable, and must never look it.
 *
 * There was no Badge primitive, so badges appeared in four shapes: rounded-full
 * in LookupHistory and ContractImportModal, rounded-md in StatsCards and
 * RecentWins, bare rounded in ResultsTable, rounded-lg in AccessBanner. One tile
 * in RecentWins held two different shapes 27px apart.
 *
 * The four-axis rule from docs/DESIGN-LANGUAGE.md is what keeps this distinct
 * from a Button: a badge is uppercase, mono, has no leading icon and has a tint
 * fill with no border. A button is sentence case, sans, has a leading icon and
 * sits in a bordered or filled pill. Sharing any two of those is how a label
 * starts reading as a control.
 *
 * `rounded-sm`, not `rounded-full`: the pill is reserved for controls, and a
 * pill-shaped badge is the single most direct way to make a fact look clickable.
 */
const TONES = {
  /** A measured fact: attested, live, or a real outcome. */
  attested: 'bg-attested-tint text-attested',
  /** Brand-adjacent, for things that are ours rather than good or bad. */
  brand: 'bg-accent-brand-tint text-accent-brand',
  /** Truncation, staleness, approaching a limit. */
  caution: 'bg-caution-tint text-caution',
  /** Everything else, which is most of them. */
  muted: 'bg-muted text-muted-foreground',
} as const;

export function Badge({
  children,
  tone = 'muted',
  className,
  title,
}: {
  children: React.ReactNode;
  tone?: keyof typeof TONES;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex max-w-[12ch] items-center overflow-hidden rounded-sm px-1.5 py-0.5',
        'font-mono text-xs uppercase tracking-[0.14em]',
        TONES[tone],
        className
      )}
    >
      {/* truncate goes on the inner span, not the container. On an inline-flex
          box the text sits in anonymous flex items, so text-overflow has nothing
          to apply to and the string clips with no ellipsis: cut off, with no sign
          it was cut off. */}
      <span className="truncate">{children}</span>
    </span>
  );
}
