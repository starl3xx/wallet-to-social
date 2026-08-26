'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalDescription,
} from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { InlineError } from '@/components/ui/inline-error';
import { XMark } from '@/components/ui/brand-marks';
import {
  Check,
  CircleNotch as Loader2,
  Drop,
  Lightning,
  Rocket,
  TrendUp,
  Stack,
} from '@phosphor-icons/react';
import {
  PACKS,
  PACK_IDS,
  MEASURED_MATCH_RATE,
  SUBMISSION_MULTIPLIER,
  CREDIT_LIFETIME_MONTHS,
  type PackId,
} from '@/lib/packs';
import { CHAIN_COUNT_WORD } from '@/lib/public-figures';
import { Analytics } from '@/lib/client-analytics';
import { useAuth } from '@/components/AuthProvider';
import { cn } from '@/lib/utils';

interface UpgradeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentTier?: string;
  walletCount?: number;
  /** The gate that opened the modal, for the analytics; see UpgradeModalProvider. */
  trigger?: string;
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
 * a different scale" needs something to be primary. With five outline buttons
 * and no mark, the modal asked a question instead of making a recommendation.
 *
 * **Starter, and it moved here from Campaign when Starter arrived.** This
 * branch is the no-wallet-count branch: nothing was uploaded, so the modal was
 * opened by a feature gate rather than by a file too big to run. That person
 * wants the reverse-lookup column, the export or the contract import, and
 * `hasPaidAccess` is binary, so the smallest rung opens exactly as much as the
 * largest one. Recommending $99 to somebody who has bought nothing prices the
 * key at the volume, and the volume is the part they cannot yet estimate.
 *
 * The ladder makes this safe rather than merely kind. Every rung is cheaper per
 * match than the one below it, so a Starter buyer who needs more is never
 * trapped: stepping up is the cheaper way to get more, by construction. The
 * measured history is the other half of the argument: paid credit lots, all
 * time, zero, against a $29 floor. A recommendation nobody takes converts at
 * the same rate whatever number is printed on it.
 */
const DEFAULT_SUGGESTION: PackId = 'starter';

/**
 * One icon per pack, in a tinted enclosure.
 *
 * A pack card carries four short lines and nothing else, because the features
 * are shared and stating them once per card would imply a difference that does
 * not exist. That left the cards thin. An icon gives each one something to lead
 * with, which is what the two-tier modal this replaces had and what it was
 * missing.
 *
 * They read as one size ladder: a drop, a bolt, a launch, a rising line, a
 * stack. Starter takes `Drop` because it is the smallest amount of the same
 * thing rather than a different kind of thing, and because a single filled
 * shape is still legible at 16px where a busier mark is not.
 *
 * The enclosure matters: per the affordance table an icon inside one reads as a
 * control, and an icon beside bare text reads as identification. These identify.
 */
const PACK_ICON: Record<PackId, typeof Lightning> = {
  starter: Drop,
  trial: Lightning,
  campaign: Rocket,
  scale: TrendUp,
  index: Stack,
};

/**
 * The platform mark inside running copy, sized and aligned the way the home
 * page sets it. Never the literal 𝕏 character: Söhne has no U+1D54F, so it
 * fell back to another face and rendered thinner and narrower than the words
 * around it. `label` makes it read as "X" to a screen reader, because here the
 * mark stands in for the word.
 */
const X_IN_COPY = <XMark className="inline h-3 w-3 align-[-0.1em]" label="X" />;

/**
 * What every pack includes, said once below the cards. Keyed because one
 * item carries the platform mark and so is not a string.
 *
 * Only things a free account really does not have. Two entries here were free
 * until 2026-08-26: "Full CSV export, never capped", which `ExportButton`
 * gates on nothing at all, and "X reachability on every match", which
 * `stampReachability` writes for every result set. Selling the free half of
 * the product from inside the buy-credits modal is the worst place in the
 * app to get this wrong. Read the gate before adding a line.
 *
 * What IS gated on the export is the X list button, and what is gated on the
 * results is `priority_score` and `fc_followers`: `job-processor` sets both to
 * undefined when `paidData` is false, so they are missing from the free CSV as
 * well as from the table.
 */
