'use client';

import { Warning } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

/**
 * The one inline error: a 14px destructive line with the 16px warning glyph
 * leading it, announced as an alert when it appears.
 *
 * The dialogs had four: a tinted box with the glyph (ContractImportModal,
 * ApiKeysModal), a bare `text-sm` line (AuthModal, UpgradeModal), a bare
 * `text-xs` line (the contract address check) and a `text-sm` line with a 12px
 * glyph the icon scale does not have (FarcasterDMModal). An error under a field
 * and an error after a request are the same statement at the same scale, so
 * they take the same shape.
 *
 * No box. The tint tokens mark a banner that states an outcome (a failed job
 * tile, a caution panel); an error beside the control that caused it is a
 * line of text, and a box here made the request error heavier than the field
 * error for no reason the layout could state.
 *
 * The glyph sits in a `h-5` flex box rather than on an `mt-0.5` nudge: `h-5`
 * is the line box of `text-sm`, so the glyph centres on the first line of a
 * message that wraps, and 2px is not on the spacing scale.
 *
 * `role="alert"`, so assistive tech announces the message without the person
 * having to find it. The element renders only while there is an error, which
 * is the condition the role is designed for.
 *
 * `fade-in-fast`: the line arrives over --d-fast rather than as a hard cut.
 * Opacity only, and the alert role announces it regardless, so the fade
 * delays nothing a person is waiting to know.
 */
export function InlineError({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      role="alert"
      className={cn(
        'fade-in-fast flex items-start gap-2 text-sm text-destructive',
        className
      )}
    >
      <span className="flex h-5 flex-none items-center" aria-hidden>
        <Warning className="h-4 w-4" />
      </span>
      <span className="min-w-0">{children}</span>
    </p>
  );
}
