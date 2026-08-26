# Lifecycle email: the relaunch campaign and the welcome sequence

Status: **pipeline built (2026-08-22), relaunch campaign sent (2026-08-23).**
The unsubscribe endpoint, opt-out column, send ledger and lifecycle sender are
in code. The relaunch campaign script ran on 2026-08-23: 100 accounts granted
and emailed, recorded in full below. The welcome sequence is live for new
signups; its own status block follows.

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
and emailed on 2026-08-23. Those accounts now hold credit lots, so they are
excluded from the welcome sequence by the purchase rule even though the cutoff
would already have excluded them.

Both records of that send were wrong afterwards, for different lengths of time:
CHANGELOG.md for a day, and the status block at the top of this file until
2026-08-26, when the gate review below found it still reading "has not been
sent" twenty lines above the paragraph saying it had. A status line is read as
the current state of the world by anyone who reads no further, so it has to be
corrected on the day the state changes, not contradicted further down.

# Welcome sequence: signup to first pack

Status: **live**. Jake approved the copy on 2026-08-22 (his edits are the
canonical text, mirrored in `lib/welcome-sequence.ts`).

**Emails 1, 4 and 5 were rewritten on 2026-08-26 and are not separately
approved.** Email 4 was rewritten against the reverse-lookup gate that shipped
on 2026-08-25, email 5 was moved off a hardcoded rung onto `PACKS[PACK_IDS[0]]`,
and email 1 gained one clause naming what the free allowance does not cover. Emails
2 and 3 are unchanged and stand as approved. Nothing had been sent under the
old email 4: `SEQUENCE_START` is 2026-08-23 and day 9 falls on 2026-09-01, so
the first cohort reaches it after this change. Email 5's first send is
2026-09-06.

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
figures join `scripts/check-published-figures.ts`. Anything priced comes from
`lib/packs.ts` the same way, and the ask reads `PACKS[PACK_IDS[0]]` rather than
a named rung, so it follows the ladder when a cheaper rung appears underneath.

**A gate change is a copy change.** A PR that moves what a free account may do
must reread the lifecycle copy that sells the feature it moved, and fix it in
the same PR. That covers a `hasPaidAccess` call, an `entitled` prop, a `gate=`
on a locked column or cell, and the rule in `lib/reverse-access.ts`.

