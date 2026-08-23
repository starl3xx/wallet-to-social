'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  UploadSimple as Upload,
  ClipboardText as ClipboardList,
  Polygon as Boxes,
  Lock,
} from '@phosphor-icons/react';
import { Button, FOCUS_RING } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface InputMethodPickerProps {
  onFileLoaded: (file: File) => void;
  onPasteClick: () => void;
  pasteActive: boolean;
  onContractClick: () => void;
  /** Contract import needs credits. Accounts without any see it locked rather than hidden. */
  contractLocked: boolean;
  disabled?: boolean;
}

/**
 * The three ways to get wallets into the product, presented as peers.
 *
 * They used to be a large dashed dropzone, an underlined text link and a small
 * outline button, which read as one real action plus two afterthoughts: you had
 * to read the page to discover that pasting and contract import existed at all.
 * Equal cards make the choice legible at a glance.
 *
 * Shrinking the dropzone would normally cost the drag-and-drop affordance, so
 * the drop target is promoted to the whole window instead. Dropping a file
 * anywhere on the page now works, which is a larger target than the old box.
 */
export function InputMethodPicker({
  onFileLoaded,
  onPasteClick,
  pasteActive,
  onContractClick,
  contractLocked,
  disabled,
}: InputMethodPickerProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // dragenter/dragleave fire for every child element the cursor crosses, so a
  // plain boolean flickers. Counting enters and leaves is the standard fix.
  const dragDepth = useRef(0);

  const handleFile = useCallback(
    (file: File) => {
      setError(null);
      const ext = file.name.toLowerCase().split('.').pop();
      if (ext !== 'csv' && ext !== 'xlsx') {
        setError('Please upload a CSV or Excel (.xlsx) file');
        return;
      }
      setFileName(file.name);
      onFileLoaded(file);
    },
    [onFileLoaded]
  );

  // Window-level drag and drop. Without preventDefault on dragover the browser
  // navigates to the dropped file instead of handing it to us.
  useEffect(() => {
    if (disabled) return;

    /**
     * Stand down while any dialog is open, or a file dropped onto that dialog
     * is captured by the page behind it: dropping on "add addresses" would
     * start a brand new lookup instead of adding to the existing one, and the
     * drop overlay would cover the modal.
     *
     * Asked of the DOM rather than enumerated as props. Dialogs open from
     * places this component cannot see (the access banner, lookup history),
     * and an enumerated list is only correct until the next dialog is added.
     * Radix renders open content as [role=dialog][data-state=open].
     */
    const dialogOpen = () =>
      document.querySelector(
        '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]'
      ) !== null;

    const isFileDrag = (e: DragEvent) =>
      e.dataTransfer?.types?.includes('Files');

    // preventDefault runs for every file drag, dialog open or not. Skipping it
    // hands the drop back to the browser, which navigates to the file and
    // destroys whatever was in progress on the page: strictly worse than the
    // capture it was meant to avoid. Yielding to a dialog means declining to
    // act on the file, not declining to suppress the browser.
    const onDragEnter = (e: DragEvent) => {
      if (!isFileDrag(e) || dialogOpen()) return;
      dragDepth.current += 1;
      setIsDragging(true);
    };
    const onDragOver = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
    };
    const onDragLeave = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setIsDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      // Clear the overlay even when yielding, or a drag that began before a
      // dialog opened would leave it stuck on screen
      dragDepth.current = 0;
      setIsDragging(false);
      // A dialog with its own dropzone has already handled this on the way up;
      // one without simply does nothing, which is the intended outcome
      if (dialogOpen()) return;
      const file = e.dataTransfer?.files?.[0];
      if (file) handleFile(file);
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [handleFile, disabled]);

  /**
   * One primary action, two alternates. Three equal boxes gave the same weight to
   * three things people do in very different proportions, and buried the most
   * welcoming fact about the product: the whole page is a drop target. The primary
   * says so with a dashed edge rather than mentioning it in a caption.
   *
   * `p-4`: 20px is not a spacing step, and the 44px disc already sets the
   * height, so the step down from p-5 costs the target nothing.
   */
  const dropBase =
    'group flex w-full items-center gap-4 rounded-lg border border-dashed border-accent-brand ' +
    'bg-accent-brand-tint p-4 text-left transition-control ' +
    /* The shared ring, not four fifths of it hand-copied. This string carried
       its own and dropped `ring-offset-background`, and Tailwind's initial
       `--tw-ring-offset-color` is `#fff`, so in dark mode the page's primary
       action drew a 2px white gap between itself and the violet ring. "The one
       focus ring" (components/ui/button.tsx) was broken in the one place it is
       most seen. */
    `${FOCUS_RING} ` +
    (disabled
      ? 'opacity-50 pointer-events-none '
      : 'hover:border-accent-brand-hover ');

  /**
   * The alternates are Button's outline variant, not a hand-rolled pill. The
   * hand-rolled one drew its edge in `--border`, which is decorative and read at
   * 1.26:1 in light, so both pills were barely outlined. The variant carries
   * `border-input` (the 3:1 control edge), `h-control`, the icon gap and the
   * focus ring. Only what is specific to this row goes through className: the
   * resting text tone and the brand hover, and `cn` lets those win over the
   * variant's own.
   *
   * **`sm:flex-1`, never a bare `flex-1`.** `flex-1` is `flex: 1 1 0%`, and on a
   * flex item the basis supplies the main size, so `height` is not consulted.
   * Below `sm` this row is `flex-col`, which makes the main axis vertical: the
   * 0% basis replaced `h-control`, the container had no free space to grow into,
   * and `min-height: auto` dropped each pill to its content height. Both
   * alternates rendered **22px** on every phone width and 34px at `sm` and
   * above, which is why no desktop review ever saw it. They were the shortest
   * controls on the page, sitting directly under a 44px disc, and they were what
   * "these don't look like buttons" was pointing at.
   *
   * The width is unaffected either way: a column flex container stretches its
   * items, so the pills are full-bleed below `sm` with or without the class.
   *
   * `/75` is the wash the design language names (DESIGN-LANGUAGE.md, Shape:
   * "Unselected sits at `text-foreground/75`"). `/80` was a second unnamed one.
   */
  const altClass =
    'text-foreground/75 hover:border-accent-brand hover:text-accent-brand sm:flex-1';

  return (
    <div>
      {/* The drag overlay takes the same scrim the dialogs use
          (components/ui/modal.tsx), so a drag over the page and an open dialog
          dim it identically. It was a `bg-background/80` wash, a second scrim. */}
      {isDragging && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="rounded-lg border-2 border-dashed border-accent-brand bg-background px-8 py-6 text-center">
            <Upload
              className="mx-auto h-10 w-10 text-accent-brand"
              aria-hidden
            />
            <p className="mt-3 text-lg font-medium">Drop it anywhere</p>
            <p className="text-sm text-muted-foreground">
              CSV or Excel (.xlsx)
            </p>
          </div>
        </div>
      )}

      {/* Primary: the drop target, which is also the page-wide gesture. */}
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className={dropBase}
        aria-label="Upload a CSV or Excel file, or drop one anywhere on this page"
      >
        <span className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-accent-brand text-accent-brand-foreground">
          <Upload className="h-5 w-5" aria-hidden weight="bold" />
        </span>
        <span className="min-w-0">
          <span className="block font-semibold">
            Drop a file, or click to browse
          </span>
          <span className="block text-sm text-muted-foreground">
            CSV or Excel &middot; drag it anywhere on this page
          </span>
          {fileName && (
            <span className="mt-1 block max-w-full truncate font-mono text-xs text-foreground">
              {fileName}
            </span>
          )}
        </span>
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.xlsx"
        className="hidden"
        disabled={disabled}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          // Reset so picking the same file twice still fires onChange
          e.target.value = '';
        }}
      />

      {/* Alternates: same actions, demoted to their real frequency. */}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          variant="outline"
          onClick={onPasteClick}
          disabled={disabled}
          aria-expanded={pasteActive}
          className={cn(
            altClass,
            pasteActive && 'border-accent-brand text-accent-brand'
          )}
        >
          <ClipboardList className="h-4 w-4" aria-hidden />
          Paste a list
        </Button>

        <Button
          type="button"
          variant="outline"
          onClick={onContractClick}
          disabled={disabled}
          className={altClass}
          aria-label={
            contractLocked
              ? 'Import from a contract address (needs credits)'
              : 'Import from a contract address'
          }
        >
          {contractLocked ? (
            <Lock className="h-4 w-4" aria-hidden />
          ) : (
            <Boxes className="h-4 w-4" aria-hidden />
          )}
          Import from a contract
          {/* The lock is the control's leading icon; the fact that credits
              unlock it is a Badge, not a second copy of Badge's classes. */}
          {contractLocked && <Badge>Credits</Badge>}
        </Button>
      </div>

      {error && (
        <p className="mt-3 text-center text-sm text-destructive">{error}</p>
      )}
    </div>
  );
}
