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
import { Input } from '@/components/ui/input';
import { InlineError } from '@/components/ui/inline-error';
import {
  Check,
  CircleNotch as Loader2,
  ArrowRight,
  CaretDown,
  Lightning,
  Rocket,
  TrendUp,
  Stack,
  Receipt,
  Prohibit,
  CalendarBlank,
} from '@phosphor-icons/react';
import {
  PACKS,
  PACK_IDS,
  MEASURED_MATCH_RATE,
  SUBMISSION_MULTIPLIER,
  CREDIT_LIFETIME_MONTHS,
  type PackId,
  savingsVsSmallestPack,
  centsPerMatch,
} from '@/lib/packs';
import { CHAIN_COUNT_WORD } from '@/lib/public-figures';
import { PRIVACY_PATH, TERMS_PATH, TERMS_VERSION } from '@/lib/terms';
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
 * a different scale" needs something to be primary. With four outline buttons
 * and no mark, the modal asked a question instead of making a recommendation.
 *
 * Campaign rather than Trial: it keeps the $99 headline five comparison pages
 * already carry, and it is the rung that covers a real launch.
 */
const DEFAULT_SUGGESTION: PackId = 'campaign';

const PACK_ICON: Record<PackId, typeof Lightning> = {
  trial: Lightning,
  campaign: Rocket,
  scale: TrendUp,
  index: Stack,
};

const X_IN_COPY = (
  <>
    <span className="sr-only">X</span>
    <span aria-hidden="true">𝕏</span>
  </>
);

