'use client';

import { useState, useCallback } from 'react';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalDescription,
} from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, FileCode, AlertTriangle } from 'lucide-react';
import type { ContractType, SupportedChain } from '@/lib/contract-holders';

interface ContractImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (wallets: string[]) => void;
}

type Step = 'input' | 'loading' | 'preview';

interface ContractResult {
  wallets: string[];
  tokenName: string;
  tokenSymbol: string;
  contractType: ContractType;
  totalHolders: number;
  truncated: boolean;
  chain: SupportedChain;
}

export function ContractImportModal({
  open,
  onOpenChange,
  onImport,
}: ContractImportModalProps) {
  const [step, setStep] = useState<Step>('input');
  const [contractAddress, setContractAddress] = useState('');
  const [chain, setChain] = useState<SupportedChain>('ethereum');
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ContractResult | null>(null);

  // Validate address format
  const isValidAddress = /^0x[a-fA-F0-9]{40}$/.test(contractAddress);

  // Reset and close
  const handleClose = useCallback(() => {
    setContractAddress('');
    setChain('ethereum');
    setStep('input');
    setError(null);
    setResult(null);
    setLoading(false);
    onOpenChange(false);
  }, [onOpenChange]);

  // Load holders from contract
  const handleLoadHolders = useCallback(async () => {
    if (!isValidAddress) return;

    setError(null);
    setLoading(true);
    setStep('loading');
    setLoadingMessage('Detecting contract type...');

    try {
      const response = await fetch('/api/contract-holders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contractAddress, chain }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch holders');
      }

      setResult(data);
      setStep('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch holders');
      setStep('input');
    } finally {
      setLoading(false);
    }
  }, [contractAddress, chain, isValidAddress]);

  // Handle import confirmation
  const handleImport = useCallback(() => {
    if (!result) return;
    onImport(result.wallets);
    handleClose();
  }, [result, onImport, handleClose]);

  // Go back to input
  const handleBack = useCallback(() => {
    setStep('input');
    setError(null);
    setResult(null);
  }, []);

  // Get contract type badge color
  const getTypeBadgeColor = (type: ContractType) => {
    switch (type) {
      case 'ERC-721':
        return 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300';
      case 'ERC-1155':
        return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300';
      default:
        return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300';
    }
  };

  return (
    <Modal open={open} onOpenChange={handleClose}>
      <ModalContent className="max-w-md">
        <ModalHeader>
          <ModalTitle className="flex items-center gap-2">
            <FileCode className="h-5 w-5" />
            Import from contract
          </ModalTitle>
          <ModalDescription>
            {step === 'input' && 'Enter an ERC-20 token or NFT contract address to import all holders.'}
            {step === 'loading' && 'Fetching token holders...'}
            {step === 'preview' && result && `Found ${result.totalHolders.toLocaleString()} holders for ${result.tokenName}`}
          </ModalDescription>
        </ModalHeader>

        {/* Input Step */}
        {step === 'input' && (
          <div className="space-y-4">
            {error && (
              <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            {/* Contract address input */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Contract address</label>
              <Input
                value={contractAddress}
                onChange={(e) => setContractAddress(e.target.value.trim())}
                placeholder="0x..."
                className="font-mono text-sm"
                autoFocus
              />
              {contractAddress && !isValidAddress && (
                <p className="text-xs text-destructive">
                  Please enter a valid Ethereum address
                </p>
              )}
            </div>

            {/* Chain selector */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Network</label>
              <div className="flex gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="chain"
                    value="ethereum"
                    checked={chain === 'ethereum'}
                    onChange={() => setChain('ethereum')}
                    className="text-primary"
                  />
                  <span className="text-sm">Ethereum</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="chain"
                    value="base"
                    checked={chain === 'base'}
                    onChange={() => setChain('base')}
                    className="text-primary"
                  />
                  <span className="text-sm">Base</span>
                </label>
              </div>
            </div>

            {/* Load button */}
            <Button
              className="w-full"
              onClick={handleLoadHolders}
              disabled={!isValidAddress || loading}
            >
              Load holders
            </Button>
          </div>
        )}

        {/* Loading Step */}
        {step === 'loading' && (
          <div className="py-8 flex flex-col items-center gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">{loadingMessage}</p>
          </div>
        )}

        {/* Preview Step */}
        {step === 'preview' && result && (
          <div className="space-y-4">
            {/* Token info */}
            <div className="p-4 bg-muted rounded-lg space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{result.tokenName}</span>
                  <span className="text-muted-foreground text-sm">({result.tokenSymbol})</span>
                </div>
                <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${getTypeBadgeColor(result.contractType)}`}>
                  {result.contractType}
                </span>
              </div>

              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Network:</span>
                <span className="capitalize">{result.chain}</span>
              </div>

              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Total holders:</span>
                <span className="font-medium">{result.totalHolders.toLocaleString()}</span>
              </div>

              {result.truncated && (
                <div className="flex items-start gap-2 pt-2 border-t">
                  <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Limited to 10,000 of {result.totalHolders.toLocaleString()} total holders
                  </p>
                </div>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleBack} className="flex-1">
                Back
              </Button>
              <Button onClick={handleImport} className="flex-1">
                Import {result.wallets.length.toLocaleString()} wallets
              </Button>
            </div>
          </div>
        )}
      </ModalContent>
    </Modal>
  );
}
