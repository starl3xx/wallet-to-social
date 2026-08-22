import {
  PACKS,
  PACK_IDS,
  FREE_MATCHES_PER_WINDOW,
  FREE_WINDOW_DAYS,
} from '@/lib/packs';

/**
 * Our price list, on the comparison pages.
 *
 * ## Why this is a component and not five pricing blocks
 *
 * The same reason as `ReachabilityClaim`: it belongs on all five `/vs/` pages
 * and it contains numbers. Five copies would be five places to update and four
 * places to forget, which is the exact failure that had the homepage saying
 * 4.8M while the docs said 4.9M.
 *
 * It reads `lib/packs.ts`, so the price sheet, the upgrade modal, the checkout
 * and the schema.org offers cannot disagree. Before this, each page hardcoded a
 * pricing section next to an interpolated `TIER_PRICES`, so half the numbers
 * moved when the constants moved and half did not.
 *
 * ## What it deliberately does not do
 *
 * No competitor column. Each page states the competitor's prices itself, with
 * the date they were read, because a competitor's price sheet goes stale
 * without anything failing and the date has to sit beside the number it
 * qualifies.
 */
export function PackPricing() {
  return (
    <div className="rounded-lg bg-muted/30 p-6">
      <h3 className="mb-1 font-semibold">walletlink.social</h3>
      <p className="mb-4 text-sm text-muted-foreground">
        You are charged for matches, not for wallets. A match is a wallet we
        resolve to an 𝕏 or Farcaster account; a wallet we cannot resolve costs
        nothing.
      </p>

      <div className="grid gap-4 text-sm sm:grid-cols-3 lg:grid-cols-5">
        <div>
          <p className="text-muted-foreground">Free</p>
          <p className="text-2xl font-bold tabular-nums">$0</p>
          <p className="text-muted-foreground">
            {FREE_MATCHES_PER_WINDOW} matches every {FREE_WINDOW_DAYS} days
          </p>
        </div>
        {PACK_IDS.map((id) => (
          <div key={id}>
            <p className="text-muted-foreground">{PACKS[id].name}</p>
            <p className="text-2xl font-bold tabular-nums">
              ${PACKS[id].priceCents / 100}
            </p>
            <p className="text-muted-foreground">
              {PACKS[id].matches.toLocaleString()} matches, once
            </p>
          </div>
        ))}
      </div>

      <p className="mt-4 text-sm text-muted-foreground">
        Every pack carries all seven chains, uncapped CSV export, API access on
        the same credits, reverse lookup, and 𝕏 reachability on every match.
        Credits last 12 months. No subscription.
      </p>
    </div>
  );
}