/**
 * What every pack includes, said once below the cards. Keyed because one
 * item carries the platform mark and so is not a string.
 *
 * Only things a free account really does not have. Two entries here were free
 * until 2026-08-26: "Full CSV export, never capped", which `ExportButton`
 * gates on nothing at all, and "X reachability on every match", which
 * `stampReachability` writes for every result set. Selling the free half of
 * the product from inside the buy-credits modal is the worst place in the app
 * to get this wrong. Read the gate before adding a line.
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
  const [selected, setSelected] = useState<PackId | null>(null);
  const [emailInvalid, setEmailInvalid] = useState(false);
  /**
   * "I agree to the Terms of Service". Unchecked on every open, never
   * pre-ticked: an agreement the buyer did not make is not one we can record.
   */
  const [agreed, setAgreed] = useState(false);
  const [termsInvalid, setTermsInvalid] = useState(false);
  const [loading, setLoading] = useState<PackId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const termsRef = useRef<HTMLInputElement>(null);
  const selectedPackRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setSelected(null);
      setError(null);
      setEmailInvalid(false);
      setAgreed(false);
      setTermsInvalid(false);
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
    if (!email.trim() || !emailRef.current?.validity.valid) {
      setEmailInvalid(true);
      setError('Please enter a valid email address');
      // Focus lands on the field the error is about, not on the Buy button
      // three cards away from it.
      emailRef.current?.focus();
      return;
    }

    // Checked here for the buyer's sake; the checkout route refuses it too.
    if (!agreed) {
      setTermsInvalid(true);
      setError('Agree to the Terms of Service to continue.');
      termsRef.current?.focus();
      return;
    }

    setEmailInvalid(false);
    setTermsInvalid(false);
    setLoading(pack);
    setError(null);
    Analytics.checkoutStarted(pack);

    try {
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // The version shown beside the box, so the route can refuse a tab
        // that has been open across a terms update.
        body: JSON.stringify({
          email: email.trim(),
          pack,
          acceptTerms: agreed,
          termsVersion: TERMS_VERSION,
        }),
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
   * The smallest pack that both ACCEPTS this list and covers what it is
   * expected to resolve.
   *
   * Headroom alone was the old rule, and it made the card contradict itself.
   * The buyer is blocked on wallets submitted and billed on matches, so a pack
   * can accept a file and then run out of credits inside it. A 13,294-wallet
   * list, the largest job ever run, was marked "Fits your list" on Campaign
   * while that same card said "≈ 6,300 wallets" two lines below. Somebody who
   * trusted the badge paid $99, resolved 1,500 matches, and met the match gate
   * with most of their file still locked.
   *
   * So headroom stays as the floor and expected matches join it as the test.
   * The estimate uses the same constant `approxWallets` already prints on every
   * card, in the opposite direction, so the badge and the wallet count beneath
   * it can no longer disagree.
   */
  const expectedMatches = walletCount
    ? Math.ceil(walletCount * MEASURED_MATCH_RATE)
    : 0;
  const fitting: PackId | undefined = walletCount
    ? PACK_IDS.find(
        (id) =>
          PACKS[id].matches * SUBMISSION_MULTIPLIER >= walletCount &&
          PACKS[id].matches >= expectedMatches
      )
    : undefined;
  /**
   * Falling through to the largest pack is still the honest answer when
   * nothing fits, but it must not then claim to fit. `fitting` being undefined
   * is what the badge below reads to say "Closest fit" instead.
   */
  const suggested: PackId = walletCount
    ? (fitting ?? PACK_IDS[PACK_IDS.length - 1])
    : DEFAULT_SUGGESTION;

  const chosen = selected ?? suggested;
  const chosenPack = PACKS[chosen];

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent
        className="max-w-4xl"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          selectedPackRef.current?.focus();
        }}
        footer={
          <form
            className="space-y-3"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              if (!loading) void handleBuy(chosen);
            }}
          >
            <div className="space-y-2">
              <label
                htmlFor="buy-credits-email"
                className="text-sm font-medium"
              >
                Email for your credits and receipt
              </label>
              <Input
                ref={emailRef}
                id="buy-credits-email"
                type="email"
                name="email"
                required
                autoComplete="email"
                spellCheck={false}
                placeholder="you@example.com"
                value={email}
                disabled={loading !== null}
                aria-invalid={emailInvalid || undefined}
                aria-describedby={
                  error
                    ? 'buy-credits-error buy-credits-note'
                    : 'buy-credits-note'
                }
                onChange={(event) => {
                  setEmail(event.target.value);
                  setEmailInvalid(false);
                  if (error) setError(null);
                }}
              />
            </div>
            {/* The agreement sits between the address and the button, so it is
                read, and reached by Tab, before the step that takes money. */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    ref={termsRef}
                    id="buy-credits-terms"
                    type="checkbox"
                    name="acceptTerms"
                    required
                    checked={agreed}
                    disabled={loading !== null}
                    aria-invalid={termsInvalid || undefined}
                    aria-describedby={error ? 'buy-credits-error' : undefined}
                    onChange={(event) => {
                      setAgreed(event.target.checked);
                      setTermsInvalid(false);
                      if (error) setError(null);
                    }}
                    className="h-4 w-4 flex-none"
                  />
                  <span>
                    I agree to the{' '}
                    <a
                      href={TERMS_PATH}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent-brand underline underline-offset-4"
                    >
                      Terms of Service
                    </a>
                  </span>
                </label>
                {/* The privacy policy is a notice, not something anybody
                    agrees to, so it is a line of its own and not part of the
                    label: ticking the box agrees to the terms and nothing
                    else. Indented to the label's text, past the box and its
                    gap. */}
                <p className="pl-6 text-xs text-muted-foreground">
                  Our{' '}
                  <a
                    href={PRIVACY_PATH}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent-brand underline underline-offset-4"
                  >
                    Privacy Policy
                  </a>{' '}
                  says how we use your data.
                </p>
              </div>
              <Button
                type="submit"
                disabled={loading !== null}
                className="w-full sm:w-auto sm:min-w-48"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    Opening checkout…
                  </>
                ) : (
                  <>
                    Continue · {price(chosenPack.priceCents)}
                    <ArrowRight className="h-4 w-4" aria-hidden />
                  </>
                )}
              </Button>
            </div>
            {error && (
              <div id="buy-credits-error">
                <InlineError>{error}</InlineError>
              </div>
            )}
            <p id="buy-credits-note" className="text-xs text-muted-foreground">
              {chosenPack.name} · {chosenPack.matches.toLocaleString()} matches.
              Card details come next, on Stripe.
            </p>
          </form>
        }
      >
        <ModalHeader className="flex-none pr-6">
          <ModalTitle className="text-2xl font-light tracking-[var(--tracking-title)]">
            Choose a credit pack
          </ModalTitle>
          <ModalDescription>
            <span className="font-medium text-foreground">
              1 match = 1 wallet
            </span>{' '}
            linked to a {X_IN_COPY} or Farcaster account. Only pay for matches.
            Misses are free.
          </ModalDescription>
        </ModalHeader>

        <div className="space-y-4">
          <ul className="grid grid-cols-3 divide-x divide-border rounded-lg bg-fill-well py-3">
            {[
              { icon: Receipt, title: 'One-time', detail: 'purchase' },
              {
                icon: Prohibit,
                title: 'No subscription',
                detail: 'No recurring fees',
              },
              {
                icon: CalendarBlank,
                title: `${CREDIT_LIFETIME_MONTHS} months`,
                detail: 'to use your credits',
              },
            ].map(({ icon: Icon, title, detail }) => (
              <li
                key={title}
                className="flex flex-col items-center gap-2 px-2 text-center sm:flex-row sm:justify-center sm:gap-3 sm:px-4 sm:text-left"
              >
                <Icon
                  className="h-5 w-5 flex-none text-accent-brand"
                  aria-hidden
                />
                <span className="text-xs">
                  <span className="block font-medium text-foreground">
                    {title}
                  </span>
                  <span className="block text-muted-foreground">{detail}</span>
                </span>
              </li>
            ))}
          </ul>

          {walletCount ? (
            <p className="rounded-lg bg-accent-brand-tint p-3 text-sm">
              Your list:{' '}
              <strong className="font-medium tabular-nums">
                {walletCount.toLocaleString()} wallets
              </strong>
              .{' '}
              {fitting
                ? `${PACKS[suggested].name} covers the estimated matches.`
                : 'Our largest pack is the closest fit; your list may need more credits or smaller batches.'}
            </p>
          ) : null}

          <fieldset disabled={loading !== null}>
            <legend className="sr-only">Select a credit pack</legend>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {PACK_IDS.map((id) => {
                const pack = PACKS[id];
                const PackIcon = PACK_ICON[id];
                const isSelected = chosen === id;
                const saving = savingsVsSmallestPack(id);
                return (
                  <label
                    key={id}
                    className={cn(
                      'relative flex cursor-pointer flex-col rounded-lg border p-4 transition-control focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring',
                      isSelected
                        ? 'border-accent-brand bg-accent-brand-tint'
                        : 'border-input hover:bg-fill-subtle',
                      loading !== null && 'cursor-wait'
                    )}
                  >
                    <input
                      type="radio"
                      ref={isSelected ? selectedPackRef : undefined}
                      name="credit-pack"
                      value={id}
                      checked={isSelected}
                      onChange={() => setSelected(id)}
                      className="sr-only"
                    />
                    <span className="mb-3 flex min-h-4 items-center justify-between gap-2 text-xs">
                      <span
                        className={
                          id === suggested
                            ? 'text-accent-brand'
                            : 'text-muted-foreground'
                        }
                      >
                        {id === suggested
                          ? !walletCount
                            ? 'Recommended'
                            : fitting
                              ? 'Fits your list'
                              : 'Closest fit'
                          : saving > 0
                            ? `Save ${saving}%`
                            : 'Start small'}
                      </span>
                      <span
                        aria-hidden="true"
                        className={cn(
                          'flex h-4 w-4 flex-none items-center justify-center rounded-full border',
                          isSelected
                            ? 'border-accent-brand bg-accent-brand text-accent-brand-foreground'
                            : 'border-input'
                        )}
                      >
                        {isSelected && <Check className="h-3 w-3" />}
                      </span>
                    </span>
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <span
                        className={cn(
                          'flex h-7 w-7 flex-none items-center justify-center rounded-sm transition-control',
                          isSelected
                            ? 'bg-accent-brand text-accent-brand-foreground'
                            : 'bg-accent-brand-tint text-accent-brand'
                        )}
                      >
                        <PackIcon className="h-4 w-4" aria-hidden />
                      </span>
                      {pack.name}
                    </span>
                    <span className="mt-2 text-3xl font-extralight tabular-nums tracking-[var(--tracking-title)]">
                      {price(pack.priceCents)}
                    </span>
                    <span className="mt-4 text-sm font-semibold tabular-nums">
                      {pack.matches.toLocaleString()} matches
                    </span>
                    <span className="mt-1 text-xs tabular-nums text-muted-foreground">
                      {centsPerMatch(id).toFixed(1)}¢ / match
                    </span>
                    <span className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
                      {pack.fits}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="space-y-2 text-xs text-muted-foreground">
            <p>
              <span className="font-medium text-foreground">
                {chosenPack.matches.toLocaleString()} matches
              </span>{' '}
              cover approximately {approxWallets(chosenPack.matches)} wallets at
              our measured {(MEASURED_MATCH_RATE * 100).toFixed(1)}% match rate.
              Your results will vary.
            </p>
            <p className="min-h-4 text-attested">
              {savingsVsSmallestPack(chosen) > 0
                ? `${savingsVsSmallestPack(chosen)}% less per match than Trial.`
                : 'Our smallest pack. Same full toolkit.'}
            </p>
          </div>

          <details className="group rounded-lg bg-fill-well">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-4 text-sm font-medium [&::-webkit-details-marker]:hidden">
              <span>Every pack includes the full toolkit</span>
              <CaretDown
                className="h-4 w-4 flex-none transition-transform group-open:rotate-180"
                aria-hidden
              />
            </summary>
            <ul className="grid gap-x-6 gap-y-2 px-4 pb-4 text-sm text-muted-foreground sm:grid-cols-2">
              {INCLUDED.filter((item) => item.key !== 'expiry').map((item) => (
                <li key={item.key} className="flex items-start gap-2">
                  <Check
                    className="mt-0.5 h-4 w-4 flex-none text-attested"
                    aria-hidden
                  />
                  <span>{item.label}</span>
                </li>
              ))}
            </ul>
          </details>
        </div>
      </ModalContent>
    </Modal>
  );
}
