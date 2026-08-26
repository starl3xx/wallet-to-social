# Product Marketing Context

**Document version:** v3
**Last updated:** 2026-08-22

Every figure here is verified: coverage numbers come from `lib/public-figures.ts` (checked by `scripts/check-published-figures.ts`), prices from `lib/packs.ts`. Do not quote a number that is not in those files.

## Product Overview

**One-liner:** Turn wallet addresses into the people behind them, and reach them where they already are.
**What it does:** walletlink.social resolves Ethereum wallet addresses to the X and Farcaster accounts of their owners, against a 4.8 million wallet identity index. Upload a holder list (CSV, contract address, or paste) and get back reachable people, ranked by holdings times follower reach, exportable as CSV or an X list. It also runs backwards: an X handle or Farcaster username returns the wallets attached to that person.
**Product category:** wallet-to-social resolution; the shelf buyers search is "token holder outreach" and "wallet to Twitter".
**Product type:** self-serve SaaS web app plus a REST API (API access comes with every pack, same credits).
**Business model:** one-time credit packs, metered in matches (a wallet resolved to an X or Farcaster account; misses cost nothing). No subscriptions. Free is 100 matches per rolling 30 days. Credits last 12 months. Packs: Trial $29 / 250 matches, Campaign $99 / 1,500, Scale $299 / 6,000, Index $899 / 25,000.
**Refund policy (decided 2026-08-22): no guarantees and no refunds.** The risk reversal is the free allowance (prove your match rate before paying) plus misses costing nothing. State the policy plainly when asked; never propose guarantee or refund offers.

## Target Audience

**Target companies:** crypto-native teams from solo founder to about 20 people: NFT projects, token and protocol teams, DAOs, web3 marketing agencies.
**Decision-makers:** growth or community lead (daily user and champion); founder (decision maker and payer, often the same person at this size).
**Primary use case:** turn a holder or contract list into people you can actually message for a campaign.
**Jobs to be done:**

- Announce something to our holders where they already are, without an address list being a dead end.
- Find who the whales behind these wallets are and reach the ones with an audience.
- Check whether a person (handle) already holds our token before a partnership or airdrop.
  **Use cases:** token launch outreach, holder win-back, allowlist and airdrop targeting, whale identification, competitor-holder poaching, reverse lookup before a partnership.

## Personas

| Persona               | Cares about                        | Challenge                                   | Value we promise                                      |
| --------------------- | ---------------------------------- | ------------------------------------------- | ----------------------------------------------------- |
| Growth/community lead | Campaign reach, not wasting a send | Holder lists are addresses, not people      | The reachable subset, ranked, with evidence per match |
| Founder (payer)       | ROI per campaign dollar            | Tools bill monthly for occasional campaigns | Pay once per campaign; misses are free                |

## Problems & Pain Points

**Core problem:** a wallet list is the audience you already earned, and you cannot talk to it. Addresses have no inbox.
**Why alternatives fall short:**

- Coverage tools quote one flattering number and hide the difference between "has an identity" and "reachable".
- Matches are often inferred from bios, display names, or timing, so campaigns hit the wrong people.
- Subscription pricing punishes teams that run campaigns occasionally.
  **What it costs them:** campaign budget spent on dead or wrong handles; launches announced into the void; whales never identified.
  **Emotional tension:** the fear of messaging the wrong person publicly, and the quiet suspicion that the coverage number they were sold was never real.

## Competitive Landscape

**Direct:** Addressable, Cookie3, Formo, Holder (see `app/vs/*` for the maintained claim-by-claim comparisons; Blaze and Airstack are retired and documented as such).
**Secondary:** general web3 analytics (Dune-style dashboards): they describe wallets, they do not connect you to owners.
**Indirect:** doing it by hand: Etherscan plus X search plus a spreadsheet. Works for ten wallets, not ten thousand.

## Differentiation

**Key differentiators:**

