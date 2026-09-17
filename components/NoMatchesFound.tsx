'use client';

import Link from 'next/link';
import { Button, FOCUS_RING } from '@/components/ui/button';
import {
  CHAIN_MATCH_RATES,
  CHAIN_MATCH_RATES_MEASURED_ON,
} from '@/lib/public-figures';

/**
 * What a lookup that matched nothing says for itself.
 *
 * ## Why this exists
 *
 * A list that resolved to zero rendered the ordinary results screen: a hero
 * reading "0 found of 500 wallets · 0.0%" over a table of dashes, and nothing
 * else. Every word on that screen was accurate and the reader was left to
 * draw the only conclusion available to them, which is that the product does
 * not work.
 *
 * It is the single worst moment in the funnel to say nothing, because it is
 * the one where somebody decides whether to come back. A miss is a fact about
 * the wallets rather than a failure of the lookup, and the product knows why
 * it happens; it simply never said so on the screen where it matters.
 *
 * ## Why it leads with the chain
 *
 * Because that is the answer, and it is measured rather than reassuring.
 * Holders on Base carry an X or Farcaster account roughly three times as
 * often as holders on Ethereum, and a whole list coming back empty is far
 * more often a list from a low-attestation community than a broken index.
 * Telling somebody their list was the wrong shape is more useful, and more
 * respectful, than telling them to try again.
 *
 * The figures come from `lib/public-figures.ts` and are derived here rather
 * than typed, so a re-measure moves this copy with it. That is the failure
 * mode that file exists to prevent, and hand-typing a rate into a component
 * is exactly how a surface gets left behind.
 *
 * ## What it refuses to say
 *
 * No apology, and no suggestion that a retry will help: the same list run
 * again returns the same answer, and saying otherwise would spend somebody's
 * free allowance to prove it. The two actions offered are the two that can
 * actually return something different, and both are free.
 */

const BEST = CHAIN_MATCH_RATES.base;
const WORST = CHAIN_MATCH_RATES.ethereum;

export function NoMatchesFound({ total }: { total: number }) {
  return (
    <div className="rounded-lg border border-border bg-surface-raised p-6">
      <p className="text-base font-semibold">
        No X or Farcaster account for any of these{' '}
        <span className="tabular-nums">{total.toLocaleString()}</span> wallets.
      </p>
      <p className="mt-2 max-w-[68ch] text-sm text-muted-foreground">
        That is usually a fact about the list rather than a failure of the
        lookup. Nothing here is guessed from a bio, a display name or a
        transaction pattern, so a wallet whose owner never published an account
        returns nothing, and a list of such wallets returns nothing at all.
      </p>
      <p className="mt-3 max-w-[68ch] text-sm text-muted-foreground">
        The chain usually decides it. Measured on{' '}
        {CHAIN_MATCH_RATES_MEASURED_ON} across{' '}
        <span className="tabular-nums">{BEST.holders.toLocaleString()}</span>{' '}
        Base holders and{' '}
        <span className="tabular-nums">{WORST.holders.toLocaleString()}</span>{' '}
        Ethereum holders,{' '}
        <span className="tabular-nums">{BEST.either_pct}</span>% of the Base set
        had an X or Farcaster account against{' '}
        <span className="tabular-nums">{WORST.either_pct}</span>% of the
        Ethereum set. Base is where Farcaster lives. A list from a
        low-attestation community can legitimately come back empty.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button asChild variant="soft" size="sm">
          <Link href="/check">Start from a handle instead</Link>
        </Button>
        <p className="text-xs text-muted-foreground">
          Or{' '}
          <Link
            href="/#starter-collections"
            className={`underline underline-offset-2 ${FOCUS_RING}`}
          >
            run a collection we have already indexed
          </Link>{' '}
          to see what a matching list looks like. Both are free.
        </p>
      </div>
    </div>
  );
}
