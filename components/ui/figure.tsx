import { cn } from '@/lib/utils';

/**
 * One proof figure with its caption.
 *
 * Colour does the sorting, and only two of the four are coloured. The reachable
 * rate takes brand because it is the number a campaign gets planned against;
 * coverage takes a green mark because it is the measured claim. The other two
 * are plain, which is what makes the two that are not stand out.
 *
 * `dt` before `dd` in the DOM, because a definition list pairs a term with what
 * follows it. `flex-col-reverse` puts the figure on top visually without lying
 * about the structure.
 */
export function Figure({
  value,
  label,
  brand,
  attested,
}: {
  value: string;
  label: string;
  brand?: boolean;
  attested?: boolean;
}) {
  return (
    <div className="flex flex-col-reverse">
      <dt className="mt-1 text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'ml-0 flex items-center gap-2 text-2xl font-light tabular-nums tracking-[var(--tracking-title)]',
          brand && 'text-accent-brand'
        )}
      >
        {attested && (
          <span className="h-1.5 w-1.5 flex-none rounded-full bg-attested" aria-hidden />
        )}
        {value}
      </dd>
    </div>
  );
}