- Complete Farcaster coverage: every account and its addresses, refreshed daily. Matching is deterministic, so a miss is real information.
- Attested-first X handles: over 99.9% published by the account owner (Farcaster verification or onchain ENS record), labelled always, never inferred from bios or timing.
- Reachability on every match: of 448,069 X handles resolved, 69.6% are live, 20.6% suspended, 9.7% names nobody holds. Each match says which.
- Honest two-number coverage: any-identity vs X-or-Farcaster, stated per chain (Base 46.2%, Ethereum 16.6%; typical tools publish low single digits).
- Reverse lookup: handle to wallets, the question most wallet tooling cannot answer.
  **How we do it differently:** coverage would be higher if we guessed. We do not guess.
  **Why that's better:** contacting the wrong person is worse than contacting fewer people.
  **Why customers choose us:** the match count they get is the match count that is real, and it costs a pack, not a subscription.

## Objections

| Objection                    | Response                                                                                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Only 16% on Ethereum?"      | That is the honest number; typical tools publish low single digits, and tools quoting more are counting identities you cannot message. Base runs 46.2%.             |
| "Is this data fresh?"        | Farcaster refreshes daily; every match carries a reachability state checked against the live account.                                                               |
| "Is holder outreach spammy?" | You are announcing to people who already bought your token, on channels they publish publicly. The evidence class on each match shows the owner published the link. |

**Anti-persona:** mass-DM spammers and anyone targeting people with no relationship to their token. Also: a team with a 50-wallet list; free covers them, and that is fine.

## Switching Dynamics

**Push:** flattering coverage numbers that do not survive a real campaign; monthly bills for occasional use.
**Pull:** verified coverage, per-match evidence, pay-per-campaign packs.
**Habit:** an existing analytics subscription, or the founder's spreadsheet method.
**Anxiety:** "will my chain have enough matches to be worth it?" Answer: misses cost nothing, and the free 100 matches proves the rate on your own list before you pay.

## Customer Language

**How they describe the problem:** (gap: no recorded verbatim quotes yet; collect from support mail at help@walletlink.social and X replies)
**Words to use:** holders, reachable, attested, evidence, match, onchain (one word, always).
**Words to avoid:** provider names (never name a data source anywhere public); "all", "every", "complete" unless the figure is in `lib/public-figures.ts`; "on-chain"; inferred-match language ("probably", "likely their account"); em dashes.
**Glossary:**
| Term | Meaning |
|------|---------|
| Match | A wallet resolved to an X handle or Farcaster account; the billing unit |
| Attested | The account owner published the wallet link themselves |
| Evidence class | The public label for how a match was established (onchain, farcaster, manual, aggregated) |
| Reachability | Whether a resolved X handle is live, suspended, or not held |

## Brand Voice

**Tone:** honest to the point of being disarming; precise; quietly confident. The README section is titled "Coverage, stated honestly" and that is the brand.
**Style:** direct, concrete, numbers over adjectives; short sentences; sentence case headings; curly apostrophes in UI.
**Personality:** honest, measured, technical, unhyped, dry.

## Proof Points

**Metrics:** 4.8M wallet index; complete Farcaster coverage (4.7M wallets), refreshed daily; 448,069 X handles resolved; up to 46.2% match rate on Base, many times what typical tools publish. Never cite a numeric industry average: the old ~2.5%/9x figure had no source and was purged 2026-08-22.
**Customers:** (gap: none citable yet)
**Testimonials:** (gap: none yet; the first paying customers should be asked)
**Value themes:**
| Theme | Proof |
|-------|-------|
| Honesty | Two-number coverage, per-chain figures, reachability breakdown published |
| Completeness where it is possible | Farcaster coverage complete and verified against production |
| Evidence | Every match labelled with its evidence class and reachability |

## Goals

**Business goal:** first paying customers; the dataset is the moat, revenue proves the wedge.
**Conversion action:** buy a credit pack (most plausibly Trial $29 after a free lookup shows real matches).
**Current metrics (2026-08-22):** ~100 signups, 0 paid, traffic is the bottleneck; last human lookup 2026-07-30.

## Changelog

_Newest first. One line per revision: what changed and why._

- v3 (2026-08-22) — Purged the uncited ~2.5% industry-average / 9x claim from coverage, objections and metrics; comparisons now use measured figures or stay qualitative.
- v2 (2026-08-22) — Recorded Jake's refund decision: no guarantees, no refunds; the free allowance plus free misses is the risk reversal.
- v1 (2026-08-22) — Initial context, auto-drafted from README, lib/public-figures.ts, lib/packs.ts, and the /vs pages. Gaps flagged: verbatim customer language, testimonials.
