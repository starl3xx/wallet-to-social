# Lifecycle email: the relaunch campaign and the welcome sequence

Status: **pipeline built (2026-08-22).** The unsubscribe endpoint, opt-out
column, send ledger and lifecycle sender are in code. The relaunch campaign
script is ready behind a dry-run default and **has not been sent**. The
welcome sequence below is approved and live for new signups; its own status
block follows.

## Email 0: the relaunch Trial grant (one-off campaign)

`scripts/relaunch-trial-grant.ts` grants the Trial pack (250 matches, $0)
to every account that never bought, then tells them by email. Dry run by
default; `--to <email>` sends one preview with no grant; `--send` executes.
Idempotent at both steps (synthetic payment id on the grant, the
`lifecycle_emails` unique on the send). The copy lives in the script and
passed its own 7-critical-readers pass. Eligibility excludes legacy tiers,
opt-outs, and anyone already holding any credit lot.

Run order before the first send: `scripts/migrate-email-lifecycle.ts`, then
`scripts/migrate-grant-readonly.ts`, then `scripts/migrate-lifecycle-claim.ts`
and `scripts/migrate-lifecycle-retry.ts`, set `EMAIL_UNSUBSCRIBE_SECRET` in both
.env.local and Vercel, then `--to` a test address, then `--send`.

**The relaunch campaign has been sent.** 100 accounts were granted a trial lot
and emailed on 2026-08-23. This file and CHANGELOG.md both said otherwise for a
day; they were wrong. Those accounts now hold credit lots, so they are excluded
from the welcome sequence by the purchase rule even though the cutoff would
already have excluded them.

# Welcome sequence: signup to first pack

Status: **live**. Jake approved the copy on 2026-08-22 (his edits are the
canonical text, mirrored in `lib/welcome-sequence.ts`).

**Two runners, not one.** `/api/cron/welcome-first` runs every five minutes and
sends `welcome-1` only, to accounts past `FIRST_TOUCH_DELAY_MINUTES` (5).
`/api/cron/welcome-sequence` runs at 15:00 UTC and owns days 2, 5, 9 and 14,
keeping a day-0 pass as a safety net. Both are watched by the health pane. The
delay is deliberate: the account row is written at magic-link _verify_, so an
immediate send would put `welcome-1` in the inbox in the same second as the
sign-in link.

**Enrollment starts at accounts created on or after 2026-08-23**: the earlier
~100 signups are the relaunch campaign's audience and are deliberately excluded
(`SEQUENCE_START`). A purchase or an opt-out exits the sequence.

**At-most-once, with one stated exception.** `claimAndSend` takes the
`lifecycle_emails` row before it sends and writes `confirmed_at` after, so a row
proves delivery rather than intent, and two runners cannot both send. A process
killed between a successful send and that confirm leaves a claim the reclaim
frees after 15 minutes, and that person receives the email twice. The window
resolves in favour of sending on purpose: one duplicate greeting beats a welcome
that silently never arrives.

**A failed send is recorded, not erased.** The row keeps `attempts`, `failed_at`
and `last_error`, retries on an exponential backoff (10, 20, 40, 80 minutes) and
stops after `RETRY_CEILING` (5). Without that, a permanent failure such as an
unverified sending domain would be retried 288 times a day per account, forever.

If the copy changes here, change `lib/welcome-sequence.ts` in the same PR:
the code is the sent truth and this file is its record. Figures in the copy come from
`lib/public-figures.ts` and must track it; if a draft ships to code, its
figures join `scripts/check-published-figures.ts`.

The drafts passed a 7-critical-readers stress test on 2026-08-22 (one
critical and six high findings, all fixed in place). Two accepted tradeoffs
remain: the 2.5% industry-average figure is uncited at its ultimate source
(the docs coverage page should cite one), and the sequence is unpersonalized,
which is fine at the current volume.

## Why this sequence

Signups convert at zero today, and every signup already gave us the one
contact field we hold (`users.email`). A signup-to-first-purchase sequence is
the cheapest conversion lever the product has: it needs no new traffic. The
sequence teaches the three facts a buyer needs before a $29 decision (what a
match is, what their chain yields, what reachability means), then asks once.

## Shape

Five emails over 14 days. Trigger: a `users` row is created. Exit early when
the account buys any pack (`credit_lots` row appears). Skip entirely for the
two legacy accounts and whitelisted accounts.

| #   | Day        | Job                                 | Subject                                     |
| --- | ---------- | ----------------------------------- | ------------------------------------------- |
| 1   | 0 (+5 min) | Deliver the promise, first step     | Your first 100 matches are free             |
| 2   | 2          | Set chain expectations honestly     | What your chain says about your match rate  |
| 3   | 5          | Differentiate on reachability       | A handle that reaches nobody is not a match |
| 4   | 9          | Feature: reverse lookup and ranking | Does that handle already hold your token?   |
| 5   | 14         | The ask                             | 250 matches, once: $29                      |

