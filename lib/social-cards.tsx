/**
 * The social card registry: one on-brand 1200x675 image per daily post,
 * rendered live by `app/social-card/[slug]/route.tsx`.
 *
 * ## Why the cards are a route and not files
 *
 * "Prefer a source over a snapshot" (the figures doctrine) applies to media
 * as hard as it applies to copy: a PNG checked into the repo carries the
 * figure of the day it was rendered, forever. A card rendered at request
 * time reads `lib/public-figures.ts` at request time, so the image a cast
 * embeds next Tuesday shows next Tuesday's constants. The X pipeline
 * downloads these same URLs once at scheduling time, which is a snapshot,
 * but a dated one taken minutes before the schedule is set, not weeks.
 *
 * ## The design contract
 *
 * Cards are Satori-rendered (flexbox only, no grid, no CSS custom
 * properties) in Soehne at 200/400/600 on the OG palette
 * (`lib/og-fonts.ts`), which the og-palette guard already covers. Colour
 * semantics are the product's law: violet marks the brand and affordances,
 * green appears ONLY behind a measured fact (`statTone: 'attested'`), the
 * same rule the app enforces. Plain X, never the U+1D54F glyph: Satori has
 * no fallback chain (the share-card lesson).
 *
 * Three variants, chosen per card and nothing else configurable:
 * - `stat`: one big figure dominates, headline beneath
 * - `claim`: the headline dominates, no figure
 * - `split`: two figures side by side
 *
 * Every figure printed here interpolates a constant from
 * `lib/public-figures.ts` or `lib/packs.ts`; a hand-typed figure literal in
 * this file is a bug (`scripts/check-social-queue.ts` greps for it). The two
 * approximate rates are the named exception, marked `literal-ok`: they are
 * the same rounded pair the OG share card publishes, and the figures
 * registry guards that pairing.
 */

import {
  INDEXED_WALLETS,
  FARCASTER_WALLETS,
  X_HANDLES_RESOLVED,
  X_LIVE_PCT,
  X_SUSPENDED_PCT,
  X_UNCLAIMED_PCT,
  X_UNREACHABLE_PCT,
  KNOWN_AGENTS,
} from '@/lib/public-figures';
import {
  FREE_MATCHES_PER_WINDOW,
  FREE_WINDOW_DAYS,
  CREDIT_LIFETIME_MONTHS,
} from '@/lib/packs';

/** The Farcaster wallet figure at stat-tile size; derived, never typed. */
const FARCASTER_WALLETS_SHORT = FARCASTER_WALLETS.replace(' million', 'M');

export interface SocialCard {
  variant: 'stat' | 'claim' | 'split';
  /** Small quiet line above the headline. */
  kicker: string;
  /** Display line, 200 weight, with one 600-weight emphasis word. */
  headline: string;
  /** The word inside `headline` that takes weight 600. */
  emphasisWord?: string;
  stat?: string;
  statLabel?: string;
  stat2?: string;
  stat2Label?: string;
  /** One supporting line under the headline or stats. */
  sub?: string;
  /** The CTA footer, written as visible text. */
  cta: string;
  /** green ONLY for a measured fact; violet for brand; plain otherwise. */
  statTone?: 'brand' | 'attested' | 'plain';
}

