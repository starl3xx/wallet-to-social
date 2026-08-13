'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Upload, ClipboardList, Boxes, Lock } from 'lucide-react';

interface InputMethodPickerProps {
  onFileLoaded: (file: File) => void;
  onPasteClick: () => void;
  pasteActive: boolean;
  onContractClick: () => void;
  /** Contract import is Pro and Unlimited. Free accounts see it locked rather than hidden. */
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

    const isFileDrag = (e: DragEvent) => e.dataTransfer?.types?.includes('Files');

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

  const cardBase =
    'group relative flex flex-col items-center text-center gap-2 rounded-lg border p-6 transition-colors ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ' +
    (disabled ? 'opacity-50 pointer-events-none ' : 'hover:border-foreground/30 hover:bg-muted/40 ');

  return (
    <div>
      {isDragging && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm pointer-events-none">
          <div className="rounded-lg border-2 border-dashed border-primary bg-background px-8 py-6 text-center">
            <Upload className="mx-auto h-10 w-10 text-primary" aria-hidden />
            <p className="mt-3 text-lg font-medium">Drop it anywhere</p>
            <p className="text-sm text-muted-foreground">CSV or Excel (.xlsx)</p>
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        {/* 1. Upload */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className={cardBase}
          aria-label="Upload a CSV or Excel file"
        >
          <Upload className="h-6 w-6 text-muted-foreground" aria-hidden />
          <span className="font-medium">Upload a file</span>
          <span className="text-sm text-muted-foreground">
            CSV or Excel, or drag it anywhere on this page
          </span>
          {fileName && (
            <span className="mt-1 max-w-full truncate text-xs font-medium text-foreground">
              {fileName}
            </span>
          )}
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

        {/* 2. Paste */}
        <button
          type="button"
          onClick={onPasteClick}
          aria-expanded={pasteActive}
          className={`${cardBase} ${pasteActive ? 'border-foreground/40 bg-muted/40' : ''}`}
        >
          <ClipboardList className="h-6 w-6 text-muted-foreground" aria-hidden />
          <span className="font-medium">Paste a list</span>
          <span className="text-sm text-muted-foreground">
            Any format, we&rsquo;ll find the addresses
          </span>
        </button>

        {/* 3. Contract import */}
        <button
          type="button"
          onClick={onContractClick}
          className={cardBase}
          aria-label={
            contractLocked
              ? 'Import from a contract address (available on Pro and Unlimited)'
              : 'Import from a contract address'
          }
        >
          {contractLocked ? (
            <Lock className="h-6 w-6 text-muted-foreground" aria-hidden />
          ) : (
            <Boxes className="h-6 w-6 text-muted-foreground" aria-hidden />
          )}
          <span className="flex items-center gap-2 font-medium">
            From a contract
            {contractLocked && (
              <span className="rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Pro
              </span>
            )}
          </span>
          <span className="text-sm text-muted-foreground">
            Every holder of an NFT collection or token
          </span>
        </button>
      </div>

      {error && <p className="mt-3 text-center text-sm text-destructive">{error}</p>}
    </div>
  );
}
