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

## Log

Newest first. One row per intervention, with what it was expected to move, so a
later reader can check whether it did.

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
