'use client';

import { useEffect, useRef, useState } from 'react';
import { DotsThree } from '@phosphor-icons/react';
import { Slot } from '@radix-ui/react-slot';

/**
 * Everything past the third control in an action row.
 *
 * The results header carried up to seven buttons of equal weight in one
 * `flex-wrap`, so they ragged onto a second line and gave the same emphasis to
 * "Export CSV" and "𝕏 Share". They are not equal: one is what the lookup was
 * for, and the rest are things you might also do.
 *
 * A row of buttons never wraps. Past the third, they go here.
 *
 * `trigger` swaps the DotsThree button for another control, so the same menu
 * (role, Escape, outside click, aria-expanded) can open from an avatar. The
 * header's account menu was a second, hand-rolled popover with none of those,
 * built on the `fixed inset-0` click-catcher the Dialogs section bans. A Slot
 * merges the menu props onto the element passed, so the caller keeps its own
 * className, aria-label and title and this file keeps the behaviour.
 */
export function OverflowMenu({
  label = 'More actions',
  trigger,
  children,
}: {
  label?: string;
  /** A control to open the menu from, in place of the DotsThree button. */
  trigger?: React.ReactElement;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      {trigger ? (
        <Slot
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {trigger}
        </Slot>
      ) : (
        /* `border-input`, not `border-border`: this is a control's edge, and a
           control edge needs 3:1 (docs/DESIGN-LANGUAGE.md, Contrast). The
           footer's social buttons carry the same classes, so the three round
           icon controls in the product are one object. */
        <button
          type="button"
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={open}
          title={label}
          onClick={() => setOpen((v) => !v)}
          className="transition-control flex size-control items-center justify-center rounded-full border border-input text-muted-foreground hover:border-accent-brand hover:text-accent-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <DotsThree className="h-5 w-5" weight="bold" aria-hidden />
        </button>
      )}

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-1 min-w-[13rem] rounded-lg border border-border bg-popover p-1 shadow-lg"
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/** One row in an overflow menu. Sentence case, leading icon, full-width target. */
export function MenuItem({
  onClick,
  children,
  href,
}: {
  onClick?: () => void;
  children: React.ReactNode;
  href?: string;
}) {
  const cls =
    'transition-control flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left text-sm text-foreground/90 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  if (href) {
    return (
      <a
        role="menuitem"
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={cls}
      >
        {children}
      </a>
    );
  }
  return (
    <button role="menuitem" type="button" onClick={onClick} className={cls}>
      {children}
    </button>
  );
}
