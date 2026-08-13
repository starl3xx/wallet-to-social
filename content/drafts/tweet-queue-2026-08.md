# Tweet Queue — Aug 13 to Sep 14, 2026

**Account:** @walletlinkETH
**Social Set ID:** 278688
**Schedule:** Mon–Fri, 12pm + 5pm CT + two off-schedule slots
**Status:** SCHEDULED in Typefully — 47 posts, Aug 13 → Sep 14, zero collisions

> **2026-08-12 dataset-milestone update (synced to Typefully):** the social graph
> grew from ~5k to 4.7M wallets (the complete Farcaster protocol). Six posts updated
> and two added to reflect it. Honesty rule held: 4.7M is Farcaster coverage, never
> presented as Twitter (which is ~41k, user-attested).
> - **Post 38** (Sep 8, 5pm) — REWRITTEN: "new chains start thin" was now false; replaced
>   with the 4.7M/complete-Farcaster compounding framing (draft 10307325).
> - **Post 43** (Sep 11, 12pm) — month-close recap now leads with the 5k→4.7M line (draft 10307330, video preserved).
> - **Post 46** (Sep 14, 12pm) — reverse lookup rescoped: any Farcaster handle (protocol complete) vs X where attested onchain (draft 10309712).
> - **Post 37** (Sep 8, 12pm) — sources now list custody addresses + "no fingerprinting" (draft 10307324).
> - **Post 20** (Aug 26, 5pm) — bot detection strengthened: a no-Farcaster result is now a definitive negative (draft 10307306).
> - **Post 14** (Aug 21, 5pm) — week-close first line adds "the social graph passed 4.7M" (draft 10307300).
> - **NEW: milestone thread** (Sat Aug 15, 12pm) — 5 tweets announcing complete Farcaster coverage, with the ~41k Twitter honesty in T4 (draft 10311789).
> - **NEW: post 47, attested-Twitter** (Mon Sep 14, 5pm) — "41k you can trust vs millions you hope about" (draft 10311790).
> Deferred: re-measuring the 9-collection benchmark (posts 15/16/22/24) against the new
> internal graph — the numbers likely rose above the Neynar-only 11.5% floor.

> **Note on the old queue:** `tweet-queue-remaining.md` schedules through Mar 26 and its
> tweets 49–122 were never posted. Those dates are five months stale. This is a fresh
> file rather than a continuation; the evergreen posts in the old queue are still usable
> and worth folding back in once this month is live.

---

## The data behind this month

