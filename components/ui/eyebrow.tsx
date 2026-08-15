import { cn } from '@/lib/utils';

/**
 * The one uppercase label in the product.
 *
 * Before this existed the same idea was written five different ways:
 * text-xs/font-medium/tracking-wider in admin, text-sm/font-medium/tracking-wide
 * in RecentWins, text-[10px]/font-medium/tracking-wider in ProgressBar,
 * text-[10px]/font-semibold/tracking-wide in InputMethodPicker. Four sizes, two
 * weights, two tracking values, and none of them mono.
 *
 * The string is now in one place, which is the only way a value stays single.
 * `uppercase` without `font-mono` is a violation the CI guard catches, so this
 * component is the way to satisfy it rather than a suggestion.
 *
 * No `use client`: it renders text, and server components need it too.
 */
export function Eyebrow({
  children,
  className,
  as: Tag = 'div',
}: {
  children: React.ReactNode;
  className?: string;
  /**
   * Use a heading tag when the eyebrow genuinely labels a section, so the
   * document outline matches what a reader sees. Default is a div, because most
   * eyebrows label a control or a tile rather than a region.
   */
  as?: 'div' | 'span' | 'h2' | 'h3';
}) {
  return (
    <Tag
      className={cn(
        'font-mono text-xs uppercase tracking-[0.14em] text-muted-foreground',
        className
      )}
    >
      {children}
    </Tag>
  );
}
