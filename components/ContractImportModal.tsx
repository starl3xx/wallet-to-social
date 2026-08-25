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
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { InlineError } from '@/components/ui/inline-error';
import {
  CircleNotch as Loader2,
  Warning as AlertTriangle,
} from '@phosphor-icons/react';
import type { ContractType } from '@/lib/contract-holders';
// Imported from lib/chains (not lib/contract-holders) so ethers stays out of the
// client bundle — contract-holders imports ethers at module scope.
import { CHAIN_MARKS } from '@/components/ui/chain-marks';
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
            // ModalFooter's own layout: natural widths, the filled primary at
            // the right. Both buttons carried `flex-1`, which made Back and
            // Import siblings of equal size, and the affordance rule is that
            // alternates are never that.
            <ModalFooter>
              <Button variant="outline" onClick={handleBack}>
                Back
              </Button>
              <Button onClick={handleImport}>
                Import {result.wallets.length.toLocaleString()} wallets
              </Button>
            </ModalFooter>
          ) : undefined
        }
      >
        <ModalHeader>
          {/* The same words as the button that opens it ("Import from a
              contract", InputMethodPicker), so the dialog confirms the
              choice rather than restating it. "Its holders", not "all
              holders": the preview step of this same dialog warns when the
              list is capped, and a promise the next screen retracts is the
              kind of "all" CLAUDE.md says to be most suspicious of. */}
          <ModalTitle>Import from a contract</ModalTitle>
          <ModalDescription>
            {step === 'input' &&
              'Enter an ERC-20 token or NFT contract address to import its holders.'}
            {step === 'loading' && 'Fetching token holders...'}
            {step === 'preview' &&
              result &&
              (result.totalHolders > 0
                ? `Found ${result.totalHolders.toLocaleString()} holders for ${result.tokenName}`
                : `Imported ${result.wallets.length.toLocaleString()} holders for ${result.tokenName}`)}
          </ModalDescription>
        </ModalHeader>

        {/* Input Step */}
        {step === 'input' && (
          <div className="space-y-4">
            {/* The one inline error, shared with the address check below:
                a request that failed and a field that does not validate are
                the same statement at the same scale. This was a tinted box
                (before that, `bg-destructive/10` under a `/20` border) while
                the check under the field was bare 12px text. */}
            {error && <InlineError>{error}</InlineError>}

            {/* Contract address input */}
            <div className="space-y-2">
              <label htmlFor="contract-address" className="text-sm font-medium">
                Contract address
              </label>
              <Input
                id="contract-address"
                value={contractAddress}
                onChange={(e) => setContractAddress(e.target.value.trim())}
                placeholder="0x..."
                className="font-mono text-sm"
                autoFocus
              />
              {contractAddress && !isValidAddress && (
                <InlineError>Please enter a valid Ethereum address</InlineError>
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
                  The network this contract is deployed on.
                </span>
              </legend>
              {/* Real radio inputs, visually hidden, with the label styled as
                  the tile. Buttons with role="radio" looked identical but threw
                  away what a radio group gives for free: arrow keys move the
                  selection, the group is a single tab stop, and assistive tech
                  announces position. Reimplementing that with roving tabindex
                  is easy to get subtly wrong, and getting it wrong is worse
                  than the plain radios this replaces. */}
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {SUPPORTED_CHAINS.map((c) => {
                  const Mark = CHAIN_MARKS[c];
                  return (
                    <label key={c} className="cursor-pointer">
                      <input
                        type="radio"
                        name="chain"
                        value={c}
                        checked={chain === c}
                        onChange={() => setChain(c)}
                        className="peer sr-only"
                      />
                      {/* A named exception to the 34px control height, recorded
                        in docs/DESIGN-LANGUAGE.md. A 64px tile carries the
                        network's mark above its name; at `h-control` there is
                        room for neither, which is how "Robinhood Chain" came to
                        wrap out of its own box. `border-input` so its edge
                        clears 3:1, and `transition-control` for the product's
                        durations.

                        The selected tile is violet: selection is an
                        affordance, and this was the one control in the
                        product whose selection was foreground-on-muted,
                        which the segmented-control notes name as the defect
                        class. Hover changes colour only, to the one rested
                        grey at full opacity. The `peer-checked:hover` rule
                        exists because Tailwind sorts `hover:` after
                        `peer-checked:`, so without it hovering the selected
                        tile painted it grey. */}
                      <span className="flex h-16 flex-col items-center justify-center gap-2 rounded-lg border border-input px-2 text-center text-xs leading-tight transition-control hover:bg-muted peer-checked:border-accent-brand peer-checked:bg-accent-brand-tint peer-checked:font-medium peer-checked:text-accent-brand peer-checked:hover:bg-accent-brand-tint peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2">
                        <Mark className="h-6 w-6" />
                        {CHAIN_LABELS[c]}
                      </span>
                    </label>
                  );
                })}
              </div>
              {!ERC20_SUPPORTED_CHAINS.includes(chain) && (
                <p className="text-xs text-muted-foreground">
                  NFT collections only on {CHAIN_LABELS[chain]}: token (ERC-20)
                  holder lists aren’t available on this network.
                </p>
              )}
            </fieldset>

            {/* The action row, in ModalFooter's one layout. This step is
                short, so the row sits in the body rather than the footer
                slot: a pinned footer costs height on the screens with least
                of it, and here there is nothing to scroll past. */}
            <ModalFooter>
              <Button
                onClick={handleLoadHolders}
                disabled={!isValidAddress || loading}
              >
                Load holders
              </Button>
            </ModalFooter>
          </div>
        )}

        {/* Loading Step */}
        {/* `h-5 w-5`, the same spinner ApiKeysModal shows for the same state;
            it was `h-8`, a size the icon scale does not have. */}
        {step === 'loading' && (
          <div className="flex flex-col items-center gap-4 py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
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
                  <span className="text-muted-foreground text-sm">
                    ({result.tokenSymbol})
                  </span>
                </div>
                {/* A contract type identifies, so it is a muted Badge. It was
                    a sentence-case sans pill in the brand tint, which is the
                    shape badge.tsx names as the one it removed from this
                    file, and the helper that picked its colour returned the
                    same classes on every branch. */}
                <Badge>{result.contractType}</Badge>
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
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-caution" />
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
                        Imported {result.wallets.length.toLocaleString()}{' '}
                        holders, the maximum for this import. The source did not
                        report a total, so this token probably has more.
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
