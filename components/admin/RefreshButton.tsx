'use client';

import { Button } from '@/components/ui/button';
import { ArrowsClockwise, CircleNotch as Loader2 } from '@phosphor-icons/react';

/**
 * The one refresh control. A ghost icon button at the control size, named
 * "Refresh" for a reader who cannot see the glyph, and showing the spinner in
 * place of the arrows while the fetch is in flight.
 *
 * It appeared in four forms: ghost `size="sm"` with and without the sr-only
 * name, outline `size="sm"`, and outline with the word "Refresh" beside the
 * icon. `size="sm"` on an icon-only button also gave a 34 by 44 pill rather
 * than the square every other icon control is; `size="icon"` is that square.
 */
export function RefreshButton({
  onClick,
  loading,
}: {
  onClick: () => void;
  loading?: boolean;
}) {
  return (
    <Button variant="ghost" size="icon" onClick={onClick} disabled={loading}>
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      ) : (
        <ArrowsClockwise className="h-4 w-4" aria-hidden />
      )}
      <span className="sr-only">Refresh</span>
    </Button>
  );
}
