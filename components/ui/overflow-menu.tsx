'use client';

import { useEffect, useRef, useState } from 'react';
import { DotsThree } from '@phosphor-icons/react';

/**
 * Everything past the third control in an action row.
 *
 * The results header carried up to seven buttons of equal weight in one
 * `flex-wrap`, so they ragged onto a second line and gave the same emphasis to
 * "Export CSV" and "𝕏 Share". They are not equal: one is what the lookup was
 * for, and the rest are things you might also do.
 *
 * A row of buttons never wraps. Past the third, they go here.
 */
export function OverflowMenu({
  label = 'More actions',
  children,
}: {
  label?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
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
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        title={label}
        onClick={() => setOpen((v) => !v)}
        className="transition-control flex h-10 w-10 items-center justify-center rounded-full border border-border text-muted-foreground hover:border-accent-brand hover:text-accent-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <DotsThree className="h-5 w-5" weight="bold" aria-hidden />
      </button>

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
  onClick, children, href,
}: { onClick?: () => void; children: React.ReactNode; href?: string }) {
  const cls =
    'transition-control flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left text-sm text-foreground/90 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  if (href) {
    return (
      <a role="menuitem" href={href} target="_blank" rel="noopener noreferrer" className={cls}>
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
