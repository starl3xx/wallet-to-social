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
 * 11px, as the doc specifies, and the one arbitrary size in the product. The
 * scale has no step between 12px and nothing, so `text-[11px]` is written here
 * and in Badge, the two primitives that render the uppercase label, and nowhere
 * else: a third site is a copy of a primitive, not a label. `leading-4` pins
 * the line box to the 16px that `text-xs` gave, since an arbitrary size sets
 * no line height and a label that inherits one from its parent changes height
 * with every surface it lands on.
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
        'font-mono text-[11px] leading-4 uppercase tracking-[var(--tracking-label)] text-muted-foreground',
        className
      )}
    >
      {children}
    </Tag>
  );
}
