# Growth

How traffic is acquired, how it is measured, and what has actually been tried.

`docs/SEO-STRATEGY.md` is the keyword and on-page reference and stays where it
is. This document is the operating loop: the baseline, the channels, the
cadence, and a dated log of interventions so that a change in the numbers can
be traced to something somebody did.

## The baseline, 2026-09-16

Measured with `npm run growth:report`, not estimated.

| Measure                           | Value                                     |
| --------------------------------- | ----------------------------------------- |
| Sessions per day, steady state    | 10 to 35                                  |
| Sessions, 30 days                 | 1,976, of which 1,398 were one QR auction |
| Search sessions, 30 days          | 14 (12 Google, 2 Bing)                    |
| AI assistant sessions, 30 days    | 10, all ChatGPT                           |
| Social sessions, 30 days          | 1                                         |
| Sessions landing on `/`           | 1,852 of 1,976                            |
| Content pages: entries, 30 days   | 97 across 78 pages                        |
| Signups, 90 days                  | 43                                        |
| Purchases, 90 days                | 0                                         |
| Search Console, 3 months to 08-28 | 4 clicks, 379 impressions, position 50.1  |

Three things follow from that table and they set the whole plan.

**Discovery is the constraint, not conversion of the traffic we have.** Fourteen
search sessions a month is not a ranking problem to tune, it is an absence. The
content estate is not small: 29 blog posts, 7 comparison pages, 158 holder
reports. It draws nine views a day. Pages exist and are not found.

Worse, most of them answer nothing anybody types. `lib/recognized-contracts.ts`
names 64 contracts on one criterion, would a person put this name next to the
word "holders", and only 19 of them have a page. 139 of the 158 published
reports are for contracts nobody would search by name.

**The best-converting channel is the smallest one.** Four of the ten ChatGPT
arrivals ran a lookup. Direct converts at 63 of 438. Nothing else has enough
volume to rate. An answer engine sends people who have already been told what
the product does, which is the opposite of a cold search click, and this is the
channel the product is unusually well set up for: there is an MCP server, an
`llms.txt`, a public API and a docs site already.

**Zero purchases in 90 days against 43 signups is a separate problem from
traffic** and traffic work will not fix it. It is recorded here because every
funnel below terminates in it and a growth plan that reports only sessions would
be measuring the easy half.

## What counts as a channel

`lib/first-touch.ts` classifies one stored acquisition string into one channel.
The classification is read-time, so the roster can grow and every row already in
the database is reclassified by the next query.

| Channel      | Means                                                        |
| ------------ | ------------------------------------------------------------ |
| AI assistant | An answer engine linked here. ChatGPT, Perplexity, Claude, … |
| Search       | An ordinary engine. Bing and DuckDuckGo count here           |
| Social       | A post on a platform                                         |
| Referral     | Any other site                                               |
| Campaign     | Our own tag, with no referring host: a QR code, a print link |
| Direct       | Measured, and there was nothing to record                    |
| Unattributed | Not measured. Never folded into direct                       |

Two rules the invariants enforce, both of which are ways the table can lie while
looking right. A campaign tag never manufactures a channel: `ref:google-ads` is a
campaign, not a Google search. And unattributed is never direct: 1,489 of the
last 30 days' sessions carry no origin because the tracker shipped after the
arrivals that produced them, and folding those into direct would invent a direct
channel four times the size of the real one.

## The loop

The durable half runs whether anybody is looking; the judgement half does not.

**Weekly, automatically.** `.github/workflows/growth-report.yml` runs
`scripts/growth-report.ts` every Monday at 09:00 UTC and writes the report into
the job summary: totals against the previous window, sessions by channel by
week, named sources, per-page entries, and a watchlist. It never fails on the
numbers. A red build has to mean something is broken or the signal is trained
away inside a month.

**It will not run at 09:00, and nothing is wrong when it does not.** GitHub's
scheduler is hours behind for this repository, on every workflow, and a cron
line here is a lower bound rather than a time. Measured 2026-09-21 across four
consecutive weeks and several daily jobs:

