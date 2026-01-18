'use client';

import { useState, useCallback, useMemo } from 'react';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalDescription,
} from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { FileUpload } from '@/components/FileUpload';
import { parseFile } from '@/lib/file-parser';
import { Loader2, Plus, FileText } from 'lucide-react';

interface AddAddressesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lookupId: string;
  existingWallets: string[];
  onAddToLookup: (lookupId: string, newAddresses: string[]) => void;
  onCreateNewLookup: (addresses: string[]) => void;
}

// Extract all valid Ethereum addresses from text
const extractAddresses = (text: string): string[] => {
  if (!text.trim()) return [];
  const matches = text.match(/0x[a-fA-F0-9]{40}/gi) || [];
  return [...new Set(matches.map(addr => addr.toLowerCase()))];
};

export function AddAddressesModal({
  open,
  onOpenChange,
  lookupId,
  existingWallets,
  onAddToLookup,
  onCreateNewLookup,
}: AddAddressesModalProps) {
  const [pasteText, setPasteText] = useState('');
  const [newAddresses, setNewAddresses] = useState<string[]>([]);
  const [duplicateCount, setDuplicateCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'input' | 'confirm'>('input');

  const existingSet = useMemo(
    () => new Set(existingWallets.map(w => w.toLowerCase())),
    [existingWallets]
  );

  // Process addresses from paste input
  const handleProcessPaste = useCallback(() => {
    const extracted = extractAddresses(pasteText);
    const unique = extracted.filter(addr => !existingSet.has(addr));
    const dupes = extracted.length - unique.length;

    setNewAddresses(unique);
    setDuplicateCount(dupes);
    setStep('confirm');
  }, [pasteText, existingSet]);

  // Process addresses from file upload
  const handleFileLoaded = useCallback(async (file: File) => {
    setLoading(true);
    try {
      const result = await parseFile(file);
      if (result.error) {
        console.error(result.error);
        return;
      }

      const walletList = result.rows.map(r => r.wallet.toLowerCase());
      const unique = walletList.filter(addr => !existingSet.has(addr));
      const dupes = walletList.length - unique.length;

      setNewAddresses(unique);
      setDuplicateCount(dupes);
      setStep('confirm');
    } finally {
      setLoading(false);
    }
  }, [existingSet]);

  // Reset and close
  const handleClose = useCallback(() => {
    setPasteText('');
    setNewAddresses([]);
    setDuplicateCount(0);
    setStep('input');
    onOpenChange(false);
  }, [onOpenChange]);

  // Handle adding to existing lookup
  const handleAddToLookup = useCallback(() => {
    onAddToLookup(lookupId, newAddresses);
    handleClose();
  }, [lookupId, newAddresses, onAddToLookup, handleClose]);

  // Handle creating new lookup
  const handleCreateNew = useCallback(() => {
    onCreateNewLookup(newAddresses);
    handleClose();
  }, [newAddresses, onCreateNewLookup, handleClose]);

  // Go back to input step
  const handleBack = useCallback(() => {
    setStep('input');
    setNewAddresses([]);
    setDuplicateCount(0);
  }, []);

  const validCount = extractAddresses(pasteText).length;

  return (
    <Modal open={open} onOpenChange={handleClose}>
      <ModalContent className="max-w-lg">
        <ModalHeader>
          <ModalTitle>Add addresses</ModalTitle>
          <ModalDescription>
            {step === 'input'
              ? 'Upload a file or paste addresses to add to this lookup.'
              : `Found ${newAddresses.length} new addresses to add.`}
          </ModalDescription>
        </ModalHeader>

        {step === 'input' && (
          <div className="space-y-4">
            {/* File upload */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Upload file</label>
              <FileUpload onFileLoaded={handleFileLoaded} compact />
            </div>

            {/* Divider */}
            <div className="flex items-center gap-4">
              <div className="flex-1 h-px bg-border" />
              <span className="text-sm text-muted-foreground">or</span>
              <div className="flex-1 h-px bg-border" />
            </div>

            {/* Paste input */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Paste addresses</label>
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder="Paste wallet addresses in any format..."
                className="w-full h-32 p-3 text-sm font-mono border rounded-lg resize-none bg-background"
              />
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {validCount > 0 ? `${validCount} addresses detected` : 'No addresses detected'}
                </span>
                <Button
                  size="sm"
                  onClick={handleProcessPaste}
                  disabled={validCount === 0 || loading}
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Processing...
                    </>
                  ) : (
                    'Continue'
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}

        {step === 'confirm' && (
          <div className="space-y-4">
            {/* Summary */}
            <div className="p-4 bg-muted rounded-lg space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm">New addresses:</span>
                <span className="font-medium">{newAddresses.length}</span>
              </div>
              {duplicateCount > 0 && (
                <div className="flex items-center justify-between text-muted-foreground">
                  <span className="text-sm">Duplicates skipped:</span>
                  <span className="text-sm">{duplicateCount}</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-sm">Existing addresses:</span>
                <span className="font-medium">{existingWallets.length}</span>
              </div>
              <div className="pt-2 border-t">
                <div className="flex items-center justify-between font-medium">
                  <span className="text-sm">After merge:</span>
                  <span>{existingWallets.length + newAddresses.length} total</span>
                </div>
              </div>
            </div>

            {newAddresses.length === 0 ? (
              <div className="text-center py-4">
                <p className="text-muted-foreground">
                  All addresses are already in this lookup.
                </p>
                <Button variant="outline" onClick={handleBack} className="mt-4">
                  Try different addresses
                </Button>
              </div>
            ) : (
              <>
                {/* Action buttons */}
                <div className="space-y-2">
                  <Button
                    className="w-full"
                    onClick={handleAddToLookup}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add to this lookup
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={handleCreateNew}
                  >
                    <FileText className="h-4 w-4 mr-2" />
                    Create new lookup instead
                  </Button>
                </div>

                {/* Back button */}
                <button
                  className="w-full text-sm text-muted-foreground hover:text-foreground underline"
                  onClick={handleBack}
                >
                  Back to input
                </button>
              </>
            )}
          </div>
        )}
      </ModalContent>
    </Modal>
  );
}