Everything cited below was measured on 2026-08-12 using walletlink's own pipeline, after
Robinhood Chain support shipped (PR #11). Numbers are real and reproducible.

**Cross-collection benchmark — 9 Robinhood Chain collections, 14,773 unique holders:**

| Collection | Holders | On Farcaster | Rate | w/ verified X | FC reach |
|---|---|---|---|---|---|
| ROBO BROKERS | 1,029 | 165 | 16.0% | 116 | 138,423 |
| Spritehood Wisps | 4,011 | 619 | 15.4% | 294 | 559,323 |
| Zaibatsu Wagies | 418 | 63 | 15.1% | 39 | 163,924 |
| Chain Mancers | 1,087 | 134 | 12.3% | 66 | 34,366 |
| PitBoys | 785 | 87 | 11.1% | 34 | 15,159 |
| pyopyopyopyo | 1,599 | 166 | 10.4% | 115 | 57,152 |
| StonkBrokers | 618 | 60 | 9.7% | 26 | 9,756 |
| Script Kiddies | 2,418 | 204 | 8.4% | 124 | 74,052 |
| Cash Cats | 2,808 | 194 | 6.9% | 83 | 56,714 |
| **TOTAL** | **14,773** | **1,692** | **11.5%** | **897** | **1,108,869** |

**⚠️ Accuracy caveat — read before posting.** That 11.5% is **Farcaster-only, via Neynar**.
It is a *floor*, not the headline match rate. The full pipeline adds web3bio and ENS: on
StonkBrokers, Neynar alone found 60 holders but the full run found 70 with X-or-Farcaster
(9.7% → 11.3%). So the true cross-collection X-or-Farcaster figure is likely ~13–14%, but
**I have not measured that across all nine**, so every post below says "on Farcaster"
rather than "match rate." Don't upgrade the wording without re-running the full pipeline.

**Full-pipeline result for StonkBrokers (618 holders, measured):** 70 with X or Farcaster
(11.3%), 65 Farcaster, 36 X, 140 with any identity incl. ENS/Lens/GitHub (22.7%).

**Chain facts:** Robinhood Chain, chain ID 4663, $498M TVL (DefiLlama, 2026-08-12).

**Coins — corrected.** My first pass searched DexScreener for "robinhood," which by
construction only returned tokens *named* Robinhood, so I wrongly concluded the chain had
nothing but ticker-squats. Wrong. Searching by ticker instead:

| Token | Market cap | 24h volume | Note |
|---|---|---|---|
| **$CASHCAT** | ~$161M | ~$6.5M | real depth across several pools, ~$4.4M in the largest |
| **$HOODIE** | ~$337K | ~$27K | real but small |

The repeated $CASHCAT rows in the API are *pools of one token*, not clones — same market
cap across all of them. That's the opposite of the squat pattern.

Squat tokens also exist on the chain (24 sharing ROBINHOOD/HOOD tickers, $5K–$580K
liquidity, mostly ~$0 volume). An earlier draft of post 35 was built on that pattern and
has been **cut**: nobody arrives at walletlink unsure which token is real — they paste a
contract address they already have. Ticker confusion is a screener's problem, not a
holder-resolution one, so the post rested on a pain point the audience doesn't have.
Post 35 now argues the half that does hold — an address is authentic and still can't tell
you where to reach someone.

**⚠️ Hard constraint on token posts — do not violate this.** walletlink **cannot resolve
ERC-20 holders on Robinhood Chain.** There's no Moralis index for chain 4663, and token
holders can't be derived from RPC state the way NFT owners can. We shipped an explicit
`CHAIN_NO_ERC20_SUPPORT` error for exactly this. So $CASHCAT and $HOODIE appear below as
**ecosystem context only** — never as something we can resolve. Any post implying we can
pull $CASHCAT holder lists would be a false product claim. Post 32 says the limitation out
loud, which is on-voice for this account and cheaper than being corrected in public.

**Not used: individual holders' handles.** Confirmed with you — aggregates only. The
benchmark surfaced real accounts (one 88K-follower account holds in three of the top
collections) and none of them are named anywhere below.

---

# WEEK 1 — Robinhood Chain launch (Aug 13–21)

### 1. Launch announcement — Thu Aug 13, 12pm
```
walletlink now supports Robinhood Chain (@RobinhoodCrypto)

upload a collection contract, get holder wallets resolved to Twitter and Farcaster

same one-time pricing
same pipeline
new chain

walletlink.social
```

### 2. Why this chain — Thu Aug 13, 5pm
```
Robinhood Chain isn’t a ghost town

$CASHCAT and $HOODIE trade daily
a dozen PFP collections with real holder counts
$498M TVL

it’s a real scene, and almost none of it was reachable until now
```

### 3. THREAD: what we found — Wed Aug 12, 5pm  *(pulled forward from Aug 14 to launch same-day)*
```
we added support for Robinhood Chain (@RobinhoodCrypto), then immediately ran the top 9 collections through it

14,773 holder wallets

here’s who’s actually reachable 🧵
```
```
1,692 of those wallets are on Farcaster

that’s 11.5%

for a chain that launched this year, on collections that mostly minted in the last few months, that’s a real community — not bots
```
```
combined Farcaster reach across those holders: 1.1M followers

that’s not 1.1M people. it’s overlapping audiences

but it means the people holding these collections are not anonymous — they’re findable, and a lot of them have an audience
```
```
the spread matters more than the average

top collection: 16.0% on Farcaster
bottom: 6.9%

same chain, same week, 2x difference

your community’s reachability is a property of your community, not your chain
```
```
if you run a collection on Robinhood Chain, you can check yours in about a minute

paste your contract, pick the network, get handles back

walletlink.social
```

### 45. Open offer — Fri Aug 14, 12pm
```
if you run a collection on Robinhood Chain, drop the contract in the replies

we’ll run it and send back the numbers

no signup, no catch — genuinely curious how the rest of the chain looks
```

> Numbered 45 because 1–44 are already live in Typefully as `RH N.` titles and
> renumbering would break that mapping. It sits in the Aug 14 12pm slot that post 3
> vacated when the launch thread was pulled forward to Aug 12.
>
> **This one creates an obligation** — replies need running and answering, by hand,
> reasonably fast. It is here because it is the highest-leverage post in the month
> for a product with no inbound: it puts real contracts in front of the tool and
> starts conversations with the exact people who would pay. Cut it if you would
> rather not be on the hook.

### 4. Contract import — Fri Aug 14, 5pm
```
contract import six months ago: Ethereum or Base, Unlimited only

today: Ethereum, Base, or Robinhood Chain (@robinhoodcrypto) — included with Pro at $99, once

paste the contract address, we pull the holders and resolve them to X + Farcaster

no CSV, no snapshot tool
```

> Rewritten 2026-08-12 from Jake’s idea: mirror the 6-month-old Farcaster post that
> announced contract import (then mainnet + Base, Unlimited only) as a then-vs-now.
> **Media attached:** fresh screenshot of the import modal with the Robinhood Chain
> radio selected — including the “NFT collections only” ERC-20 caveat, which is why
> the copy says “paste the contract address” rather than promising token holder
> lists. “We pull the holders” (not “every holder”) because Pro caps imports at its
> wallet limit and the modal shows a truncation warning past it.

### 5. The 2x spread — Mon Aug 17, 12pm
```
two Robinhood Chain collections, same week:

one has 16% of holders on Farcaster
one has 6.9%

nothing about the chain explains that gap

community composition does
```

### 6. Question — Mon Aug 17, 5pm
```
minting on Robinhood Chain?

genuinely curious how you’re planning to reach holders after mint

discord? or do you not know yet
```

### 7. Reachability is a metric — Tue Aug 18, 12pm
```
floor price tells you what your NFT is worth

holder reachability tells you whether you can do anything about it

one of these gets tracked obsessively and the other doesn’t get tracked at all
```

### 8. Three chains — Tue Aug 18, 5pm
```
supported networks:

Ethereum
Base
Robinhood Chain

same lookup, same pricing, one upload
```

### 9. Post-mint window — Wed Aug 19, 12pm
```
the window to build a relationship with a minter is short

they minted because they were paying attention that week

if your only channel is a discord announcement, you’re relying on them to keep paying attention

identity resolution doesn’t rely on that
```

### 10. Small chain advantage — Wed Aug 19, 5pm
```
smaller chain, smaller holder lists, higher signal

on a 600-holder collection you can genuinely reach the top 50 personally

that’s not a strategy that scales to 40,000 holders — which is exactly why it works
```

### 11. Not a Robinhood product — Thu Aug 20, 12pm
```
to be clear: we’re not affiliated with Robinhood

we support the chain the same way we support Ethereum and Base

if wallets hold things there, we resolve who they are
```

### 12. New chain, same job — Thu Aug 20, 5pm
```
new chains keep launching

the problem never changes: you end up with a list of addresses and no idea who they belong to

that’s the only problem we solve, on whatever chain you need it
```

### 13. Free tier reminder — Fri Aug 21, 12pm
```
you can test this on 500 wallets for $0

no card, no call

if the match rate is bad for your collection, you’ve learned that for free
```

### 14. Week close — Fri Aug 21, 5pm
```
this week: Robinhood Chain support shipped, and we ran 14,773 holder wallets through it to see what was there

11.5% on Farcaster
1.1M combined reach

your collection’s number is one upload away
```

---

# WEEK 2 — The benchmark data (Aug 24–28)

### 15. THREAD: reading the benchmark — Mon Aug 24, 12pm
```
we published match rates for 9 Robinhood Chain collections

people keep asking why theirs is lower than the top of the table

here’s what actually drives that number 🧵
```
```
1. mint mechanics

free mints and bot-friendly drops pull in wallets that were never people

collections with friction — allowlists, real prices, manual claims — resolve higher, every time
```
```
2. age

identity accumulates. a wallet that’s been active for two years has had time to link a Farcaster account

a wallet created for one mint has nothing attached to it, and may never
```
```
3. culture

PFP communities link identity because being known is the point

utility and infra collections resolve lower — holders there aren’t trying to be recognized
```
```
none of these are fixable after the fact

which is the actual lesson: reachability is decided at mint, not at marketing time

check it before you plan a campaign around it
```

### 16. 1.1M reach — Mon Aug 24, 5pm
```
1,692 reachable wallets across 9 collections

1.1M combined Farcaster followers behind them

your holders aren’t just an audience — a chunk of them have audiences
```

### 17. Concentration — Tue Aug 25, 12pm
```
in every holder list we’ve run, reach is wildly concentrated

a handful of holders carry most of the follower count

if you’re going to do outreach manually, this is the argument for sorting before you start
```

### 18. Priority score — Tue Aug 25, 5pm
```
priority score = holdings × log(followers)

it’s deliberately not just follower count

someone with 2,000 followers and 10 NFTs matters more to your collection than someone with 80,000 and one
```

### 19. Tip: check before you plan — Wed Aug 26, 12pm
```
tip:

run your holder list before you write the campaign, not after

a 6% match rate and a 16% match rate call for completely different plans

most teams find out in the wrong order
```

### 20. Bots vs humans — Wed Aug 26, 5pm
```
"is my holder list real people"

resolution answers this faster than transaction analysis does

wallets with linked social accounts are humans, near enough

the ones with nothing attached are the ones worth a second look
```

### 21. Question — Thu Aug 27, 12pm
```
what’s your collection’s holder count, and how many of them could you actually contact tomorrow if you had to

second number is usually the uncomfortable one
```

### 22. Discord math — Thu Aug 27, 5pm
```
5–10% of your holders are active in your discord

11.5% of the Robinhood Chain holders we sampled are on Farcaster

these are different 10%s

that’s the whole argument for resolving instead of announcing
```

### 23. Same wallet, three chains — Fri Aug 28, 12pm
```
the same person holds on Ethereum, Base, and Robinhood Chain under different addresses sometimes, the same one often

resolving to identity is what lets you dedupe a person across chains

addresses can’t do that
```

### 24. Week close — Fri Aug 28, 5pm
```
benchmarks are only useful if yours is in them

9 collections measured
14,773 wallets
6.9% to 16.0%

find out where you land: walletlink.social
```

---

# WEEK 3 — Use cases and workflow (Aug 31–Sep 4)

### 25. The workflow — Mon Aug 31, 12pm
```
collection → contacts, in four steps:

1. paste your contract
2. pick your network
3. sort by priority score
4. talk to the top 50

step 4 is the one nobody does
```

### 26. Airdrop targeting — Mon Aug 31, 5pm
```
running an airdrop on a new chain?

resolve the list first

the wallets with no identity attached anywhere are the ones most likely to dump on day one

you don’t have to exclude them — but you should know the ratio
```

### 27. THREAD: first 100 holders — Tue Sep 1, 12pm
```
the most valuable outreach you’ll ever do is to your first 100 holders

almost nobody does it

here’s the version that takes an afternoon 🧵
```
```
export your holder list

resolve it to Twitter and Farcaster

sort by priority score

you now have a ranked list of the people who bet on you earliest
```
```
message the top 50 individually

not a broadcast, not an announcement — an actual message that mentions what they hold
```
```
you’ll get a response rate that makes discord look broken

because it’s the first time most of them have been contacted directly by a project they hold
```
```
this works best early, while the number is small enough to be personal

at 100 holders it’s an afternoon
at 10,000 it’s a campaign

do it while it’s still an afternoon
```

### 28. DAO angle — Tue Sep 1, 5pm
```
governance participation is a communication problem wearing a governance costume

people don’t vote on proposals they never saw

resolving token holders to social accounts is upstream of every quorum fix
```

### 29. Ambassador programs — Wed Sep 2, 12pm
```
you probably already have ambassadors

they’re the holders with real followings who post about you for free

resolution is how you find out who they are before you build a program around strangers
```

### 30. Tip: don't mass DM — Wed Sep 2, 5pm
```
tip:

having 1,000 handles is not permission to DM 1,000 people

resolve, sort, and contact a few dozen well

the tool gives you reach — restraint is what makes it work
```

### 31. Cross-collection holders — Thu Sep 3, 12pm
```
run two collections on the same chain and diff the holder lists

the overlap is your natural collab audience

nobody checks this and it takes about two minutes
```

### 32. Honest limitation — Thu Sep 3, 5pm
```
Cash Cats the collection and $CASHCAT the token pull from the same crowd

we resolve the NFT side today

token holders on Robinhood Chain we can’t do yet — there’s no index for it

telling you before you ask
```

### 33. Retention — Fri Sep 4, 12pm
```
holders don’t leave because they stopped believing

they leave because nothing reminded them to care

the projects with the best retention are just the ones that stayed in contact
```

### 34. One-time pricing — Fri Sep 4, 5pm
```
$99 for Pro
$249 for Unlimited

paid once, not monthly

both include API access and contract import

a lookup tool you use a few times a quarter shouldn’t bill you every month
```

---

# WEEK 4 — Identity, data quality, product (Sep 7–11)

### 35. THREAD: what the chain can’t tell you — Mon Sep 7, 12pm
```
a wallet address is the most reliable data in crypto

permanent, verifiable, impossible to fake

and it still can’t tell you the one thing you need 🧵
```
```
the chain will tell you everything that wallet has ever done

what it holds
what it bought, and when
when it first appeared
every transfer it has ever made

all of it exact
```
```
what it won’t tell you is where the person behind it reads their notifications

that isn’t a gap in the data

it’s a different kind of data that was never onchain to begin with
```
```
we ran one Robinhood Chain collection: 618 holders

70 of them resolve to an X or Farcaster account

the other 548 are still perfectly good addresses that you cannot say a word to
```
```
identity is the join between the two

on Ethereum, Base, and now Robinhood Chain

walletlink.social
```

### 36. Data quality — Mon Sep 7, 5pm
```
we verified our Robinhood Chain holder data against the chain itself before shipping

enumerated all 4,444 tokens in a collection and compared to what our provider returned

exact match, zero gaps

seemed worth checking on a chain this new
```

### 37. Sources — Tue Sep 8, 12pm
```
where the handles come from:

Farcaster verified addresses
ENS text records
onchain identity records
public profile links

no scraping, no guessing

if we can’t verify it, we don’t return it
```

### 38. Social graph compounds — Tue Sep 8, 5pm
```
every lookup makes the next one better

results are stored permanently, so when you upload your list you’re benefiting from every list that came before it

new chains start thin and fill in fast
```

### 39. Tip: re-run quarterly — Wed Sep 9, 12pm
```
tip:

re-run your holder list every quarter

holders turn over, and identity accumulates — wallets that resolved to nothing in Q1 often resolve by Q3

a list you ran in spring is already wrong
```

### 40. Any identity — Wed Sep 9, 5pm
```
on the collection we studied closely:

11.3% had Twitter or Farcaster
22.7% had some identity — ENS, Lens, GitHub, something

the second number is the one worth thinking about, because it’s who’s findable eventually
```

### 41. Honest limits — Thu Sep 10, 12pm
```
we’re not going to tell you we resolve 90% of wallets

nobody does

industry average is around 2.5%, we typically land 15–25% depending on the community, and some collections come in lower

you should know that before you pay us, not after
```

### 42. Question — Thu Sep 10, 5pm
```
which chain should we add next

genuinely asking — we just did Robinhood Chain because people were minting there and had no way to reach holders

where’s the next version of that
```

### 43. Month close — Fri Sep 11, 12pm
```
this month:

Robinhood Chain support shipped
14,773 holder wallets benchmarked
9 collections measured, 6.9% to 16.0%

three chains, one upload, one payment

walletlink.social
```

### 44. Soft CTA — Fri Sep 11, 5pm
```
if you run a collection and you’ve never seen your holder list resolved to real accounts, it’s genuinely worth the ten minutes

free for the first 500 wallets

you might be more reachable than you think
```

---

### 46. API access — Mon Sep 14, 12pm
```
Pro and Unlimited now include API access

wallet → socials, one at a time or in bulk

and reverse: hand it an X or Farcaster handle, get back the wallets that person holds

a CSV can’t answer that one
```

> Added after the 2026-08-12 repricing. Scheduled one slot past the original
> Sep 11 end so nothing else had to move. The reverse endpoint is the part worth
> leading with — forward lookup is a commodity, `handle → wallets` is not, and it
> is the one thing the free CSV export cannot substitute for.

## Scheduling notes

- 44 posts, exactly filling Mon–Fri × 2 slots from Aug 13 to Sep 11
- 4 threads (posts 3, 15, 27, 35) — schedule the thread as a single Typefully thread, not
  separate tweets; each occupies one slot
- Pillar mix: product ~40%, use cases ~30%, tips/insight ~20%, proof ~10% — matches the
  skill's targets
- Curly apostrophes used throughout per repo UI convention
- No post ends a line with a period, per voice guide

## Before scheduling — please confirm

1. **The 11.5% wording.** Every post says "on Farcaster," not "match rate," because the
   number is Neynar-only. If you want to claim the higher X-or-Farcaster figure, I need to
   re-run the full pipeline across all nine collections first (~20 min).
2. **Post 11** explicitly disclaims Robinhood affiliation. Keep or cut — depends whether
   you think the ambiguity is a risk or a feature.
3. **Post 41** states the honest limits including "some collections come in lower." That
   is a deliberate credibility play and it undercuts the 15–25% claim slightly. Your call.
4. **Naming collections.** Posts reference the benchmark in aggregate and never name a
   specific collection's low score. Naming Cash Cats as the 6.9% would be more concrete
   and also a bit rude to a project that didn't ask to be measured. Note that post 32 does
   name Cash Cats, but favourably — as a community, not as a low score.

## Video (Remotion) — candidates

Not all 44 want video. The ones where motion actually adds something:

| Post | Why it earns a video |
|---|---|
| **3** (launch thread) | the benchmark table animating in, row by row, sorted by rate |
| **14 / 43** (week + month close) | counter animation: 14,773 wallets → 1,692 → 1.1M reach |
| **17** (concentration) | the long-tail curve drawing itself — this is genuinely hard to say in text |
| **35** (24 tokens, one ticker) | 24 identical token cards stacking up, then one highlighted |
| **8** (three chains) | simple logo lockup, cheap to make, good reusable brand asset |

Everything else is a text post and should stay one. Video on a plain tip reads as filler.
