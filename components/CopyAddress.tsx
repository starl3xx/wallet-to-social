'use client';

import { useState } from 'react';
import { Check, Copy } from '@phosphor-icons/react';

import { Button } from '@/components/ui/button';

/**
 * The machine row's address: truncated mono text with its copy control.
 *
 * A contract address is machine data occupying its own element, so it is mono
 * at 12px; the full value rides in `title` and in the copy payload, so
 * truncation costs nothing. The button is compact-tier (the ladder's
 * table-and-dense-row step) because it sits in a metadata row, not a control
 * row. The label swap is the button's own feedback: colour and glyph change,
 * never size, so the row does not shift.
 */
export function CopyAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  const short = `${address.slice(0, 6)}…${address.slice(-4)}`;

  return (
    <span className="inline-flex items-center gap-1">
      <span className="font-mono text-xs text-muted-foreground" title={address}>
        {short}
      </span>
      <Button
        variant="ghost"
        size="icon-compact"
        className="text-muted-foreground"
        aria-label={copied ? 'Copied' : 'Copy contract address'}
        title="Copy contract address"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(address);
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          } catch {
            /* Clipboard can be refused; the address is visible and selectable. */
          }
        }}
      >
        {copied ? (
          <Check className="h-4 w-4 text-attested" aria-hidden />
        ) : (
          <Copy className="h-4 w-4" aria-hidden />
        )}
      </Button>
    </span>
  );
}