| Workflow            | Cron            | Actually ran               | Late by |
| ------------------- | --------------- | -------------------------- | ------- |
| `daily-cast`        | `35 17 * * *`   | 19:40, 19:32, 19:54        | ~2h     |
| `snapshot-harvest`  | `0 6 * * 0`     | 10:27, 10:57, 10:07        | ~4.5h   |
| `db-backup`         | `0 8 * * *`     | 14:57, 12:57, 12:21        | ~4.5h   |
| `ud-domain-harvest` | `15 2,14 * * *` | 07:55                      | 5h40    |
| `published-figures` | `0 8 * * 1`     | 14:45, 14:38, 13:52, 15:44 | 6-8h    |
| `holder-fallback`   | `0 9 * * 1`     | 15:42, 15:42, 14:50, 16:45 | 6-8h    |

**The obvious read of that table is wrong.** Five of the six sit on `:00` or
`:15` and the first diagnosis was congestion at the top of the hour, with
"move them off `:00`" as the fix. `ud-domain-harvest` at `15 2` is 5h40 late
and `daily-cast` at `35 17` is two hours late, so the minute is not the
variable; the lag is repo-wide and looks worse in the UTC morning, which is
where most of these sit. Changing a cron minute would have produced a commit,
a PR and no effect at all.

So do not chase it. Every job here is a report, a probe or a harvest, and none
of them cares about the hour: the weekly report summarises a 28-day window and
the harvests are idempotent. The one job where lateness is visible to anybody
is `daily-cast`, which posts about two hours after its slot, consistently.

If punctuality ever does matter for one of these, the lever is not the cron
line. It is an external trigger calling `workflow_dispatch` through the API on
a schedule something else keeps, which is the same conclusion the memory note
about GitHub Actions versus session crons already reaches from the other
direction.

**Weekly, by hand.** Read it, pick the one intervention the numbers argue for,
ship it as its own PR, and add a dated row to the log below naming what was
shipped and what it was expected to move. An intervention with no expected
outcome recorded cannot be judged later, which is how growth work usually
becomes unfalsifiable.

Run it locally the same way:

```bash
npm run growth:report
```

## How the numbers are read without granting CI the customer tables

The weekly job connects as `sweep_runner`, and this repository is public, so its
Actions logs are public. `users.email` is an address and
`analytics_events.user_id` holds "localStorage ID or email" by its own schema
comment.

So the report reads three narrow views instead, created by
`scripts/migrate-growth-views.ts`. `growth_page_events` exposes the event type,
the session, the timestamp and the two metadata keys the rollups need.
`growth_accounts` exposes the signup timestamp, the acquisition summary and the
rail, and resolves "did this account ever buy" into a boolean, so it carries no
account id at all. `growth_purchases` carries a lot's timestamp and amount with
the rail beside it. Neither base table is granted, and an invariant asserts that
neither is ever added to the grant list.

## The programmatic surface, and why it stopped growing into search

Measured 2026-09-16. The metered ERC-20 holder index has answered `401 "Your
Moralis Free usage is paused"` since 2026-08-31. The seed path calls
`getContractHolders` with `allowPublicFallback: false` on purpose, so it never
reaches the public explorer, and **every ERC-20 seed since that date has
imported zero holders**. The cron still spends a slot per chain per day on it
and records each failure as a `holders_imported = 0` row that nothing counted.

That is why the missing 45 are almost all tokens: Chainlink, Pepe, Uniswap,
Shiba Inu, ENS, Aave, Zora, Clanker, aixbt, GMX, PancakeSwap, FLOKI. The NFT
path works, which is why every covered entry is a collection, and all 22
recognized NFT contracts are already seeded. So the searchable surface is capped
at 22 until the ERC-20 side is decided.

With the fallback allowed, 11 of 42 recognized tokens resolve today: Optimism
and Polygon fully, Ethereum and Arbitrum partly, Base not at all, BSC has no
public fallback by design. So allowing it is a partial fix, and it also reverses
a deliberate policy that keeps background work from spending free infrastructure
on jobs nobody asked for. Three options, two of which cost something:

