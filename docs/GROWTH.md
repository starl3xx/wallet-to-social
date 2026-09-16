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
content estate is not small: 29 blog posts, 7 comparison pages, 66 holder
reports. It draws three views a day. Pages exist and are not found.

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

## Two funnels, never added together

`purchases` and `revenue` in the report mean packs bought by people. The x402
onchain rail is excluded, to match the signup count beside it, which has always
excluded it. That is not tidying: one agent settlement counted as a purchase
would silence the watchlist line that exists to notice zero human conversion,
and nothing would look wrong. The rail is printed on its own line underneath
whenever it is non-zero, so nothing is hidden either.

## Log

Newest first. One row per intervention, with what it was expected to move, so a
later reader can check whether it did.

### 2026-09-16 — the growth ledger

Shipped the measurement, not a change to the product: channel classification,
the weekly report, the views, the workflow. Expected to move nothing. It exists
so that everything after it can be judged, and so that the next report has a
baseline to compare against rather than a window in which the tracker was
switched on halfway through.
