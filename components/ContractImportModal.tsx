'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalFooter,
} from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CircleNotch as Loader2, FileCode, Warning as AlertTriangle } from '@phosphor-icons/react';
import type { ContractType } from '@/lib/contract-holders';
// Imported from lib/chains (not lib/contract-holders) so ethers stays out of the
// client bundle — contract-holders imports ethers at module scope.
import {
  CHAIN_LABELS,
  SUPPORTED_CHAINS,
  ERC20_SUPPORTED_CHAINS,
  type SupportedChain,
} from '@/lib/chains';

interface ContractImportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Receives the contract alongside the wallets.
   *
   * The wallet list on its own loses what was actually looked up. The admin
   * Jobs table could say "5,000 wallets" but not that they were USDG holders,
   * which is the only fact that explains a 1.6% match rate.
   */
  onImport: (wallets: string[], source: ImportedContract) => void;
  /**
   * Seed the form, for the `?contract=…&chain=…` deep link.
   *
   * It fills the field and stops. It deliberately does not press the button:
   * fetching holders spends a metered daily allowance, and arriving on a URL is
   * not the same as asking to spend it. The person still confirms what they are
   * importing, which is also the only chance they get to see the chain.
   */
  initialAddress?: string;
  initialChain?: SupportedChain;
}

export interface ImportedContract {
  contractAddress: string;
  chain: string;
  tokenName?: string;
  tokenSymbol?: string;
  contractType?: string;
  totalHolders?: number;
  truncated?: boolean;
  /** Wallet (lowercased) to bag size. Absent when the source did not report it. */
  balances?: Record<string, number>;
}

type Step = 'input' | 'loading' | 'preview';

interface ContractResult {
  wallets: string[];
  /** Wallet (lowercased) to bag size; absent when the source did not report it. */
  balances?: Record<string, number>;
  tokenName: string;
  tokenSymbol: string;
  contractType: ContractType;
  totalHolders: number;
  truncated: boolean;
  appliedLimit?: number;
  chain: SupportedChain;
}

