'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const Modal = DialogPrimitive.Root;

const ModalTrigger = DialogPrimitive.Trigger;

const ModalPortal = DialogPrimitive.Portal;

const ModalClose = DialogPrimitive.Close;

const ModalOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      // The same clock as the panel: 220ms in on the arriving curve, 120ms
      // out. Without a duration, tw-animate falls back to 150ms, which is not
      // one of the three.
      'fixed inset-0 z-50 bg-black/50 backdrop-blur-sm ease-[var(--ease-out-soft)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-[var(--duration-base)] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-[var(--duration-fast)]',
      className
    )}
    {...props}
  />
));
ModalOverlay.displayName = DialogPrimitive.Overlay.displayName;

const ModalContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    /**
     * An action row held below the scrolling body, so it stays reachable however
     * tall the content gets. Put a `ModalFooter` in it.
     *
     * It is a prop rather than a child because a child cannot escape the
     * scroller it is inside, and that is exactly the bug this replaces:
     * `ModalFooter` existed, sat inside the body, and therefore pinned nothing.
     * All six dialogs declined to use it, which is the tell. A slot nobody
     * reaches for is usually a slot that does not do what its name promises.
     *
     * Optional, and most dialogs are right not to pass it: a body that scrolls
     * as one block is the better default, and a footer costs vertical space on
     * the screens that have least of it.
     */
    footer?: React.ReactNode;
  }
>(({ className, children, footer, ...props }, ref) => (
  <ModalPortal>
    <ModalOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        // `rounded-lg` at every width and a 1rem inset on every side. shadcn's
        // default was `w-full sm:rounded-lg`, so below `sm` the panel went
        // edge to edge with square corners while keeping its 1rem vertical
        // inset from the max-height, and read as a half-finished sheet. The
        // panel is `--r-container` like every other container, and
        // `calc(100%-2rem)` gives the horizontal inset the vertical one
        // already had; 32px is on the spacing scale.
        //
        // Motion off the paste too. shadcn ran open and close at `duration-150`,
        // a value the three durations do not include, on the browser's `ease`.
        // A dialog arriving is a state change, so it enters over `--d-base`
        // (220ms) on the arriving curve and fades plus scales from 0.97, the
        // one scale the product uses; it leaves over `--d-fast` (120ms),
        // because exits run shorter than entrances. `duration-*` sets the
        // `--tw-duration` that tw-animate reads, and the reduced-motion block
        // in globals.css collapses the animation to nothing.
        'fixed left-[50%] top-[50%] z-50 flex w-[calc(100%-2rem)] max-w-lg translate-x-[-50%] translate-y-[-50%] flex-col rounded-lg border bg-background shadow-lg ease-[var(--ease-out-soft)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-97 data-[state=open]:duration-[var(--duration-base)] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-97 data-[state=closed]:duration-[var(--duration-fast)] max-h-[calc(100dvh-2rem)]',
        className
      )}
      {...props}
    >
      {/*
        This is a flex column, and it has to be. It was a grid, and `min-h-0` was
        added to the body to let it shrink, which is necessary and on its own does
        nothing: an implicit grid row is `auto`, meaning max-content, so the row
        kept growing past the container's max-height and the body simply filled
        the row it was given. `overflow-y-auto` never received a box smaller than
        its content, so it never clipped and never showed a scrollbar, and the
        upgrade modal went on spilling its two buttons below the panel after the
        fix that was supposed to stop it.

        `flex-1` is `flex: 1 1 0%`, which sets the basis to zero and grows into
        the space that is actually there. Paired with `min-h-0` the body can
        finally be smaller than its content, which is the whole mechanism.

        `100dvh` rather than `100vh`: on mobile browsers `vh` is the tallest the
        viewport ever gets, so a modal measured in it hides behind the address
        bar exactly when the bar is showing.

        A modal that needs its actions to stay on screen does not need a prop for
        it. Because this box now has a definite height, a child marked
        `min-h-0 flex-1` resolves against it, and that child can scroll its own
        inner region while its buttons stay put. Nothing here scrolls twice: the
        inner region absorbs the overflow, so this one has none left to show. See
        `UpgradeModal`, where the two buttons belong to two different cards and
        so could never have shared one pinned footer.

        `overscroll-contain`: on touch, reaching the end of this scroller must
        not chain into scrolling the page behind the overlay.
      */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain p-6">
        {children}
      </div>
      {/* `flex-none` so it keeps its height while the body above gives way, and
          a top hairline so the row reads as separate from content that has
          scrolled up behind it rather than as the next thing in the list. */}
      {footer && (
        <div className="flex-none border-t border-border px-6 py-4">
          {footer}
        </div>
      )}
      {/* The close is a ghost icon Button, so it is the 34px control every
          other icon control resolves to, with the one focus ring, the press
          and `transition-control`. shadcn's paste was a 24px `rounded-sm`
          target that hovered by opacity, drew its own `focus:` ring and
          painted `bg-accent` while open: four treatments no other control
          shares, and a hit target below the control height.

          `right-4 top-4`, against the body's `p-6`: the 16px glyph sits 9px
          inside a 34px box, so its ink starts 25px from the panel edge, one
          pixel inside the text column and level with the title's 18px line,
          while the hit area extends past both. Named by `aria-label`: an
          icon-only control has no text for assistive tech to read. */}
      <Button
        asChild
        variant="ghost"
        size="icon"
        className="absolute right-4 top-4 z-10 text-muted-foreground"
      >
        <DialogPrimitive.Close aria-label="Close">
          <X className="h-4 w-4" />
        </DialogPrimitive.Close>
      </Button>
    </DialogPrimitive.Content>
  </ModalPortal>
));
ModalContent.displayName = DialogPrimitive.Content.displayName;