This is the failure that produced the 2026-08-26 rewrite. The reverse-lookup
gate moved on 2026-08-25 (#191): an anonymous visitor and a signed-in free
account both now get the wallet **count**, and the addresses stay behind
`hasPaidAccess`. Nothing in the sequence was touched, so welcome-4 went on
selling two credit-gated features to accounts that by construction hold no
credits, under a button reading "Run a free lookup". Copy drift is caught by
reading two files side by side, which is what the paragraph above asks for.
Gate drift is invisible in both files: every sentence in the email was true
when it was written, and no diff touched it.

The drafts passed a 7-critical-readers stress test on 2026-08-22 (one
critical and six high findings, all fixed in place). One accepted tradeoff
remains: the sequence is unpersonalized, which is fine at the current volume.

The second tradeoff recorded here was "the 2.5% industry-average figure is
uncited at its ultimate source (the docs coverage page should cite one)". It is
void, and not because a citation was found. There was no source to cite, so the
figure was purged from every public surface on 2026-08-22, and citing a numeric
industry-average match rate is now banned outright (CLAUDE.md). No draft in
`lib/welcome-sequence.ts` carries it: email 2 says "Typical tools publish rates
in the low single digits", which is the qualitative comparison the ban leaves
standing. The line is corrected here rather than deleted, because a tradeoff
that quietly disappears from the record reads as one that was met.

## Why this sequence

Signups convert at zero today, and every signup already gave us the one
contact field we hold (`users.email`). A signup-to-first-purchase sequence is
the cheapest conversion lever the product has: it needs no new traffic. The
sequence teaches the three facts a buyer needs before a $29 decision (what a
match is, what their chain yields, what reachability means), then asks once.
The ask reads the cheapest rung out of `lib/packs.ts` rather than naming one, so
it follows the ladder if a cheaper rung ever appears underneath Trial.

## Shape

Five emails over 14 days. Trigger: a `users` row is created. Exit early when
the account buys any pack (`credit_lots` row appears). Skip entirely for the
two legacy accounts and whitelisted accounts.

| #   | Day        | Job                             | Subject                                     |
| --- | ---------- | ------------------------------- | ------------------------------------------- |
| 1   | 0 (+5 min) | Deliver the promise, first step | Your first 100 matches are free             |
| 2   | 2          | Set chain expectations honestly | What your chain says about your match rate  |
| 3   | 5          | Differentiate on reachability   | A handle that reaches nobody is not a match |
| 4   | 9          | The free half of reverse lookup | How many wallets are behind that handle?    |
| 5   | 14         | The ask                         | 250 matches, once: $29                      |

The numbers in that table are rendered, not written: the allowance comes from
`FREE_MATCHES_PER_WINDOW` and email 5's figures from `PACKS[PACK_IDS[0]]`. The
code prints whatever those constants hold, so the table is a snapshot and the
constants are the source. The values are deliberately not restated here. This
caption named a pair that `PACK_IDS[0]` did not hold, two lines under a table
showing the pair it did, which is the drift the caption exists to warn about.

One email, one job, one CTA. CTAs 1 to 4 land on the homepage, which carries
both the lookup and the reverse-lookup panel; CTA 5 lands on `/pricing`.

**Every CTA except email 5's must name something the reader can do for
nothing.** The reader is on the free allowance by construction, since a
purchase exits the sequence. Email 5 is the one ask, and it is labelled as a
purchase.

## Drafts

Voice rules: short sentences, plain claims, no hype adjectives, sentence case
subjects, curly apostrophes, onchain one word, never name a data provider.
From: `walletlink.social <noreply@walletlink.social>`. Reply-to:
`help@walletlink.social`. Every email carries an unsubscribe link and a
List-Unsubscribe header.

The line under each button is the email's footnote, and it is part of the copy:
email 1 offers a reply, emails 2 to 4 explain why the mail arrived, and email 5
promises it is the last ask. They are reproduced here because they were missing
from these drafts until 2026-08-26, which made a file that claims to mirror the
code disagree with it on three emails.

### Email 1, day 0: Your first 100 matches are free

Hey, thanks for signing up for walletlink.social. Here’s what you can do with it.

Upload a CSV of wallets, or paste a list. We resolve each wallet against a 4.8 million wallet identity index and return the people: X handles and Farcaster accounts, ranked by holdings times reach.

You have 100 free matches in a rolling 30-day window. A match is a wallet we resolve to an X or Farcaster account. **Wallets we can’t resolve cost nothing**, so a low-match list spends almost none of your allowance. The CSV export is yours either way, every row of it. What credits add is the X list export, the priority score and follower counts, contract import, and the wallet addresses behind a handle.

[Run a lookup]

If anything is unclear, just reply to this email!

Two changes on 2026-08-26. "Paste a contract address" led the second paragraph
and contract import is credit-gated, so the first instruction in the first email
was the one thing the reader could not do; upload and paste are the free paths
and now lead. The last sentence of the third paragraph is new: the allowance is
a match count and `hasPaidAccess` is binary, so an email that states only the
first invites the reader to infer that 100 free matches buys 100 matches' worth
of product.

### Email 2, day 2: What your chain says about your match rate

Most wallet tools quote one match rate. We quote _yours_.

The chain decides the number more than the collection does. Measured across 26 collections and 72,318 holders: Base runs 46.2%, Ethereum 16.6%. Typical tools publish rates in the low single digits. The full coverage breakdown is in our docs.

So before you plan a campaign, check the chain your holders live on. A Base token list resolves nearly half its wallets to an X or Farcaster account. An Ethereum list resolves fewer, and every one it resolves is labelled with the evidence behind it.

[Check your list]

You are getting a short series of emails because you created a walletlink.social account. The unsubscribe link below stops them.

### Email 3, day 5: A handle that reaches nobody is not a match

Of 448,069 X handles we resolved, 69.6% are live. 20.6% are suspended, and 9.7% are names nobody holds any more.

A single coverage number counts all three groups. We label every match with its **reachability**, because a campaign sent to dead handles is obviously worse than a smaller campaign sent to real ones.

The same rule applies to how a match is made. Over 99.9% of our X handles were published by the account owner, through a Farcaster verification or an onchain ENS record. Nothing is guessed from display names or bios.

[See it on your list]

You are getting a short series of emails because you created a walletlink.social account. The unsubscribe link below stops them.

### Email 4, day 9: How many wallets are behind that handle?

A lookup runs in both directions, and the second direction is the one people miss.

**Reverse lookup**. Type an X handle or a Farcaster username and we tell you how many wallets in the index carry it. That count is free: it spends no credits and none of your 100 free matches.

The number on its own is a real answer. Before a partnership, an allowlist or an airdrop, whether a person is attached to any wallet we hold, and to how many, is most of what you wanted to know. **Which** wallets, address by address, is the part credits buy.

[Look up a handle]

You are getting a short series of emails because you created a walletlink.social account. The unsubscribe link below stops them.

Rewritten 2026-08-26, before a single send. The previous draft sold reverse
lookup and the priority column to an account that could open neither, asked an
address question in the subject, and labelled its button "Run a free lookup".
The replacement is the split the product already ships (`lib/reverse-access.ts`,
and the panel description in `ReverseLookup.tsx`): free says how many wallets
carry a handle, credits say which ones. The count is not a teaser. It is one
indexed read served to strangers with no cookie at all, and it answers what a
partnership or an allowlist starts from. Priority was dropped rather than
reworded: it is credit-gated (`column-priority`), the ordering it drives is
already stated in email 1, and one email does one job.

### Email 5, day 14: 250 matches, once: $29

If walletlink.social showed you real matches, here’s the price:

The Trial pack is $29, once. It covers 250 matches (one list, once), and misses are still free. No subscription; credits last 12 months.

Any pack turns on the same things, so the cheapest one opens all of them: the X list export, the priority score and follower counts, the wallet addresses behind a handle, contract import on all seven chains, deep scan with onchain ENS, and API access on the same credits. The CSV export was never behind this line and is not now. The larger packs hold more matches at a lower price each; they do not hold more product.

If your free lookups showed few matches, do not buy. That’s the honest read of your list, and it is why we charge for matches instead of promises.

[Buy the Trial pack]

You won’t get another sales email from us after this one.

Rewritten 2026-08-26, though the rendered text is unchanged. It named
`PACKS.trial` by hand, which is right today and right by coincidence: Trial is
the first key, not the named one. Every figure above, and the pack name in the
button, now comes from `PACKS[PACK_IDS[0]]`, so this email asks for whatever the
entry rung is rather than for the rung that was the entry when it was written.
`scripts/check-invariants.ts` asserts it still names that rung. The feature paragraph
is why the smallest pack is the right ask: `hasPaidAccess` is binary, so the
cheapest pack opens exactly what the largest one opens. The footnote promise
holds, because there is no email 6.

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

Changed 2026-08-26, awaiting Jake's read: emails 1, 4 and 5, for the gate and
the ladder rather than for taste. Emails 2 and 3 were reread against the same
gate and left alone, because everything they describe (the match rate on your
own list, the reachability label on a row, the evidence behind a match) is
visible to an account on the free allowance, and both CTAs run a lookup that
the allowance pays for.
