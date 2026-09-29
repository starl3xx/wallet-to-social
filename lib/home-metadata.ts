/**
 * The homepage's search-result title and description.
 *
 * They live here rather than as literals in `app/layout.tsx` for one reason:
 * the layout cannot be imported outside Next. It calls `next/font` at module
 * load and imports a stylesheet, so a check that wants the evaluated strings,
 * with the figures interpolated, has nothing to import there.
 * `scripts/check-invariants.ts` imports these and measures them, beside the
 * `metadata` export of every static page.
 *
 * ## The lengths are the point
 *
 * The title was 88 characters and the description 214 on 2026-09-27, so a
 * search result showed neither whole. Google cuts a title at about 600 pixels,
 * which is 60 to 65 characters of ordinary text, and a description at about
 * 160 characters. The invariant holds every static page to 65 and 160.
 *
 * The title leads with the query words and ends with the brand, because the
 * start of a title is the part that survives a cut.
 */
import { CHAIN_COUNT_WORD, INDEXED_WALLETS } from '@/lib/public-figures';

export const HOME_TITLE =
  'Wallet to Twitter (X) and Farcaster lookup | walletlink.social';

export const HOME_DESCRIPTION = `Turn wallet addresses into the X (Twitter) and Farcaster accounts behind them, across ${CHAIN_COUNT_WORD} EVM chains, from a ${INDEXED_WALLETS}-wallet index. No sales calls.`;

/** The limits the invariant enforces, named once so the prose can cite them. */
export const TITLE_MAX_CHARS = 65;
export const DESCRIPTION_MAX_CHARS = 160;
