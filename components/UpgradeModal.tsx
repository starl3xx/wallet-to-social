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
import { cn } from '@/lib/utils';

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

/**
 * The pack marked when nothing about the buyer's list is known.
 *
 * There is always exactly one, because "one primary action per view, stated at
 * a different scale" needs something to be primary. With four outline buttons
 * and no mark, the modal asked a question instead of making a recommendation.
 *
 * Campaign rather than Trial: it keeps the $99 headline five comparison pages
 * already carry, and it is the rung that covers a real launch.
 */
const DEFAULT_SUGGESTION: PackId = 'campaign';

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
  const suggested: PackId = walletCount
    ? (PACK_IDS.find(
        (id) => PACKS[id].matches * SUBMISSION_MULTIPLIER >= walletCount
      ) ?? PACK_IDS[PACK_IDS.length - 1])
    : DEFAULT_SUGGESTION;

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent className="max-w-5xl">
        <ModalHeader className="flex-none">
          <ModalTitle className="text-2xl font-light tracking-[var(--tracking-title)]">
            Buy credits
          </ModalTitle>
          <ModalDescription>
            {walletCount
              ? `Your file has ${walletCount.toLocaleString()} wallets. You are charged only for the ones we resolve to an 𝕏 or Farcaster account.`
              : 'You are charged only for the wallets we resolve to an 𝕏 or Farcaster account. Misses are free.'}
          </ModalDescription>
        </ModalHeader>

        <div className="flex flex-col gap-4 md:min-h-0 md:flex-1">
          <div className="flex-none space-y-2">
            <label className="text-sm font-medium">Email address</label>
            {/* Says what the field is for, because without it the modal reads
                as a payment form: it is titled "Buy credits", it lists prices,
                and it has buttons that say Buy. The first person to use it
                typed a card number here. Card details are collected by Stripe
                on the next page, and this address is only how credits find an
                account. */}
            <p className="text-sm text-muted-foreground">
              Where your credits and receipt go. Card details come next, on
              Stripe.
            </p>
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
                  className={cn(
                    'relative flex flex-col gap-4 rounded-lg border p-4',
                    // One hairline carries separation, and colour tells the
                    // suggested card apart. `border-2` is banned outside a
                    // dashed dropzone.
                    isSuggested ? 'border-accent-brand' : 'border-border'
                  )}
                >
                  {/* A badge, so it takes the badge treatment: mono, upper,
                      tint, no border. It was a filled sentence-case pill, which
                      is the treatment reserved for actions, and it sat directly
                      above a button wearing the same clothes. */}
                  {isSuggested && (
                    <span className="absolute -top-2.5 left-4 rounded-sm bg-accent-brand-tint px-2 py-0.5 font-mono text-xs uppercase tracking-[var(--tracking-label)] text-accent-brand">
                      {walletCount ? 'Fits your list' : 'Most bought'}
                    </span>
                  )}

                  <div>
                    <h3 className="text-sm font-semibold">{pack.name}</h3>
                    {/* The figure treatment from `Figure`: weight 300 at title
                        tracking. It was `font-bold`, which is 700 and not one
                        of the five weights the scale defines. */}
                    <div className="mt-1 flex items-baseline gap-1.5">
                      <span className="text-2xl font-light tabular-nums tracking-[var(--tracking-title)]">
                        {price(pack.priceCents)}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        once
                      </span>
                    </div>
                  </div>

                  <div className="space-y-0.5 text-sm">
                    <p className="font-medium tabular-nums">
                      {pack.matches.toLocaleString()} matches
                    </p>
                    {/* Secondary and muted on purpose. The match count is what
                        is sold and what is billed; the wallet figure is a
                        translation for someone holding a file. */}
                    <p className="tabular-nums text-muted-foreground">
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
                'API access, drawing the same credits',
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