One email, one job, one CTA. All CTAs land on the homepage lookup (email 5
also links the buy-credits modal deep link if one exists; otherwise the
homepage).

## Drafts

Voice rules: short sentences, plain claims, no hype adjectives, sentence case
subjects, curly apostrophes, onchain one word, never name a data provider.
From: `walletlink.social <noreply@walletlink.social>`. Reply-to:
`help@walletlink.social`. Every email carries an unsubscribe link and a
List-Unsubscribe header.

### Email 1, day 0: Your first 100 matches are free

Hey, thanks for signing up for walletlink.social. Here’s what you can do with it.

Paste a contract address, or upload a CSV of wallets. We resolve each wallet against a 4.8 million wallet identity index and return the people: X handles and Farcaster accounts, ranked by holdings times reach.

You have 100 free matches every 30 days. A match is a wallet we resolve to an X or Farcaster account. **Wallets we can’t resolve cost nothing**, so a low-match list spends almost none of your allowance.

[Run a lookup]

If anything is unclear, just reply to this email!

### Email 2, day 2: What your chain says about your match rate

Most wallet tools quote one match rate. We quote _yours_.

The chain decides the number more than the collection does. Measured across 26 collections and 72,318 holders: Base runs 46.2%, Ethereum 16.6%. Tools that match wallets to social accounts typically publish rates in the low single digits. The full coverage breakdown is in our docs.

So before you plan a campaign, check the chain your holders live on. A Base token list resolves nearly half its wallets to an X or Farcaster account. An Ethereum list resolves fewer, and every one it resolves is labelled with the evidence behind it.

[Check your list]

### Email 3, day 5: A handle that reaches nobody is not a match

Of 448,069 X handles we resolved, 69.6% are live. 20.6% are suspended, and 9.7% are names nobody holds any more.

A single coverage number counts all three groups. We label every match with its **reachability**, because a campaign sent to dead handles is obviously worse than a smaller campaign sent to real ones.

The same rule applies to how a match is made. Over 99.9% of our X handles were published by the account owner, through a Farcaster verification or an onchain ENS record. Nothing is guessed from display names or bios.

[See it on your list]

### Email 4, day 9: Does that handle already hold your token?

Two things people miss on the first lookup.

**Reverse lookup**. Give it an X handle or a Farcaster username and it returns the wallets attached to that person. Useful before a partnership, an allowlist, or an airdrop: does this person already hold your token?

**Priority**. Every result is ranked by holdings times follower reach, so the whale with an audience sits at the top of your list, not row 4,000.

Both come with any credit pack, on all seven chains.

[Run a free lookup]

### Email 5, day 14: 250 matches, once: $29

If walletlink.social showed you real matches, here’s the price:

The Trial pack is $29, once. It covers 250 matches, and misses are still free. No subscription; credits last 12 months. Every pack includes the full CSV export, the X list export, reverse lookup, priority ranking, deep scan with onchain ENS, and API access on the same credits.

If your free lookups showed few matches, do not buy. That’s the honest read of your list, and it is why we charge for matches instead of promises.

[Buy the Trial pack]

You won’t get another sales email from us after this one.

## Implementation state

Built (2026-08-22): `users.email_opt_out` and the `lifecycle_emails` table
(`scripts/migrate-email-lifecycle.ts`, run before deploy; then
`scripts/migrate-grant-readonly.ts` for the CI role), the stateless-HMAC
unsubscribe endpoint (`app/api/email/unsubscribe/route.ts`, GET for humans
and POST for RFC 8058 one-click), and `sendLifecycleEmail` in `lib/email.ts`
(List-Unsubscribe headers, reply-to help@, refuses to send without
`EMAIL_UNSUBSCRIBE_SECRET`). Transactional magic-link mail ignores the
opt-out flag; lifecycle mail honors it.

Built 2026-08-22, split into two runners on 2026-08-24: the daily cron at 15:00
UTC walks the five-email schedule against `users.created_at`, `credit_lots`, and
`lifecycle_emails` (keys `welcome-1` to `welcome-5`), while the five-minute cron
handles `welcome-1` alone. Both heartbeat into `analytics_events`
(`welcome_sequence`, `welcome_first_touch`) and show on the admin health pane.
Those heartbeats are written as `lookup_completed` rows carrying an
`eventSubtype`, and `NOT_A_HEARTBEAT` in `lib/analytics.ts` keeps them out of
every product lookup count.
Conversion metric: a `credit_lots` row with a real payment within 30 days of
email 5; watch it on the admin Growth tab's Lifecycle email card.

Decided by Jake 2026-08-22: the copy above is approved; noreply@ stays the
from address with reply-to help@; the existing ~100 signups do NOT enter the
sequence retroactively, because they are the relaunch campaign's audience.