export function ContractImportModal({
  open,
  onOpenChange,
  onImport,
  initialAddress,
  initialChain,
}: ContractImportModalProps) {
  const [step, setStep] = useState<Step>('input');
  const [contractAddress, setContractAddress] = useState('');
  const [chain, setChain] = useState<SupportedChain>('ethereum');
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ContractResult | null>(null);

  /**
   * Seed from the deep link when the modal opens, not when the props arrive.
   *
   * `useState(initialAddress)` would not do: the page reads the URL in an
   * effect, so the value lands after this component has already mounted with
   * the modal closed, and an initialiser only ever runs once. Keying on `open`
   * also means a close-then-reopen re-seeds rather than showing an empty form
   * with the caller still holding a contract.
   */
  useEffect(() => {
    if (!open || !initialAddress) return;
    setContractAddress(initialAddress);
    if (initialChain) setChain(initialChain);
    setStep('input');
  }, [open, initialAddress, initialChain]);

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
    onImport(result.wallets, {
      contractAddress,
      chain,
      tokenName: result.tokenName,
      tokenSymbol: result.tokenSymbol,
      contractType: result.contractType,
      totalHolders: result.totalHolders,
      truncated: result.truncated,
      balances: result.balances,
    });
    handleClose();
  }, [result, onImport, handleClose, contractAddress, chain]);

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
        return 'bg-accent-brand-tint text-accent-brand';
      case 'ERC-1155':
        return 'bg-accent-brand-tint text-accent-brand';
      default:
        return 'bg-accent-brand-tint text-accent-brand';
    }
  };

  return (
    <Modal open={open} onOpenChange={handleClose}>
      {/* The preview step is the tall one: a chain picker, a holder count, a
          truncation warning and a sample of addresses. Its two buttons are the
          only reason the step exists, so they are held below the scroll rather
          than at the end of it. The other two steps are short and pass nothing,
          because a footer costs vertical space on the screens with least of it. */}
      <ModalContent
        className="max-w-md"
        footer={
          step === 'preview' && result ? (
            <ModalFooter>
              <Button variant="outline" onClick={handleBack} className="flex-1">
                Back
              </Button>
              <Button onClick={handleImport} className="flex-1">
                Import {result.wallets.length.toLocaleString()} wallets
              </Button>
            </ModalFooter>
          ) : undefined
        }
      >
        <ModalHeader>
          <ModalTitle className="flex items-center gap-2">
            <FileCode className="h-5 w-5" />
            Import from contract
          </ModalTitle>
          <ModalDescription>
            {step === 'input' && 'Enter an ERC-20 token or NFT contract address to import all holders.'}
            {step === 'loading' && 'Fetching token holders...'}
            {step === 'preview' && result &&
              (result.totalHolders > 0
                ? `Found ${result.totalHolders.toLocaleString()} holders for ${result.tokenName}`
                : `Imported ${result.wallets.length.toLocaleString()} holders for ${result.tokenName}`)}
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

            {/* Chain selector. A wrapped row of small radios was legible at
                three networks and cramped at seven, and the selected one was a
                dot you had to hunt for. Selectable tiles keep every option
                scannable and make the current choice obvious at a glance. */}
            <fieldset className="space-y-2">
              {/* fieldset/legend is the element pair for a radio group: it
                  names the group for assistive tech without an aria-* patch */}
              <legend className="mb-2 flex w-full items-baseline justify-between gap-2">
                <span className="text-sm font-medium">Network</span>
                <span className="text-xs text-muted-foreground">
                  the network this contract is deployed on
                </span>
              </legend>
              {/* Real radio inputs, visually hidden, with the label styled as
                  the tile. Buttons with role="radio" looked identical but threw
                  away what a radio group gives for free: arrow keys move the
                  selection, the group is a single tab stop, and assistive tech
                  announces position. Reimplementing that with roving tabindex
                  is easy to get subtly wrong, and getting it wrong is worse
                  than the plain radios this replaces. */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {SUPPORTED_CHAINS.map((c) => (
                  <label key={c} className="cursor-pointer">
                    <input
                      type="radio"
                      name="chain"
                      value={c}
                      checked={chain === c}
                      onChange={() => setChain(c)}
                      className="peer sr-only"
                    />
                    <span
                      className="block rounded-lg border border-border px-3 py-2 text-center text-sm transition-colors hover:border-muted-foreground hover:bg-muted/40 peer-checked:border-foreground peer-checked:bg-muted peer-checked:font-medium peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2"
                    >
                      {CHAIN_LABELS[c]}
                    </span>
                  </label>
                ))}
              </div>
              {!ERC20_SUPPORTED_CHAINS.includes(chain) && (
                <p className="text-xs text-muted-foreground">
                  NFT collections only on {CHAIN_LABELS[chain]}: token (ERC-20)
                  holder lists aren’t available on this network.
                </p>
              )}
            </fieldset>

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
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
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
                {/* CHAIN_LABELS, not a CSS capitalize on the raw value — that
                    renders 'robinhood' as "Robinhood" rather than "Robinhood Chain" */}
                <span>{CHAIN_LABELS[result.chain] ?? result.chain}</span>
              </div>

              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Total holders:</span>
                <span className="font-medium">
                  {result.totalHolders > 0
                    ? result.totalHolders.toLocaleString()
                    : 'not reported'}
                </span>
              </div>

              {result.truncated && (
                <div className="flex items-start gap-2 pt-2 border-t">
                  <AlertTriangle className="h-4 w-4 text-caution mt-0.5 flex-shrink-0" />
                  {/* Report what was actually imported, not the cap. A holder
                      list can come back short of the cap when the source is a
                      block explorer that pages slowly and the request runs out
                      of time, and claiming the cap would overstate it.

                      When the source reported no total there is no "of N" to
                      state. Saying "N of N" there is worse than saying nothing,
                      because it reads as a complete list: that is exactly how a
                      capped 5,000-holder import told a buyer it held every
                      holder. */}
                  <p className="text-xs text-caution">
                    {result.totalHolders > 0 ? (
                      <>
                        Imported {result.wallets.length.toLocaleString()} of{' '}
                        {result.totalHolders.toLocaleString()} total holders
                      </>
                    ) : (
                      <>
                        Imported {result.wallets.length.toLocaleString()} holders, the
                        maximum for this import. The source did not report a total, so
                        this token probably has more.
                      </>
                    )}
                  </p>
                </div>
              )}
            </div>

          </div>
        )}
      </ModalContent>
    </Modal>
  );
}
