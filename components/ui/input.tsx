import * as React from 'react';

import { cn } from '@/lib/utils';
import { FOCUS_RING } from '@/components/ui/button';

/**
 * The one text-field edge, shared by Input and Textarea.
 *
 * `border-input`, not bare `border`: globals.css resolves a bare `border` to
 * `--border`, the decorative hairline, which is 1.26:1 in light mode. A control
 * needs 3:1 on its edge (docs/DESIGN-LANGUAGE.md, Contrast), and `--input` is
 * the token that clears it. Three raw textareas each drew the hairline because
 * there was nothing to reach for; this string is what they reach for now.
 *
 * The fill is the surface the field sits on. It rested on `bg-muted/30` in dark
 * mode, a wash whose contrast changed with whatever was behind it, which is the
 * same defect the control boundary was cured of. The edge was solved against
 * the worst surface each theme puts a control on, so it carries the field alone.
 *
 * `transition-control`, not `transition-[color,box-shadow]`: the ring is drawn
 * with box-shadow, and a ring that fades in is a ring that is not there yet.
 */
const FIELD =
  'placeholder:text-muted-foreground border-input w-full min-w-0 rounded-lg border bg-transparent px-3 text-base transition-control disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm';
/**
 * Focus is the shared ring from Button, so a field and the button beside it
 * light up the same way. The field used to turn its edge brand and add a 2px
 * ring at 20%, a second treatment that only worked on a white field.
 *
 * Invalid is the edge only. It used to recolour the ring as well, so an
 * invalid field in focus drew a red ring at 20% or 40% by theme: a third ring.
 * The red edge says invalid; the one ring says focused; both can be true.
 */
const FIELD_INVALID = 'aria-invalid:border-destructive';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        FIELD,
        'file:text-foreground h-control py-1 file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium',
        FOCUS_RING,
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
        FOCUS_RING,
        FIELD_INVALID,
        className
      )}
      {...props}
    />
  );
}

export { Input, Textarea };