1. Pay for Moralis. Restores all of it.
2. Let seeds use the public explorer. Free, fixes 11 of 42.
3. Drop ERC-20 seeding and concentrate on NFTs and Robinhood, which work.

`npm run check:holder-fallback` passing is not evidence against any of this. It
unsets the Moralis key deliberately and probes five hand-picked tokens to prove
the explorer is reachable; one of the five is a recognized contract that fails
in the seed path.

**Decided by Jake 2026-09-18: option 1 is out. We are not paying for Moralis.**
Re-verified the same day before recording it, because the pause is an account
state rather than a code state and could have lapsed on its own: the key is
still present and still answers `401 "Your Moralis Free usage is paused."` So
the metered path is dead until somebody upgrades, and nobody is going to.

That settles what the seed path must stop doing, and leaves one question open.
It must stop **attempting** the ERC-20 seed: every run since 2026-08-31 has
spent a cron slot per chain per day to receive a 401 and write a
`holders_imported = 0` row that nothing reads, which is the same silent-zero
shape the Farcaster sweep was carrying until 2026-09-18. A path that cannot
succeed should say so once, not fail quietly every day.

**Decided by Jake 2026-09-18: option 3.** Drop ERC-20 seeding and concentrate
on NFTs and Robinhood. The `allowPublicFallback: false` policy stands, and the
searchable surface stays at the 22 NFT collections that already work. The 11
tokens option 2 would have recovered are declined knowingly: a partial fix is
not worth reversing a policy that exists to keep speculative background work
off free infrastructure.

Shipped as a refusal at **discovery**, not inside `seedContract`. A candidate
that is never selected spends no slot, writes no attempt marker, and cannot
leave a `holders_imported = 0` row that locks a healthy token out of the pool
for `FAILURE_RETRY_DAYS`. A path that cannot succeed should say so once, not
fail quietly every day, which is what it had been doing since 2026-08-31.

The gate is `usesMeteredHolderIndex(chain)`, which is deliberately not the
chain list beside it: that list answers "does an ERC-20 index exist for this
chain", and this answers "is that index the dead one". Of the seven chains in
`ERC20_SUPPORTED_CHAINS`, six are metered and now skip; **Robinhood keeps
seeding**, because its explorer is its own index rather than a fallback. NFT
seeding is untouched and runs on a different provider entirely.

Reversible in one line if option 2 is ever wanted. And note the policy question
was only ever about **background** seeding: a user asking for a specific
contract is a job somebody did ask for, and that path is unaffected either
way.

**Superseded by Jake 2026-09-19, one day later, by an option the 2026-09-16
survey missed: a second metered ERC-20 holder index.** Verified live that day
against real contracts on five chains plus HyperEVM (Toshi on Base returned
1.09M holders with a correct total; Base was the chain the public explorer
served worst). The key was already in the repo for the profile-enrichment
cron, so the fix is option 1's coverage at option 3's price. None of the three
recorded options is what shipped:

- `getContractHolders` now hands the 401 off to the second index before the
  public-explorer question ever arises. The `allowPublicFallback: false`
  policy stands untouched, because the second index is our own key on our own
  plan, not free public infrastructure: the policy's own test, applied, not
  waived.
- The discovery gate narrows from "every metered chain" to "every metered
  chain the second index cannot rescue": **BSC stays retired** (the provider
  does not serve it), the other five metered chains seed again.
- **HyperEVM gains token import and token seeding for the first time**, since
  the second index is the only ERC-20 index that chain has ever had.