/**
 * Left-aligned at every width. shadcn ships `text-center sm:text-left`, which
 * nothing here chose: it centred "Sign in" on a phone and left-aligned it on a
 * desktop, two treatments for one title. A dialog that wants a centred moment
 * says so on its own header.
 *
 * `pr-8` keeps the title and description clear of the close control, which
 * is absolutely placed over the body's top-right corner: the 34px box spans
 * 16px to 50px from the panel's edge, and the text column would otherwise
 * run to 24px, so a long description wrapped under the X.
 */
const ModalHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('flex flex-col space-y-1.5 pr-8 text-left', className)}
    {...props}
  />
);
ModalHeader.displayName = 'ModalHeader';

/**
 * The one layout for a dialog's action row, wherever the row sits.
 *
 * Natural-width buttons, one filled primary at the right, outline alternates
 * to its left, stacking full-width below `sm` with the primary on top. Put the
 * primary last in the DOM: `flex-col-reverse` is what lifts it to the top of
 * the stack on a phone, and `justify-end` is what puts it at the right on a
 * desktop, so one source order serves both.
 *
 * Six dialogs had four layouts for this row: equal-width siblings, a
 * `justify-between` pair, a centred cluster, and a full-width stack. Every
 * action row now renders this, inline in the body for a short step and
 * through `ModalContent`'s `footer` prop for a tall step whose actions are the
 * reason it exists (the contract import preview). The slot decides whether
 * the row pins; this decides what it looks like.
 *
 * `gap`, not `space-x`. `space-x` is margin on every child but the first, so
 * it stacks with any gap the caller adds and disappears entirely when the row
 * reverses. One mechanism owns the spacing.
 */
const ModalFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'flex flex-col-reverse gap-2 sm:flex-row sm:justify-end',
      className
    )}
    {...props}
  />
);
ModalFooter.displayName = 'ModalFooter';

const ModalTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      'text-lg font-semibold leading-none tracking-[var(--tracking-lead)]',
      className
    )}
    {...props}
  />
));
ModalTitle.displayName = DialogPrimitive.Title.displayName;

const ModalDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
));
ModalDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Modal,
  ModalPortal,
  ModalOverlay,
  ModalTrigger,
  ModalClose,
  ModalContent,
  ModalHeader,
  ModalFooter,
  ModalTitle,
  ModalDescription,
};
