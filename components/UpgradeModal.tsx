'use client';

import { useState, useEffect } from 'react';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalDescription,
} from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Check, CircleNotch as Loader2 } from '@phosphor-icons/react';
import {
  PACKS,
  PACK_IDS,
  MEASURED_MATCH_RATE,
  SUBMISSION_MULTIPLIER,
  type PackId,
} from '@/lib/packs';
import { Analytics } from '@/lib/client-analytics';

interface UpgradeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentTier?: string;
  walletCount?: number;
}

/**
 * Roughly how many wallets a pack covers.
 *
 * Deliberately approximate and deliberately shown. The buyer thinks in wallets
 * because that is what they have in a file, and refusing to translate would
 * make the price sheet unreadable. Rounded to two significant figures so it
 * reads as the estimate it is: "≈1,100 wallets" invites a sanity check in a way
 * that "1,055 wallets" does not.
 */
function approxWallets(matches: number): string {
  const raw = matches / MEASURED_MATCH_RATE;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)) - 1);
  return (Math.round(raw / magnitude) * magnitude).toLocaleString();
}

/** Dollars, without a trailing `.00` on the whole numbers every pack uses. */
function price(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

export function UpgradeModal({
  open,
  onOpenChange,
  currentTier = 'free',
  walletCount,
}: UpgradeModalProps) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState<PackId | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      const trigger = walletCount ? 'limit' : 'feature';
      Analytics.upgradeModalViewed(trigger, currentTier);
    }
  }, [open, walletCount, currentTier]);

  const handleBuy = async (pack: PackId) => {
    if (!email || !email.includes('@')) {
      setError('Please enter a valid email address');
      return;
    }

    setLoading(pack);
    setError(null);
    Analytics.checkoutStarted(pack);

    try {
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, pack }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Checkout failed');
      }

      Analytics.checkoutRedirected(pack);
      window.location.href = data.url;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Checkout failed';
      Analytics.checkoutFailed(pack, message);
      setError(message);
      setLoading(null);
    }
  };

  /**
   * The smallest pack whose submission headroom covers this list.
   *
   * Headroom, not matches: the buyer is billed for matches but blocked on
   * wallets submitted, and a pack that cannot accept the file they are holding
   * is the wrong recommendation however well it matches their spend. Falls
   * through to the largest pack, which is the honest answer when nothing fits:
   * buy the biggest and run it in two passes.
   */
  const suggested: PackId | null = walletCount
    ? (PACK_IDS.find(
        (id) => PACKS[id].matches * SUBMISSION_MULTIPLIER >= walletCount
      ) ?? PACK_IDS[PACK_IDS.length - 1])
    : null;

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent className="max-w-5xl">
        <ModalHeader className="flex-none">
          <ModalTitle className="text-2xl">Buy credits</ModalTitle>
          <ModalDescription>
            {walletCount
              ? `Your file has ${walletCount.toLocaleString()} wallets. You are charged only for the ones we resolve to an 𝕏 or Farcaster account.`
              : 'You are charged only for the wallets we resolve to an 𝕏 or Farcaster account. Misses are free.'}
          </ModalDescription>
        </ModalHeader>

        <div className="flex flex-col gap-4 md:min-h-0 md:flex-1">
          <div className="flex-none space-y-2">
            <label className="text-sm font-medium">Email address</label>
            <Input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (error) setError(null);
              }}
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          {/* Four packs. One column on a phone, two from `md`, four from `lg`,
              because four cards at tablet width leaves each one too narrow to
              hold a price and a match count on separate lines. The body scrolls
              rather than each card, unlike the two-tier version this replaces:
              a pack card is short enough that an inner scroll would be a
              scrollbar around three lines of text. */}
          <div className="grid gap-3 overflow-y-auto sm:grid-cols-2 lg:grid-cols-4">
            {PACK_IDS.map((id) => {
              const pack = PACKS[id];
              const isSuggested = suggested === id;

              return (
                <div
                  key={id}
                  className={`relative flex flex-col gap-3 rounded-lg p-4 ${
                    isSuggested
                      ? 'border-2 border-accent-brand'
                      : 'border border-border'
                  }`}
                >
                  {isSuggested && (
                    <div className="absolute -top-3 left-4 rounded-full bg-accent-brand px-3 py-0.5 text-xs font-medium text-accent-brand-foreground">
                      Fits your list
                    </div>
                  )}

                  <div>
                    <h3 className="font-semibold">{pack.name}</h3>
                    <div className="mt-1">
                      <span className="text-2xl font-bold tabular-nums">
                        {price(pack.priceCents)}
                      </span>
                      <span className="ml-1 text-sm text-muted-foreground">
                        once
                      </span>
                    </div>
                  </div>

                  <div className="space-y-1 text-sm">
                    <p className="font-medium tabular-nums">
                      {pack.matches.toLocaleString()} matches
                    </p>
                    {/* Secondary and muted on purpose. The match count is what
                        is sold and what is billed; the wallet figure is a
                        translation for someone holding a file. */}
                    <p className="text-muted-foreground">
                      ≈ {approxWallets(pack.matches)} wallets
                    </p>
                  </div>

                  <p className="flex-1 text-sm text-muted-foreground">
                    {pack.fits}
                  </p>

                  <Button
                    className="w-full flex-none"
                    variant={isSuggested ? 'default' : 'outline'}
                    onClick={() => handleBuy(id)}
                    disabled={loading !== null}
                  >
                    {loading === id ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      `Buy ${pack.name}`
                    )}
                  </Button>
                </div>
              );
            })}
          </div>

          {/* Said once, below the cards, rather than repeated as a feature
              bullet on all four. Every pack carries every one of these, so
              listing them per card would be four identical lists and would
              imply a difference between the rungs that does not exist. */}
          <div className="flex-none rounded-lg bg-muted/40 p-4">
            <p className="mb-2 text-sm font-medium">Every pack includes</p>
            <ul className="grid gap-x-6 gap-y-1.5 text-sm text-muted-foreground sm:grid-cols-2">
              {[
                'All seven chains',
                'Full CSV export, never capped',
                'API access, same credits',
                'Reverse lookup: handle → wallets',
                'Deep scan with onchain ENS',
                '𝕏 reachability on every match',
                'Import from a contract address',
                'Credits last 12 months',
              ].map((item) => (
                <li key={item} className="flex items-center gap-2">
                  <div className="rounded-full bg-success-light p-0.5">
                    <Check className="h-3 w-3 text-success-foreground" />
                  </div>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </ModalContent>
    </Modal>
  );
}
