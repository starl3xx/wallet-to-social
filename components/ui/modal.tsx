'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from '@phosphor-icons/react';
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
      'fixed inset-0 z-50 bg-black/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
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
        'fixed left-[50%] top-[50%] z-50 flex w-full max-w-lg translate-x-[-50%] translate-y-[-50%] flex-col border bg-background shadow-lg duration-150 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-98 data-[state=open]:zoom-in-98 sm:rounded-lg max-h-[calc(100dvh-2rem)]',
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
      */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
        {children}
      </div>
      {/* `flex-none` so it keeps its height while the body above gives way, and
          a top hairline so the row reads as separate from content that has
          scrolled up behind it rather than as the next thing in the list. */}
      {footer && (
        <div className="flex-none border-t border-border px-6 py-4">{footer}</div>
      )}
      <DialogPrimitive.Close className="absolute right-4 top-4 z-10 rounded-sm bg-background p-1 opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
        <X className="h-4 w-4" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </ModalPortal>
));
ModalContent.displayName = DialogPrimitive.Content.displayName;

const ModalHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'flex flex-col space-y-1.5 text-center sm:text-left',
      className
    )}
    {...props}
  />
);
ModalHeader.displayName = 'ModalHeader';

const ModalFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      // `gap`, not `space-x`. `space-x` is margin on every child but the first,
      // so it stacks with any gap the caller adds and disappears entirely when
      // the row reverses. One mechanism owns the spacing.
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
