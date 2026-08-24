import {
  PACKS,
  PACK_IDS,
  FREE_MATCHES_PER_WINDOW,
  FREE_WINDOW_DAYS,
  CREDIT_LIFETIME_MONTHS,
} from '@/lib/packs';
import { CHAIN_COUNT_WORD } from '@/lib/public-figures';

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
 *
 * ## The surface
 *
 * One inset panel: `bg-muted` at full token opacity behind the one hairline.
 * This sat on `bg-muted/30` with no border while the claim beside it used
 * `bg-muted/40` with one and the blog CTA used `bg-muted/50`, four fills for
 * one meaning. The token is already theme-aware, and a wash whose contrast
 * depends on what is behind it is the same mistake the control boundary
 * made. The competitor tier block on each page takes this same string.
 */
export function PackPricing() {
  return (
    <div className="rounded-lg border border-border bg-muted p-6">
      <h3 className="mb-1 font-semibold">walletlink.social</h3>
      <p className="mb-4 text-sm text-muted-foreground">
        You are charged for matches, not for wallets. A match is a wallet we
        resolve to an X or Farcaster account; a wallet we cannot resolve costs
        nothing.
      </p>

      {/* The prices take the hero figure treatment from `Figure`: weight 200 at
          title tracking, tabular so the column of dollar signs lines up. They
          were `font-bold`, which is 700 and not one of the five weights the
          scale defines; the upgrade modal had already dropped it for the same
          figure. Not the `Figure` component itself, because that puts the
          caption under the figure and a price sheet names the pack above it.

          Five tiles step two, three, five across. Below `sm` this stacked the
          five packs one per row, about 600px of scroll on a phone for a strip
          that reads in one glance two-across. A tile's label wraps and the
          tile grows, so the grid of text can step at `xs` (360px) where a
          grid of controls could not; `sm` brings the fifth column in at the
          width the reading column already gives it. */}
      <div className="grid grid-cols-2 gap-4 text-sm xs:grid-cols-3 sm:grid-cols-5">
        <div>
          <p className="text-muted-foreground">Free</p>
          <p className="text-2xl font-extralight tabular-nums tracking-[var(--tracking-title)]">
            $0
          </p>
          <p className="text-muted-foreground">
            {FREE_MATCHES_PER_WINDOW} matches in a rolling {FREE_WINDOW_DAYS}
            -day window
          </p>
        </div>
        {PACK_IDS.map((id) => (
          <div key={id}>
            <p className="text-muted-foreground">{PACKS[id].name}</p>
            <p className="text-2xl font-extralight tabular-nums tracking-[var(--tracking-title)]">
              ${PACKS[id].priceCents / 100}
            </p>
            <p className="text-muted-foreground">
              {PACKS[id].matches.toLocaleString()} matches, once
            </p>
          </div>
        ))}
      </div>

      <p className="mt-4 text-sm text-muted-foreground">
        Every pack carries all {CHAIN_COUNT_WORD} chains, uncapped CSV export,
        API and MCP access on the same credits, reverse lookup, Farcaster DMs,
        and X reachability on every match. Credits last {CREDIT_LIFETIME_MONTHS}{' '}
        months. No subscription.
      </p>
    </div>
  );
}