The searchable surface is uncapped from 22: of the 42 recognized ERC-20
contracts, the 31 on rescued chains (plus Robinhood's 2, which never stopped)
can seed again, and the 9 on BSC stay out, knowingly.

**BNB Chain came back on 2026-09-20 and the seed cron did not notice until
2026-09-21.** A third metered index landed in `getContractHolders` that day and
serves bsc, which is the chain the second index's provider does not cover. The
import path worked from that moment. Discovery did not: its gate asked
`hasSecondHolderIndex` and nothing else, so it went on refusing the chain for a
day, and the nine BNB tokens kept the zero-holder row they had recorded before
either rescue existed. A skipped candidate writes no attempt marker, so
`last_seeded_at` never moved and the row could not age past
`FAILURE_RETRY_DAYS`; the weekly report then read each frozen row as a fresh
failure, every Monday, which is how one gate produced twenty names on an alarm
built to show two.

Fixed with a predicate per rung, `hasThirdHolderIndex`, so the gate has to be
widened when a fourth arrives rather than silently under-reporting. Verified
live first: PancakeSwap answered 1,912,112 holders through the third index
while discovery was still refusing the chain. **So the 9 BSC contracts are no
longer knowingly out**, and the only ERC-20 contracts still excluded are ones a
provider genuinely cannot serve.

**2026-09-20: coverage became monotonic.** `seeded_contracts.resume_state`
bookmarks each unfinished holder walk, so a re-seed continues down the
balance-sorted list instead of re-importing the same top 2,000 forever.
Never-seeded contracts still outrank continuations (breadth first), and
continuations fill the slots that used to end the day as "no novel
candidates". The per-run cap and every budget guard are unchanged; what
changed is that the same daily spend now always buys new wallets.

**2026-09-21: a skipped slot and a refused chain look identical in the table,
and that cost an afternoon.** Checking whether the Chainbase key had revived
BSC, the evidence read as starvation: BSC sits last in `SEED_ORDER`, the run
shares one 240-second deadline across all slots, and BSC had no row for three
days while the seven chains above it seeded daily.

That was wrong. BSC was refused at **discovery**, not skipped for time. The
gate introduced on 2026-09-19 kept refusing BNB Chain by name, and the
`hasThirdHolderIndex` rung that released it landed on 2026-09-21. The
disproof was already in the table: BSC **was** attempted on 09-16, 09-17 and
09-18, and a slot that is never reached cannot write an attempt marker.

Both paths write nothing, which is why they were confusable. A gate refusal
`continue`s before the slot; a starved slot returns `budgetExhausted`. Neither
leaves a row, so from `seeded_contracts` a chain that was refused, a chain that
was skipped, and a chain with nothing left to seed are the same absence.

Two changes, neither of which was the BSC fix:

- **The starved case now announces itself.** The run logs the order it chose
  and warns with any slot the clock ate. The gate already logs its refusals, so
  the two are now distinguishable from the log alone.
- **The tail rotates by day**, so the last position is not a standing
  disadvantage for one chain. No starved run has been observed; this closes the
  hazard rather than repairing damage. The head stays pinned to the two chains
  no competing index serves, since rotating those would trade one chain's
  disadvantage for a costlier one.

## Two funnels, never added together

`purchases` and `revenue` in the report mean packs bought by people. The x402
onchain rail is excluded, to match the signup count beside it, which has always
excluded it. That is not tidying: one agent settlement counted as a purchase
would silence the watchlist line that exists to notice zero human conversion,
and nothing would look wrong. The rail is printed on its own line underneath
whenever it is non-zero, so nothing is hidden either.

## Tagging a link we post ourselves

Every link in `content/social/queue.json` carries `?ref=x-<slug>` or
`?ref=fc-<slug>`.

Not decoration. A link posted on X arrives through `t.co` and a cast usually
opens in an in-app browser, so the referring host is stripped or never sent and
the arrival reads as `direct`. The tag is the only evidence that survives, which
is precisely the case the `campaign` channel exists for, and the `x-` / `fc-`
prefix says which platform sent it.

This does not weaken the rule that a tag cannot manufacture a channel. The tag
lands in `campaign`, under its own name; it never claims to be a platform
referral, and the invariants still refuse to read one as such. Keep the prefixes
when you refill the queue, or a month of posting becomes unattributable again.

## Discovery surfaces

Every surface below is a place a person or an agent goes looking, and each one
is also a link. Status verified 2026-09-16 by querying each directory directly,
not by assuming a registry entry propagates: it does to Glama and does not to
PulseMCP or mcp.so.

**Every listing carries `?ref=dir-<surface>`.** A directory link arrives with a
referrer we do not control and often with none at all, so without the tag a
listing that works is indistinguishable from one nobody clicked. Tagged, it
lands in the `campaign` channel under its own name and the weekly report shows
one row per surface. That is what makes this a pipeline rather than a checklist.

### Agent and MCP directories

The best-converting channel the product has, and the cheapest to be present on.

| Surface           | Status 2026-09-16                                   |
| ----------------- | --------------------------------------------------- |
| Official registry | **v1.3.0, active, latest** (published 23:55 UTC)    |
| Glama             | Listed, healthy, 4.5/5 across 8 tools, tested today |
| PulseMCP          | **Absent** (0 results in a 21,920-server index)     |
| mcp.so            | **Absent**                                          |
| MCP.Directory     | Not yet checked                                     |
| Smithery          | Not yet checked                                     |

### Publishing a registry update

Two commands, and everything they need is already on the machine:
`mcp-publisher` on PATH, the Ed25519 key at
`~/.walletlink/mcp-registry-key.pem`, and the DNS proof live on the apex as
`v=MCPv1; k=ed25519; p=...`.

```bash
KEY=$(openssl pkey -in ~/.walletlink/mcp-registry-key.pem -outform DER | tail -c 32 | xxd -p -c 64)
mcp-publisher login dns --domain walletlink.social --private-key "$KEY"
mcp-publisher publish   # reads server.json from the working directory
```

**Compare the key against DNS before publishing.** The failure mode otherwise is
a signature error that says nothing about which half is wrong:

```bash
openssl pkey -in ~/.walletlink/mcp-registry-key.pem -pubout -outform DER | tail -c 32 | base64
# must equal the p= value in the apex TXT record
```

`mcp-publisher validate` checks `server.json` against the live registry and
publishes nothing, so run it first. Log out afterwards. Glama syncs from this
registry, so one publish refreshes that listing too; PulseMCP and mcp.so do not,
which is why they still need their own submissions.

### Developer marketplaces

Where the head consumer query already resolves.

| Surface  | Status 2026-09-21                                               |
| -------- | --------------------------------------------------------------- |
| Apify    | **Live** since 2026-09-17, and unusable by its own instructions |
| RapidAPI | Absent. Where API buyers browse rather than search              |

Its 8 runs and 2 users are not a demand signal. The Actor told every visitor to
fetch a free API key, and the endpoint refused one to any account without a
pack, so the documented path never completed for anybody. Fixed 2026-09-21, see
the log entry. Read the usage numbers from that date rather than from the
listing's lifetime.

Apify was the sharpest one and the Actor shipped in PR #261:
`apify.com/starl3xx/wallet-to-twitter-farcaster-lookup`, free to run, taking the
caller's own key. A competing Actor still wins that query with tweet scraping
and confidence scores, which is the weaker method the product is sold against.

**Being listed is not being found, and the numbers say which we are.** Checked
2026-09-21: the Actor does not appear in Apify's own store search for "wallet
twitter" or for "farcaster", because that search ranks on usage and one user in
thirty days ranks nowhere. So the store slot is not the asset. The asset is the
Actor's page, which sits on a domain that already outranks walletlink.social
for the head query, and the lever on it is the README and the links pointing at
it. Both were worked on 2026-09-21; neither is a thing that pays inside a
month.

### Code and list surfaces

The repo already outranks the website for product queries, and answer engines
quote its README, so this tier is proven rather than speculative. Awesome-lists
covering MCP servers, Farcaster tooling and web3 developer tools take pull
requests.

### Community

Farcaster channels, Show HN, Reddit. These need a human voice and they are
speech in Jake's name, so they are his to send. **The line this document draws:**
a directory listing is product metadata and gets submitted as part of the work;
a forum post is a person talking and does not.

## Decisions taken, so they are not re-proposed

**The upgrade modal defaults to Campaign ($99), not Trial ($29).** Jake's call,
2026-09-17, against the audit's recommendation. The audit argued that
recommending the larger pack before a first sale exists is the wrong ask. The
decision is to keep Campaign, so treat the default as settled and do not raise it
again without new evidence. If a first sale arrives on a Trial pack, that is
evidence; an argument from first principles is not.

**No paid directory listings.** mcp.so is paid-only at $39 for a DR 72 dofollow
link, confirmed by inspecting both submission forms: the only `type="submit"`
control is "Pay and submit automatically". Declined 2026-09-16 in favour of
generating revenue before spending. Free surfaces only.

## Log

Newest first. One row per intervention, with what it was expected to move, so a
later reader can check whether it did.

### 2026-09-21 — the Apify funnel never worked, and the report could not see it

Found in review of the change below, and it invalidates the premise PR #261
shipped on ("installs funnel into the 100-match free allowance"). They never
could. `POST /api/developer/keys` refused a key to any account on the free
allowance, so a stranger following the Actor's own instructions signed up, went
to fetch a key, and got a 403. The Actor has said "get a free API key" since
2026-09-17.

The rule was also only half enforced. `mintAccessToken` in
`lib/oauth/grants.ts` writes an `api_keys` row on the same plan with no credit
test, so any free account connecting an OAuth client had a working key already.
Two doors, opposite rules, nothing comparing them.

**Decided by Jake 2026-09-21: align the gate with what OAuth already did.** Any
signed-in account may hold a key; the free allowance decides what it can draw.
A key is not a spend, and `trackApiUsage` was always the thing protecting
revenue.

Expected to move: the Apify Actor's install-to-first-run rate, which cannot be
read from this report because those arrivals land on apify.com. The figure
visible here is signups, which should rise if the Actor sends anybody, and the
free-to-paid step, which is now reachable from the Actor for the first time.
The honest statement is that the Actor has had **zero working installs by the
documented route** since 2026-09-17, so its 8 runs and 1 user are not evidence
about demand.

Two measurement fixes shipped with it, both of which were understating the
pages this month's work is about:

- **`CONTENT_PREFIXES` omitted `/find-twitter-account-from-wallet-address`**,
  the free tool at the exact-match URL for the head query and a sitemap 0.9.
  The content table could not show whether it drew anybody.
- **Activation counted `lookup_started` alone**, so that page's free
  single-wallet lookup and the app's reverse lookup both counted as bounces.
  Widened to one `ACTIVATION_EVENTS` list across all four query sites. **This
  breaks comparability with the 2026-09-16 baseline**, and the report says so
  in its own output rather than leaving a reader to infer it.

### 2026-09-21 — the bottleneck moved, and four things shipped against it

Search Console, 28 days to 2026-09-19: **1 click, 488 impressions, CTR 0.2%,
average position 32.5**. Against the 2026-08-28 baseline of 4 clicks and 379
impressions over three months at position 50.1, impressions per day are up
roughly fourfold and average position has improved eighteen places. Clicks have
not moved, because position 32.5 is page four.

So the September diagnosis is out of date. "No impressions" was the problem;
"impressions that convert to nothing" is the problem now, and it has two
separate causes, which is why four changes shipped rather than one.

**Cause one: 129 pages are not in the index.** Coverage on 2026-09-21 is 148
indexed against 145 not indexed, and the refusals split 83 "Discovered,
currently not indexed" and 46 "Crawled, currently not indexed", plus 12 blocked
by robots.txt and 3 redirects. The first bucket is Google declining to spend a
crawl at all.

**Cause two: the pages that do earn impressions are the comparisons**, and
there were six of them. The top queries are `token launch referral` (33),
`addressable` (24), `formo vs addressable…` (17) and `chainlink holders` (13),
every one at zero clicks.

One thing that was checked and changed the plan. The original intervention was
"cut the holder sitemap to the contracts a person would search by name". The
report earning the most impressions today is **Rare Friends Genesis at 185
reachable**, well under the median of 243, found by people searching its bare
contract address across three query spellings. A cut by name recognition or by
median would have removed the one holder page with measured demand, so the
floor was set at 100 and the ordering signal did the rest.

What shipped, and what each is expected to move:

1. **The third holder index reaches the discovery gate.** Not an SEO change:
   the programmatic surface cannot grow into the searches it answers while a
   ninth of the named list is locked out. Expected to move the report's
   "attempted this week and imported nothing" line from 20 toward the two
   Robinhood transients, over two to three weeks as retry slots come round.
   If it stalls above 11, something else is wrong and it is not the gate.
2. **A sitemap floor at 100 reachable, and banded priority.** Expected to move
   "Discovered, currently not indexed" down from 83. It should NOT move clicks
   inside a month, and if the indexed count falls instead, the floor was set
   too high and 100 is one constant to change.
3. **`/vs/nansen` and `/vs/absolute-labs`.** Expected to move impressions, not
   clicks, and not for six to eight weeks. The figure to watch is whether
   either competitor's name appears in the query table at all.
4. **The Apify Actor linked from the README and `llms.txt`.** The Actor is live
   and invisible: 8 runs and 1 user in 30 days, and it does not surface in
   Apify's own store search. Its value is the page, which sits on a domain that
   already outranks us for the head query. Expected to move nothing measurable
   here, because arrivals through it land on apify.com. The test is whether
   the Actor's page starts appearing for the head query by November.

Two things found while measuring that are not interventions and are recorded so
the next reader does not rediscover them:

- **`npm run growth:report` failed locally** on a stale `DATABASE_URL` in
  `.env.local` (`password authentication failed for user 'neondb_owner'`). CI
  always had the working credential, so the weekly job was never affected.
  Refreshed 2026-09-21.
- **Every scheduled workflow in this repo runs hours late, and the minute is
  not the reason.** Recorded below, because the first reading of it was wrong
  and cost a change that would have done nothing.

### 2026-09-16 — ten collections, because the NFT queue was empty

All 22 recognized NFT collections had been seeded, so from that day every NFT
slot fell through to trending discovery, which is what built the 139 reports
nobody searches for. Ten added, taking it to 32, weighted to the chains that
were thinnest: HyperEVM had one entry and token discovery is gated off there, so
that list was its entire seed queue.

Expected to move, stated precisely because half of it is not the seeder's work:

**Five of the ten already had published pages** (The Warplets, DX Terminal,
Footium Players, Hypurr, PiP & Friends). Discovery had reached them by chance,
so they counted in the 158 but not in the 19, and naming them moves the coverage
figure from 19 to 24 the moment the list changes, with nothing seeded. What
naming them actually buys is a guaranteed 30-day refresh instead of the luck of
a trending feed.

**Five are genuinely new**: Moonbirds, Nakamigos, Lil Pudgys, Parallel Alpha and
Loopers. Those are the ones that test the NFT path. If coverage reaches 29 over
the next two to three weeks, at roughly one NFT slot per chain per day, the path
works. If it stalls at 24, the NFT side is failing quietly too and the alarm
above will name which.

It will not move search traffic inside a month either way. Indexing and ranking
a new page takes longer than that, so the figure to watch first is impressions,
not clicks.

### 2026-09-16 — the seed-coverage alarm

The weekly report now counts the contracts we decided are worth a page against
the ones that got one, and names every contract attempted this week that
imported nothing.

Expected to move: nothing on its own. It exists because the thing it measures
failed every day for sixteen days with every check green, and the next such
failure should be one Monday old rather than a fortnight. The number to watch is
"attempted this week and imported nothing": it should be zero, and it is 32.

### 2026-09-16 — the social queue, extended and tagged

Days 15 to 28, destinations spread across `/holders`, `/pricing`, `/mcp`, the
blog, `/vs` and the homepage, every link tagged.

Expected to move: the `campaign` channel, from 8 sessions to something
legible. The real question it answers is whether daily posting is worth
continuing at all. Fourteen days of it produced one measured social session,
and until the links were tagged there was no way to tell whether that was the
posting or the measurement. By 2026-10-14 the named-sources table should show
one row per post destination, and if the total is still in single figures the
channel should be cut rather than refilled.

### 2026-09-16 — the growth ledger

Shipped the measurement, not a change to the product: channel classification,
the weekly report, the views, the workflow. Expected to move nothing. It exists
so that everything after it can be judged, and so that the next report has a
baseline to compare against rather than a window in which the tracker was
switched on halfway through.
