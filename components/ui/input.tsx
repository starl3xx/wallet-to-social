import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * The one text-field edge, shared by Input and Textarea.
 *
 * `border-input`, not bare `border`: globals.css resolves a bare `border` to
 * `--border`, the decorative hairline, which is 1.26:1 in light mode. A control
 * needs 3:1 on its edge (docs/DESIGN-LANGUAGE.md, Contrast), and `--input` is
 * the token that clears it. Three raw textareas each drew the hairline because
 * there was nothing to reach for; this string is what they reach for now.
 */
const FIELD =
  'placeholder:text-muted-foreground dark:bg-muted/30 border-input w-full min-w-0 rounded-lg border bg-transparent px-3 text-base transition-[color,box-shadow] outline-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm';
const FIELD_FOCUS =
  'focus-visible:border-accent-brand focus-visible:ring-2 focus-visible:ring-accent-brand/20';
const FIELD_INVALID =
  'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        FIELD,
        'file:text-foreground h-control py-1 file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium',
        FIELD_FOCUS,
        FIELD_INVALID,
        className
      )}
      {...props}
    />
  );
}

/**
 * Input's class string minus `h-control`. Height comes from `rows`, and the
 * corner handle is off because every caller fixes its own height and a field
 * that can be dragged taller pushes the buttons beneath it.
 *
 * `py-2` where Input has `py-1`: the input's 4px is a consequence of its fixed
 * 34px height centring one line, and a multi-line field with no fixed height
 * needs the next spacing step or its first line sits on the edge.
 */
function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        FIELD,
        'resize-none py-2',
        FIELD_FOCUS,
        FIELD_INVALID,
        className
      )}
      {...props}
    />
  );
}

export { Input, Textarea };