export const SOCIAL_CARDS: Record<string, SocialCard> = {
  'dead-handles': {
    variant: 'split',
    kicker: 'X handle states, resolved against X itself',
    headline: 'nearly a third reach nobody',
    emphasisWord: 'nobody',
    stat: `${X_LIVE_PCT}%`,
    statLabel: 'still live',
    stat2: `${X_UNREACHABLE_PCT}%`,
    stat2Label: 'reach nobody',
    sub: `${X_SUSPENDED_PCT}% suspended, ${X_UNCLAIMED_PCT}% unclaimed, across ${X_HANDLES_RESOLVED} distinct X handles`,
    cta: 'check a handle free · walletlink.social/check',
    statTone: 'attested',
  },
  hyperevm: {
    variant: 'claim',
    kicker: 'chain eight · HyperEVM',
    headline: 'nothing indexes it, so we read the contract',
    emphasisWord: 'contract',
    sub: 'owner by owner, NFT collections only for now, complete or we refuse to answer',
    cta: 'read the story · walletlink.social/blog/hyperevm-no-holder-index',
    statTone: 'plain',
  },
  'reverse-lookup': {
    variant: 'claim',
    kicker: 'reverse lookup',
    headline: 'paste a handle, get the wallets behind it',
    emphasisWord: 'wallets',
    sub: 'every address the owner published, attested, never guessed',
    cta: 'try it · walletlink.social',
    statTone: 'plain',
  },
  'x402-agent-rail': {
    variant: 'stat',
    kicker: 'the agent rail · x402',
    headline: 'an agent can buy its own access',
    emphasisWord: 'own',
    stat: '$1',
    statLabel: 'in USDC on Base buys 12 matches',
    sub: 'no account, no card, no email',
    cta: 'see what agents build · walletlink.social/blog/nine-things-to-build',
    statTone: 'brand',
  },
  'free-tier': {
    variant: 'stat',
    kicker: 'the free tier',
    headline: 'misses cost nothing',
    emphasisWord: 'nothing',
    stat: String(FREE_MATCHES_PER_WINDOW),
    statLabel: `matches per rolling ${FREE_WINDOW_DAYS} days, free`,
    sub: 'a wallet we cannot resolve is never billed',
    cta: 'start free · walletlink.social',
    statTone: 'brand',
  },
  'holder-reports': {
    variant: 'claim',
    kicker: 'holder reports',
    headline: 'the people behind a collection',
    emphasisWord: 'people',
    sub: 'per-collection pages of holders whose accounts still exist, measured daily',
    cta: 'browse the reports · walletlink.social/holders',
    statTone: 'plain',
  },
  'attested-vs-inferred': {
    variant: 'claim',
    kicker: 'how the index is built',
    headline: 'published by the owner, never guessed',
    emphasisWord: 'owner',
    sub: 'Farcaster verifications, onchain ENS records, attested sign-ins, nothing read off a bio',
    cta: 'see how it works · walletlink.social',
    statTone: 'plain',
  },
  'mcp-oauth': {
    variant: 'claim',
    kicker: 'MCP + OAuth',
    headline: 'sign in once, paste nothing',
    emphasisWord: 'once',
    sub: 'Claude and Cursor connect over OAuth, no key ever touches a chat',
    cta: 'connect your tools · docs.walletlink.social/mcp-server',
    statTone: 'plain',
  },
  'filter-agents': {
    variant: 'stat',
    kicker: 'before the airdrop',
    headline: 'know which claimants are agents',
    emphasisWord: 'agents',
    stat: `${KNOWN_AGENTS}+`,
    statLabel: 'known AI agent wallets flagged',
    sub: 'filter them out before you send, not after',
    cta: 'read the guide · walletlink.social/blog/filter-agents-before-airdrop',
    statTone: 'attested',
  },
  'farcaster-coverage': {
    variant: 'stat',
    kicker: 'network coverage',
    headline: 'Farcaster coverage is complete',
    emphasisWord: 'complete',
    stat: FARCASTER_WALLETS_SHORT,
    statLabel: 'wallets carry a Farcaster identity',
    sub: 'paste a list, see who is there',
    cta: 'look your list up · walletlink.social',
    statTone: 'attested',
  },
  'matches-not-wallets': {
    variant: 'claim',
    kicker: 'pricing',
    headline: 'you pay for found people only',
    emphasisWord: 'found',
    sub: `a match is a wallet resolved to an X or Farcaster account, credits last ${CREDIT_LIFETIME_MONTHS} months, no subscription`,
    cta: 'see the packs · walletlink.social/pricing',
    statTone: 'plain',
  },
  'two-rates': {
    variant: 'split',
    kicker: 'match rates',
    headline: 'we keep the two numbers apart',
    emphasisWord: 'apart',
    // The OG share card publishes this same rounded pair, and the figures
    // registry guards it; there is no constant for a deliberate blur.
    stat: '~23%', // literal-ok
    statLabel: 'carry any identity',
    stat2: '~13%', // literal-ok
    stat2Label: 'have an X or Farcaster account',
    sub: 'plan a campaign against the second, never the first',
    cta: 'see the method · walletlink.social',
    statTone: 'attested',
  },
  'priority-score': {
    variant: 'claim',
    kicker: 'priority score',
    headline: 'who to talk to first',
    emphasisWord: 'first',
    sub: 'holdings times follower reach, one sortable score per wallet',
    cta: 'read the formula · walletlink.social/blog/priority-score-formula',
    statTone: 'plain',
  },
  'eight-chains': {
    variant: 'stat',
    kicker: 'one index',
    headline: 'eight chains, one answer',
    emphasisWord: 'one',
    stat: INDEXED_WALLETS,
    statLabel: 'wallets indexed',
    sub: 'Ethereum, Base, Robinhood, Arbitrum, Polygon, Optimism, BNB, HyperEVM',
    cta: 'start with your list · walletlink.social',
    statTone: 'attested',
  },
};