const INCLUDED: { key: string; label: React.ReactNode }[] = [
  { key: 'chains', label: `All ${CHAIN_COUNT_WORD} chains` },
  { key: 'columns', label: 'Priority score and follower counts' },
  { key: 'api', label: 'API and MCP server, drawing the same credits' },
  { key: 'reverse', label: 'Reverse lookup: handle → wallets' },
  { key: 'ens', label: 'Deep scan with onchain ENS' },
  { key: 'x', label: <>{X_IN_COPY} list export, reachable handles only</> },
  { key: 'contract', label: 'Import from a contract address' },
  { key: 'dms', label: 'Farcaster DMs to matched holders' },
  { key: 'expiry', label: `Credits last ${CREDIT_LIFETIME_MONTHS} months` },
];

/** Dollars, without a trailing `.00` on the whole numbers every pack uses. */
function price(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

export function UpgradeModal({
  open,
  onOpenChange,
  currentTier = 'free',
  walletCount,
  trigger,
}: UpgradeModalProps) {
  const { user } = useAuth();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState<PackId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      Analytics.upgradeModalViewed(
        trigger ?? (walletCount ? 'limit' : 'feature'),
        currentTier
      );
    }
  }, [open, walletCount, currentTier, trigger]);

  // A signed-in buyer should not retype the address their credits go to.
  // Seed only an empty field, so a deliberately typed different address
  // survives, and re-seed on each open rather than each keystroke.
  useEffect(() => {
    if (open && user?.email) {
      setEmail((current) => current || user.email);
    }
  }, [open, user?.email]);

  const handleBuy = async (pack: PackId) => {
    if (!email || !email.includes('@')) {
      setError('Please enter a valid email address');
      // Focus lands on the field the error is about, not on the Buy button
      // three cards away from it.
      emailRef.current?.focus();
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
   *
   * `find` takes the first hit, so this is correct only while `PACK_IDS` runs
   * smallest first. It does, Starter included, and `scripts/check-invariants.ts`
   * asserts the match counts ascend.
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
            {walletCount ? (
              <>
                Your file has {walletCount.toLocaleString()} wallets. You are
                charged only for the ones we resolve to an {X_IN_COPY} or
                Farcaster account.
              </>
            ) : (
              <>
                You are charged only for the wallets we resolve to an{' '}
                {X_IN_COPY} or Farcaster account. Misses are free.
              </>
            )}
          </ModalDescription>
        </ModalHeader>

        <div className="flex flex-col gap-4 md:min-h-0 md:flex-1">
          <div className="flex-none space-y-2">
            <label htmlFor="buy-credits-email" className="text-sm font-medium">
              Email address
            </label>
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
              ref={emailRef}
              id="buy-credits-email"
              type="email"
              name="email"
              autoComplete="email"
              spellCheck={false}
              placeholder="you@example.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (error) setError(null);
              }}
            />
            {error && <InlineError>{error}</InlineError>}
          </div>

          {/* Five packs. One column on a phone, two from `sm`, three from `md`,
              five from `lg`. The step at `md` is what five cards need that four
              did not: two columns leave a single card alone on the last row,
              and three divides five as 3 + 2, which is the smaller orphan.

              Five across only at `lg`, where the modal is at its 5xl cap and
              the body's `p-6` leaves 976px: five cards and four 12px gaps put
              186px on each, against the 131px that four columns would have at
              the `sm` viewport where the modal is 608px wide, which is what
              made four-at-`sm` too narrow to hold a price and a match count on
              separate lines. A ladder is read along one line, so the full row
              is worth the width it takes, and it is the row the ladder was
              designed to be read as: cheapest first, each rung cheaper per
              match than the last.

              No `overflow-y-auto` here. It made this grid a clipping context,
              and the badge that sits above the suggested card's top edge was
              cut in half by it. The modal body already scrolls, which is where
              scrolling belongs; `pt-3` is the room the badge needs. */}
          <div className="grid gap-3 pt-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
            {PACK_IDS.map((id) => {
              const pack = PACKS[id];
              const isSuggested = suggested === id;
              const Icon = PACK_ICON[id];

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
                  {/* A badge, so it is the Badge primitive: mono, upper, tint,
                      no border. It was a filled sentence-case pill, which is
                      the treatment reserved for actions, and it sat directly
                      above a button wearing the same clothes. `max-w-none`
                      because "Fits your list" is 14ch and the primitive caps
                      at 12ch for values it cannot trust; this one it can. */}
                  {isSuggested && (
                    <Badge
                      tone="brand"
                      className="absolute -top-2.5 left-4 max-w-none"
                    >
                      {walletCount ? 'Fits your list' : 'Recommended'}
                    </Badge>
                  )}

                  <div>
                    <div className="mb-1.5 flex items-center gap-2">
                      <span className="rounded-sm bg-accent-brand-tint p-1.5">
                        <Icon
                          className="h-4 w-4 text-accent-brand"
                          weight="fill"
                        />
                      </span>
                      <h3 className="text-sm font-semibold">{pack.name}</h3>
                    </div>
                    {/* The figure treatment from `Figure`: weight 200 at title
                        tracking, the hero-figure weight everywhere a figure
                        stands alone at 24px and up. It was `font-bold`, then
                        `font-medium`, which is the weight of the button label
                        directly beneath it, so price and button read at one
                        weight. */}
                    <div className="mt-1 flex items-baseline gap-2">
                      <span className="text-2xl font-extralight tabular-nums tracking-[var(--tracking-title)]">
                        {price(pack.priceCents)}
                      </span>
                      <span className="text-sm text-muted-foreground">
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
                    {/* The key remount is what lets `fade-in-fast` fire on the
                        label-to-spinner swap, so the state change crossfades
                        instead of hard-cutting; `w-full` above already keeps
                        the width from jumping. Opacity only: blur is neither
                        transform nor opacity, which the motion rules allow. */}
                    <span
                      key={loading === id ? 'loading' : 'idle'}
                      className="fade-in-fast inline-flex items-center gap-2"
                    >
                      {loading === id ? (
                        <>
                          <Loader2
                            className="h-4 w-4 animate-spin"
                            aria-hidden
                          />
                          Processing…
                        </>
                      ) : (
                        `Buy ${pack.name}`
                      )}
                    </span>
                  </Button>
                </div>
              );
            })}
          </div>

          {/* Said once, below the cards, rather than repeated as a feature
              bullet on all five. Every pack carries every one of these, so
              listing them per card would be five identical lists and would
              imply a difference between the rungs that does not exist.

              The check is `attested`, the one green, at UI scale with no disc.
              It wore `success-light` and `success-foreground`, a pair kept in
              globals.css for this list alone and tuned a step away from
              `attested`, so the product shipped two greens and said it had
              one.

              The panel is `bg-muted` whole, the one inset surface, at `p-4`,
              the one inset padding. It was `bg-muted/40`, a 4% lift in dark
              mode that read as a smudge rather than a surface. */}
          <div className="flex-none rounded-lg bg-muted p-4">
            <p className="mb-2 text-sm font-medium">Every pack includes</p>
            <ul className="grid gap-x-6 gap-y-2 text-sm text-muted-foreground sm:grid-cols-2">
              {INCLUDED.map((item) => (
                <li key={item.key} className="flex items-center gap-2">
                  <Check className="h-4 w-4 flex-none text-attested" />
                  {item.label}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </ModalContent>
    </Modal>
  );
}
