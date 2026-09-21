'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
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
 * `trigger` swaps the DotsThree button for another control, so the same panel
 * (Escape, outside click, aria-expanded) can open from an avatar. The header's
 * account menu was a second, hand-rolled popover with none of those, built on
 * the `fixed inset-0` click-catcher the Dialogs section bans. A Slot merges the
 * props onto the element passed, so the caller keeps its own className,
 * aria-label and title and this file keeps the behaviour.
 *
 * ## A disclosure, not a `role="menu"`
 *
 * It used to say `role="menu"`, with `role="menuitem"` on every row, and that
 * was a promise the component does not keep. `menu` is not a label for "things
 * in a dropdown": it commits to the menu keyboard contract, which is focus
 * moved into the menu on open, Up and Down walking the items with roving
 * `tabindex`, Home and End, first-letter typeahead, and focus returned to the
 * trigger on close. None of that is implemented here.
 *
 * The cost of claiming it anyway is not a missing nicety. A screen reader
 * switches to application mode inside a `menu`, which is what suppresses its
 * own reading keys so the menu's arrows can work: it hands the arrow keys to a
 * handler that does not exist. So the role took away the navigation the plain
 * buttons had and put nothing in its place, and it did that only for the users
 * who depend on it. `role="menuitem"` also re-labels each row, so a link in the
 * list stopped announcing as a link and stopped appearing in the links list.
 *
 * What this actually is, is a disclosure: a button whose `aria-expanded` says
 * whether a group of ordinary controls is showing. That contract Tab already
 * satisfies, with no roving focus to write, so the two rules below are the
 * whole of it: `aria-controls` names the group, and closing on Escape or on an
 * activation hands focus back to the trigger rather than dropping it on
 * `<body>`, where a keyboard user restarts from the top of the document.
 *
 * If a real menu is ever wanted, the answer is a Radix dropdown, not these
 * attributes: the contract is about 200 lines and every line of it is a case
 * somebody hit.
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
  const panelId = useId();

  /**
   * The trigger is the wrapper's first element child in both branches, by
   * construction: either the `Slot` the caller's control renders through, or
   * the DotsThree button below. Reading it off the DOM rather than holding a
   * second ref is what keeps the `trigger` prop working, since a caller's
   * element is not obliged to forward a ref and a silently null ref would fail
   * as "focus just did not return", which nobody reports.
   */
  const focusTrigger = () => {
    const el = ref.current?.firstElementChild;
    if (el instanceof HTMLElement) el.focus();
  };

  /**
   * Only rescue focus that this component is about to destroy.
   *
   * Nothing traps Tab here (a disclosure should not), so a keyboard user can
   * walk straight out of an open panel and carry on down the page. Escape from
   * there is still a legitimate "close that thing", and unconditionally calling
   * `focusTrigger` would answer it by dragging them backwards to a control they
   * had already left. Returning focus is only correct when focus is inside the
   * thing being unmounted.
   */
  const focusIsInside = () =>
    Boolean(ref.current?.contains(document.activeElement));

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Read before the state change: after `setOpen(false)` the panel is on
      // its way out and `document.activeElement` no longer answers the
      // question being asked.
      const inside = focusIsInside();
      setOpen(false);
      // Escape is a keyboard gesture, so the keyboard has to end up somewhere
      // it can carry on from. Without this, dismissing from inside the panel
      // unmounts the focused element and focus falls to `<body>`.
      if (inside) focusTrigger();
    };
    const onClick = (e: MouseEvent) => {
      // No focus move here, unlike Escape: a click outside is a deliberate move
      // to somewhere else on the page, and yanking focus back to the trigger
      // would undo it.
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
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
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
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          title={label}
          onClick={() => setOpen((v) => !v)}
          className="transition-control flex size-control items-center justify-center rounded-full border border-input text-muted-foreground hover:border-accent-brand hover:bg-fill-subtle hover:text-accent-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <DotsThree className="h-5 w-5" weight="bold" aria-hidden />
        </button>
      )}

      {open && (
        <div
          id={panelId}
          // `group` rather than nothing, so the label below is announced: an
          // unroled div drops `aria-label` on the floor. It is the one role
          // here that describes what this is instead of promising behaviour.
          role="group"
          aria-label={label}
          className="absolute right-0 top-full z-50 mt-1 min-w-[13rem] rounded-lg border border-border bg-popover p-1 shadow-float"
          onClick={() => {
            setOpen(false);
            // Activating a row unmounts the row. Same reasoning as Escape: the
            // element that had focus is gone, so name where focus goes next.
            // A row that navigates takes focus with it and this is moot.
            focusTrigger();
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * One row. Sentence case, leading icon, full-width target.
 *
 * A link stays a link and a button stays a button. `role="menuitem"` on both
 * flattened them into one thing, which cost the link its "link" announcement
 * and its place in the reader's links list, and bought nothing: see the panel's
 * note above for why the role was a promise this component does not keep.
 */
export function MenuItem({
  onClick,
  children,
  href,
  external,
}: {
  onClick?: () => void;
  children: React.ReactNode;
  href?: string;
  /**
   * Leave the site in a new tab. Opt-in, because the default was the opposite
   * and that is a surprising thing to do to an internal route: an account page
   * opened from the account menu should replace the page you are on, not
   * strand a second tab behind it. Nothing passed `href` until the dashboard
   * did, so no caller relied on the old behavior.
   */
  external?: boolean;
}) {
  const cls =
    'transition-control flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-sm text-foreground/90 hover:bg-fill-subtle hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  if (href) {
    if (external) {
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={cls}
        >
          {children}
        </a>
      );
    }
    // An internal route goes through the router, so the menu does not cost a
    // full document load. It stays an anchor, so it keeps a link's keyboard
    // and screen-reader behavior and can still be opened in a new tab by
    // someone who wants one.
    return (
      <Link href={href} className={cls}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls}>
      {children}
    </button>
  );
}
