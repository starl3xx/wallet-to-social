# Changelog

All notable changes to walletlink.social. Newest first.

### 2026-08-27 (we held the evidence and answered "no wallets")

Some wallet owners have attested two live X accounts through different sources.
The row showed the second one, the CSV exported it, the public API served it as
`twitter.also`, the docs described it, and reverse lookup then answered "no
wallets" when somebody searched for it. Both reverse doors matched
`social_graph.twitter_handle` and nothing else.

- **Both reverse routes now match the second attested account.** A wallet
  matched this way carries a different handle in `twitter.handle` and names the
  searched one under `twitter.also`, so the answer corroborates itself.
- **The gate is the display's gate, not a second one.** Reverse and
  `alsoOnXForWallets` read the same `FROM` clause and the same source
  allowlist, because a wallet returned for a handle its own row does not show
  is worse than the gap it fixes.
- **`MAPPED_SOURCE_IDS` is derived from `SOURCE_CLASSES`**, so the allowlist and
  its enforcement cannot drift into two lists.

**The obvious implementation was unusable, and only a query plan said so.** An
`OR EXISTS (...)` bolted onto the route's `WHERE` reads perfectly and defeats
the index on `twitter_handle`: Postgres sequentially scans all 5,117,875 graph
rows and runs the subplan once per row. **19.7 seconds to return two wallets.**
`handle_conflicts` holds 3,680 rows in total, so resolving the wallets first and
matching them by primary key costs **42ms**, and the cost is set by the conflict
table rather than by the graph. Where a handle has no second-account claim,
which is nearly all of them, the predicate is the one that ran before.

**The first draft also broke a disclosure rule the file states in its own
header.** `/api/reverse` publishes the count to callers with no credits and
withholds the addresses, and the header is explicit that the address query "must
not run for them at all". Building the free count from a resolved wallet list
did exactly the work that forbids, one `console.log` from disclosure. The free
path now counts and the paid path lists, over one `FROM` clause, and the
invariant asserts the order of the two calls around the gate.

**Conflicts nobody can ever act on are now closed.** A conflict where both
handles are dead cannot be accepted (acceptance needs theirs live) and cannot
surface as a second account (that needs both live). It was inert: re-examined by
every run forever, counted in every queue total forever, unable to change any
answer. `closeBothDead` closes them under a distinct resolution, and only on
fresh readings of both sides, because two dead readings from six weeks ago are
not evidence that both are dead now.

Also: the conflict resolver's recheck budget was a fixed 300 credits a day, 14
lookups, against a sibling sweep allowed 96,724 by a formula derived from the
live balance. The backlog of 539 rechecks was cleared by hand (151 conflicts
resolved on 150 wallets, 14,796 credits) and `CONFLICT_RECHECK_CREDITS` is set
in production. 328 invariants, 133 guard mutations.

### 2026-08-26 (the funnel counted events and called them people)

The admin panel had thirteen destinations and four pairs of them answered the
same question in two places, with different numbers. Two of those numbers were
funnels. Underneath, three events had been declared since January and emitted by
nothing, and a fourth was written on every gate and read by nobody.

**The panel: thirteen tabs to nine.**

| was                      | is       | why                                                  |
| ------------------------ | -------- | ---------------------------------------------------- |
| Behavior + Revenue       | Funnel   | both drew a funnel, over different windows and bases |
| Behavior (rest) + Growth | Growth   | cohorts, retention and adoption are one question     |
| Lookups + Usage          | Usage    | both counted lookups and wallets by period           |
| Jobs + Saved lookups     | Records  | two lists of the same runs                           |
| Users + Whitelist        | Accounts | a whitelist grant is an entitlement on an account    |
| Enrichment + Conflicts   | Data     | both are social-graph quality work                   |

**The funnel is now a funnel.** `getSessionFunnel` counts distinct sessions that
reached each step, so a ratio between two steps is a ratio between two groups of
people. The old one grouped events by type, where one visitor opening the
pricing modal six times was six. Both are shown, stacked and labelled, because
the event counts remain the right answer for load and for the paywall work.

- The money tail is forced monotone. The buy-credits modal is the only way into
  a Stripe checkout, so a session that started one did see the pricing whether or
  not the beacon arrived. The steps above it are reported as measured, which is
  why "saw pricing" can exceed "got results": pricing is reachable from the
  marketing pages without running anything.
- "Paid" is joined by account email, because the Stripe webhook has no session,
  and it requires the session to have reached checkout as well. Without that
  second test it read 20 paid sessions against a single payment, because one
  buyer had visited twenty times.

**Three events existed and fired from nowhere.**

- `user_registered`, declared in January, emitted by nothing. The funnel had no
  account step at all, past the gate the whole free allowance is built around.
  It now fires in `getOrCreateUser`, inside the create branch only.
- `history_saved`, same. "History save rate" on the panel was a structural 0%
  for seven months. Saving is a checkbox the user sets, so it is a real
  behaviour; both pipelines now emit it from the point the save succeeded.
- `limit_hit` was written on every free-allowance refusal and read by nothing,
  while a cohort labelled "3+ lookups, hit limit, didn't pay" tested only the
  lookup count. The label had been claiming a test the code never made. It is
  now its own cohort, driven by the event.

**Two conversion rates, named.** There were three under one word: the Pulse tile
divided payments by lookups over 7 days, the revenue pane divided payments by
pricing views over 30, and the behaviour funnel divided everything by page views.
The tile linked to the pane, so the one journey a reader was invited to take
crossed two definitions in silence. `conversionRates` is now the only definition
of either, and both return `null` rather than 0 when there is nothing to divide
by.

**A raw-SQL window bound was five hours short.** Interpolating a JS `Date` into a
`sql` template sends a local-offset string, and these columns are `timestamp
without time zone` holding UTC, so Postgres kept the wall-clock half and dropped
the offset. Measured over 30 days on 2026-08-26: the query builder counted 3,739
events, the same window in raw SQL counted 3,645. The missing 94 were that whole
day. Production runs in UTC and never saw it, which is why it survived, and why
it made every local reading of these queries lie.

Also: `getFeatureAdoption` selected every event row in the window and filtered
eight times in Node, and applied the cron-heartbeat filter to two of those
filters but not the third; it is one aggregate query now. Contract imports carry
a session id, so that gate can be placed in a visit. Payments are split by rail,
since an onchain sale reaches the last step of the funnel having skipped the
three above it. 310 invariants, 26 guard mutations.

### 2026-08-26 (the index write was losing wallets quietly)

Two defects on the one path that persists what a lookup found. Both were
recorded against real jobs in `lookup_jobs.social_graph_write_errors`, and 7 of
the 77 jobs in the last fortnight ended with `social_graph_write_status =
'failed'`. Neither is visible from the outside: the lookup completes, the user
gets their results, and the index simply does not gain the row.

- **`source` was taken on trust at the write boundary.** The field is typed
  `string[]`, and that type is a claim about data we did not create: our own CSV
  export writes it comma-joined, so a customer re-uploading an export sends a
  string back. `asSourceList` already existed for exactly this and was applied
  on the resume path and both display paths; the write path, the one that
  persists, was the one that never got it. It now normalises once, at the top,
  before anything reads the field.
- **It failed two ways on the same input, and the loud one was the lucky one.**
  `isTwitterVerified(r.source ?? [])` threw `.some is not a function` and killed
  the batch. `mergeSources` took the same value and spread a string into single
  characters, storing a provenance list of `['w','e','b','3',…]` with nothing
  raised. `?? []` was never the right guard: it defends against null, and null
  was not the shape that occurs.
- **`db.transaction()` was called unconditionally**, and `neon-http` answers
  that with a throw at call time rather than at build time. So the entire index
  write depended on `USE_CONNECTION_POOLING=true` being set. Production sets it
  and was unaffected; every other environment failed every write, and
  `.env.example` never mentioned the variable. `db/index.ts` now exports
  `supportsTransactions()` next to the driver choice, so the capability cannot
  drift from the driver, and the write degrades to sequential statements rather
  than throwing.
- **Losing atomicity here is the right trade, which is worth stating.** Every
  statement on this path is idempotent: the upsert is `onConflictDoUpdate` keyed
  on the wallet, and the history rows are append-only. An interrupted run leaves
  a prefix written, which the next lookup of those wallets re-derives. A throw
  leaves nothing written and costs the whole batch to the same interruption.
- **Both were classified as transient and retried three times**, at one and two
  seconds of backoff, on writes that could not have succeeded on any attempt.
  Neither message contains a word the classifier looked for. A `TypeError` is
  now permanent by definition: it is raised by this code reaching into a value
  of the wrong shape, so it is a statement about the program, not the
  connection. The driver's refusal is matched on the capability wording rather
  than on the driver's name, so it survives a driver swap.
- **The fallback had a regression of its own, caught in review.** Without a
  rollback, a retry restarted the whole batch, and the upsert is idempotent in
  every column but one: `lookup_count` is `lookup_count + 1`, so every row the
  failed attempt had already committed counted a second lookup that never
  happened. That number is not cosmetic. It promotes a row to quality `medium`
  past 3, pulls it into the hot set `refresh-stale` rebuilds past 5, and orders
  the refresh queue. The retry now carries a cursor and resumes, and the cursor
  exists only where the driver cannot roll back, since a transactional retry
  that skipped committed work would lose it (found by Bugbot, Medium).
- **The classifier's first version was worse than the bug it fixed**, and that
  was caught in review too. It made every `TypeError` permanent. Node rejects a
  network failure as `TypeError: fetch failed`, and `neon-http` issues every
  query through `fetch`, so the rule stopped retrying exactly the transient
  faults the retry exists for, on the driver it exists for. It now matches the
  shape complaint (`is not a function`, `is not iterable`, `Cannot read
properties of`) rather than the type. Measured, because the two are the same
  class and only the message tells them apart: the network one carries a
  `cause` and reads `fetch failed`; the shape one carries none and names the
  value (found by Bugbot, Medium).
- **The assertion covering that case was passing over it.** It built a plain
  `Error('fetch failed')`, which is not an instance of `TypeError`, so it never
  reached the branch under test. It now constructs the error the way Node does,
  `cause` included. The guard separately caught a mutation still anchored to
  the single-line condition that had been rewritten, and therefore protecting
  nothing.
- **A committed prefix was still reported as a total loss.** `succeeded: 0` was
  true while every attempt ran in a transaction, because a failure rolled the
  whole thing back. The resume cursor ended that, and the exhausted-retry
  return was not updated with it: a run that wrote 900 of 1,000 wallets and
  then lost the connection recorded `'failed'` and logged "persist completely
  failed", which sends anyone reading it looking for a write that did happen.
  `job-processor` already had the right `'partial'` branch and simply could not
  reach it. It now reports what committed (found by Bugbot, Medium).
- Thirteen assertions and ten mutations, 295 and 120. The classifier is asserted
  against the two real failures by value, and separately asserted **not** to
  have been widened into always-true, which is how a set of refusal assertions
  passes while protecting nothing.

Not fixed here: the 7 jobs whose writes failed. Their wallets are all in the
graph today, arriving by another path, so there is nothing to replay.

### 2026-08-26 (somewhere to go, and copy that matches the gates)

Two changes that share one shape: the product had already opened a door and had
not told anyone, or was charging for a door that was never shut.

**A first action that needs nothing.**

- Every way into this product asked the visitor to bring a CSV, a contract
  address or a handle, and a signed-in account with no history saw nothing at
  all: `LookupHistory` renders `null` at zero rows. Fifteen of 139 accounts have
  ever run a saved lookup. The homepage now offers three of our own seeded
  collections (`lib/starter-collections.ts`, `components/StarterCollections.tsx`,
  `GET /api/starter-collections`), and a press runs 25 of one's holders.
- **What it saves is the import, not the resolution.** The holder lists are
  already in `wallet_holdings`, so nobody uploads one and nobody pays for a
  contract import. The wallets are then resolved like any other list: the seed
  cron writes the holdings whether or not it had the budget to resolve them, and
  a mean of 71 wallets in a 100-wallet sample have never been checked. A first
  draft of this said the run "costs no external API call at all", which is the
  confident-and-unchecked shape the invariants file exists for.
- **`POST /api/jobs` takes `{ collection }` in place of `{ wallets }`**, expanded
  at the top of the handler so the IP limit, `canSubmit`, the per-lookup ceiling,
  the credit meter and the analytics all see an ordinary lookup. No new gate, no
  separate allowance, no way in that skips the meter. `input_source` is
  `starter_collection`, set server-side, so the funnel can tell the action that
  needed nothing from the one that needed a contract.
- **A collection that is not seeded is refused before a wallet is read.** Without
  that this is an unmetered import of anybody's holders, on any chain, at our
  expense.
- **Capped at a quarter of the free allowance.** The cap is the worst case,
  because every wallet in a sample might match, and the panel offers the MOST
  reachable collections it can find, which is the opposite end of the
  distribution `MEASURED_MATCH_RATE` describes. Measured, the three cards resolve
  85, 25 and 35 of their first 100 wallets, so a 100-wallet cap would have spent
  85 of the 100 free matches on one press.
- **The holder report's CTA carries its collection**, and no longer offers
  "paste any contract address", which is credit-gated.
- **The route no longer answers when it fails.** It caught a database error and
  returned an empty list with a 200; the response is the cache entry, so one
  transient error was stored as a successful empty answer and the cards stayed
  hidden for an hour. It throws now, like `/holders` and its
  `generateStaticParams`, which read the same corpus (found by Bugbot, Medium).

**The lifecycle copy, reconciled with the gate it sells.**

- The reverse-lookup gate moved on 2026-08-25 (#191) and nothing reread the copy
  underneath it. **welcome-4**, first send 1 September, sold reverse lookup and
  priority ranking, both credit-gated, under a button reading "Run a free
  lookup". It now sells the split the product ships: free tells you how many
  wallets carry a handle, credits tell you which ones, under a CTA a free account
  can press. Nothing had gone out under the old text.
- **welcome-1's first instruction was the one thing the reader could not do.** It
  opened with "Paste a contract address"; contract import is credit-gated.
- **welcome-5 reads `PACKS[PACK_IDS[0]]`** instead of naming Trial by hand. Trial
  is the entry rung today by coincidence, not by construction: it is the first
  key, not the named one, and a cheaper rung underneath would leave the only
  sales email in the sequence selling the second one.
- `docs/EMAIL-SEQUENCE.md` matches the code again, and gains the rule that
  produced this: **a gate change is a copy change**.

**Nine surfaces were selling things that are free.**

- `ExportButton` branches only the X list on `entitled`; the CSV button has no
  gate at all, and `stampReachability` writes X reachability for every result
  set. Both were listed as pack features in the buy-credits modal, in
  `PackPricing` on `/pricing` and six comparison pages, in the schema.org FAQ
  answer that ships in every page's head, in `/llms.txt`, in the published docs,
  in `PROJECT_OVERVIEW.md` and in two lifecycle emails. It is welcome-4's defect
  pointing the other way: copy written from what the product was assumed to
  charge for instead of from the gate.
- **The line is on the fields, not the file.** `job-processor` sets
  `priority_score` and `fc_followers` to undefined whenever `paidData` is false,
  so those two columns are blank in a free CSV as well as locked in the table. A
  first pass at the docs fix asserted the opposite, from reading the export code
  without reading the processor that fills it.

**Guards.**

- Fourteen assertions and eleven mutations, 282 and 110. Four of the mutations hold
  the pack ladder (per-match price only ever falls, `PACK_IDS[0]` really is the
  cheapest, the ascending finder cannot recommend too large a pack, no two packs
  share a Stripe price variable), one holds the sales email to the entry rung,
  and the rest hold the starter path.
- **Three of the new assertions could pass over the thing they protect**, and
  each was found by writing the mutation rather than by reading the assertion.
  Two used a bare `indexOf`, which answers -1 for an identifier that is not there
  at all, so a deleted gate sorted before everything and satisfied both. The
  third asserted that `getHolderCollection(` precedes `wallet_holdings`, which
  stays true when the lookup is kept for its name and only `if (!collection)
return null;` is deleted: that compiles under `collection?.` and expands any
  contract on any chain. The refusal is the middle term now.
- **`scripts/check-invariants-guard.ts` does not survive being killed.** It
  restores each mutation in a `finally`, which SIGTERM skips, so a run cancelled
  at a timeout left a real defect (#189, uploaded CSV columns overwriting
  pipeline fields) sitting in the working tree. It takes over two minutes: let it
  finish, and do not run it while anything else is editing the files it mutates.

### 2026-08-25 (three blind spots, closed)

- **`/api/reverse` now emits an event.** The app's reverse lookup, the primary
  action on the page that receives 91% of traffic, wrote no analytics at all, so
  an engaged visitor and a bounce were the same row. It is fired from the client
  so the event carries a session id, which the server-side lookup events do not,
  and it records `locked` so the free half of the endpoint can be told apart
  from the paid one.
- **`users.acquisition` holds where an account came from.** It is written on
  insert only: first touch, not last. An update on an existing user would rewrite the acquisition
  source at every login and the column would converge on whatever people last
  clicked.
- **Not `users.origin`.** That column says which rail minted the row, and
  `getBalance` reads `'x402'` there to withhold the free allowance. A query
  showing 139 nulls in 139 rows made it look unused; unused and unpopulated are
  different facts, and the schema comment said which one it was. Sharing the
  column would have let a posted `origin: "x402"` mint a magic-link account that
  silently never receives its 100 free matches (found by Bugbot, High).
- **The attribution travels with the magic link token**
  (`magic_link_tokens.acquisition`,
  `scripts/migrate-first-touch.ts`). The browser that knows the first touch is
  the one that typed the email; the browser that creates the user row is
  whichever opens the mail, routinely a webmail preview or a link scanner.
  Reading it at verify time would have credited a share of every campaign to
  Gmail, which is worse than null because it looks like data.
- **First touch is captured once per browser** (`lib/first-touch.ts`): the
  referring host, `?ref=`, and the three UTM parameters, reduced to one
  groupable string. Stored in `localStorage`, never overwritten.
- **The referring host, never the referring URL.** Other sites put search terms,
  private document paths and their own session tokens in the addresses they link
  from. `referrerHost` reads `hostname` and discards everything else, and the
  invariants push URLs carrying a reset token and a search query through it. A
  self-referral returns null, or the site becomes its own biggest traffic source
  within a day.
- **The privacy policy says so**, because a referring domain and a campaign tag
  are not covered by "page views and product events".
- 69 assertions and 10 mutations, 233 and 82. One of them strips comments
  before reading source, because the assertion that the signup path never writes
  `users.origin` matched the comment explaining why it must not. The guard caught one of the new
  assertions passing while the code it protected was deleted: the "absurd query
  cannot produce an unbounded origin" case used a 300-character host, which
  fails the hostname check and drops out, so the total never approached the
  bound. The input is now long and valid, and a second assertion proves the
  unclamped string really would exceed it.

### 2026-08-25 (the slow source gets a ceiling)

- **The per-request timeout is 6s, down from 15s.** A wallet that has not
  answered in six seconds is not going to: across 208 healthy batches the
  slowest wave of 100 took 2.79s, so six is more than double the worst ever
  observed. The old 15s cost nothing while the upstream was healthy and
  everything when it was not.
- **A batch now has a deadline**, `max(30s, waves × 4s)`, and returns what it
  has when the budget is spent. Measured against the worst healthy batch (83.7s
  at 2,999 wallets) and against 13 August's median of 229s, which it would have
  cut to 120s.
- **Every wallet the deadline skips is recorded as unreached**, which matters
  more than the speed. The pipeline persists a negative only when a run
  completed without API failures and then trusts it for 30 days, so a silently
  dropped wallet would write a false "checked, has nothing" that no later lookup
  would correct.
- **A truncated batch says so** rather than reporting an upstream failure. The
  two produce the same count and only one of them is a decision this code made.
- **The 14% failure rate was one day, not a rate.** 30 of the 35 failures in the
  last month happened on 13 August, when roughly half of every batch went
  unreached; since 17 August there have been three. The earlier reading averaged
  a single incident across a month and reported it as steady state.
- **The cache was the other half of it, and it was missed.** `failedWallets`
  blocks the 30-day graph negative, and an unreached wallet still fell into the
  `['none']` branch of the 7-day `wallet_cache` write: cached as "checked, has
  nothing", read by later lookups, which then skipped the APIs entirely. Same
  failure the deadline exists to prevent, on the shorter of the two TTLs, which
  is why guarding only the graph looked complete. Found by Bugbot, High.
- 15 assertions and 7 mutations, 268 and 99.

### 2026-08-25 (a lookup now belongs to a visit, and a sale is recorded)

- **`lookup_started` and `lookup_completed` carry a session.** All 1,597 of them
  had none: both are emitted server-side and nothing told the server which visit
  it was serving, so the funnel could not answer "how many arrivals ran a
  lookup", which is the most useful question about this product. The browser
  sends its session id, `/api/jobs` validates it as a UUID before use, and it is
  stored on the job (`lookup_jobs.session_id`) because the completion is emitted
  minutes later by a worker that has only the row.
- **`payment_completed` was not broken, it was on the retired path.** Its only
  emitter sat inside the legacy tier purchase, which two accounts ever made, so
  it had fired exactly once in the lifetime of the table while every credit pack
  ever sold went unrecorded. Both live rails now book the sale where the credits
  are granted, awaited rather than floating, and only on the branch that
  actually wrote, so a repeated webhook or a replayed settlement cannot book a
  second sale. A hand-issued credit is not a sale and stays silent.
- **The funnel reports sessions and engaged sessions, both.** A session is
  engaged if it did more than arrive once: two events, or one that is not a
  pageview. Measured over the last 30 days that is 201 of 1,487, 13.5%.
  Reporting only the raw count makes the product look fifteen times worse at
  converting than it is; reporting only the engaged count quietly discards
  traffic somebody paid for. It is deliberately a statement about what a session
  did, not a verdict on what it was.
- **A failed funnel query now says so.** The catch returns a fully populated
  object of zeros, so a broken query and a quiet week render identically. That
  is not hypothetical: a `db.execute` result read as an array instead of
  `{ rows }` threw, and the funnel reported zero of everything while the
  database held 1,487 sessions. The panel now shows that the numbers were
  invented rather than measured.
- 20 assertions and 7 mutations, 253 and 92. The guard caught three of the new
  assertions passing while the code they protected was deleted, and one of the
  new mutations having no teeth.

### 2026-08-25 (the gate fired before the answer)

- **The reverse lookup on the homepage now answers everybody.** A caller
  without credits gets the count of wallets carrying the handle; the addresses
  still need a pack. Previously the panel opened the pricing modal on click,
  before any request was sent, so the first thing a stranger saw after typing a
  handle was a price and nothing else.
- **The rule is not new, only newly applied.** `/api/reachability` has always
  published that count for free and keyless, and `/check` explains the split to
  the reader in those words: how many wallets carry a handle is free, which ones
  is the product. `/api/reverse` was the one surface that implemented neither
  half.
- **Signing in was never the thing that unlocked it.** The server gate is
  `hasPaidAccess`, so an account changed nothing. The endpoint no longer answers
  a missing or expired cookie with 401: anonymous is a caller, not an error, and
  it was refusing strangers a disclosure the keyless endpoint hands out freely.
- **What prompted it.** In the two days after the QR auction, 57 sessions hit
  that gate having been shown nothing, and 37 created an account trying to get
  past it. Every reverse-lookup paywall hit in the database is from those two
  days.
- **The locked branch returns before the row query runs.** Withholding the
  addresses in the response is not enough on its own: a version that read every
  wallet and then declined to print them would have the same response shape and
  hold the addresses in memory. `lib/reverse-access.ts` builds the locked body
  and cannot be handed rows at all.
- **The free branch is bounded per address**, at the same limit and for the same
  reason as `/api/reachability`: one indexed read, capped so the count cannot be
  used to enumerate the index.
- **The panel says which half is free before the button is pressed**, and links
  `/check` for the no-account version. It was reachable from nowhere on the page
  that receives most of the traffic.
- 29 assertions and 6 mutations, 193 and 69. Two mutations cover the shapes that
  hide this rather than cause it: a locked body that leaks one address as a
  taste, and a limiter that is registered but never called.

### 2026-08-25 (a CSV column that overwrote the pipeline)

- **Fixed: opening a job in Admin > Jobs could take the whole page down** with
  `source?.map is not a function`.
- **The cause was upside-down precedence.** `lib/job-processor.ts` built each
  result as `{ wallet, source: [], holdings, ...walletData }`, spreading the
  uploaded CSV columns **last**, so a column name could overwrite a field the
  pipeline owns. `source` is the one that bites: our own CSV export writes it as
  a comma-joined string, so a customer who exported results and re-uploaded that
  file replaced `string[]` with `"web3bio,neynar"`. `wallet` and `holdings` had
  the same exposure.
- **Nothing threw where it happened.** Every later stage does
  `[...existing.source, 'cache']`, and spreading a string spreads its
  characters, so that job's provenance quietly became a list of letters.
  `source.includes('neynar')` kept returning true by substring match, and
  `source.length === 1 && source[0] === 'none'` started reading a character
  count. `publicSources` iterated the string, matched no class, and returned
  `undefined`, so the evidence column silently vanished from the export. The
  admin viewer called `.map` and was the only surface loud enough to notice.
- **Measured before fixing:** 480,674 stored result rows held an array and 2
  held a string, across one job and four saved lookups.
- **Three changes.** The uploaded columns are spread first, so a column cannot
  win a collision with a computed field. `asSourceList` in `lib/api-sources.ts`
  recovers a joined string rather than discarding it, since that is the shape
  that actually occurs. Both read paths coerce, so the rows already stored
  render instead of crashing, and no customer data was rewritten to achieve it.
- **Fixed in both pipelines.** Review caught that `inngest/functions/wallet-lookup.ts`
  is a second copy with the same defect in two more object literals, and it is
  the path every upload above the inline threshold takes: the first fix landed
  in the less used branch. The assertion had agreed with it, because it named
  `lib/job-processor.ts` and checked only that. It discovers the sites now, so
  a third copy is caught the day it is written.
- **22 new invariants and 9 new guard mutations**, taking both to 141 and 52.
  The first mutation is this bug reintroduced verbatim. The guard also caught
  the replacement assertion passing by matching nothing: it read only the text
  before `source: []`, so the broken ordering, where the spread comes after,
  skipped the check entirely.

### 2026-08-25 (a post about what the API is for)

- **"Nine things to build with a wallet address, and the calls that do them"**,
  published 25 August. Nine worked recipes: three that need only `curl`, three
  that turn on the reachability field, and three that only became possible once
  an agent could call the API itself (MCP in Claude, MCP in Claude Code, and an
  agent buying its own credits over x402).
- **Every response body in it is real.** A temporary key was minted against
  production, each call was made, the output was pasted in, and the key was
  revoked. An invented `meta` block in a post about an API is the kind of error
  a reader finds before we do.
- Four figures registered in `scripts/check-published-figures.ts`: the three
  reachability shares and the agent count. The post states them in the phrasings
  the existing patterns already match, so the scheduled sweep checks them like
  every other published number.

### 2026-08-25 (one name for the entity)

- **`LEGAL_ENTITY` in `lib/site-url.ts`**, read by the privacy policy, the
  footer and `llms.txt`. The privacy policy had said "Starl3xx Labs", written
  from memory, on the one page where the name is a legal claim rather than a
  footer credit. The correct value, "Starl3xx Labs LLC", was already in the
  repository in two places and was not read. A name looks too obvious to check,
  which is why it is the kind of fact that drifts. An invariant asserts none of
  the three spells it out, and a mutation proves the assertion catches it.

### 2026-08-25 (a privacy policy, and the cleanups that make it true)

- **`/privacy`**, linked from the footer and in the sitemap. Required for a
  directory submission, which rejects a missing one outright, and overdue on
  its own: the site collected email addresses, payments, lookups and IP
  addresses and said nothing anywhere about any of it.
- **Every retention period it states is one the code enforces.** Writing it
  turned up the reason it could not have been written honestly before: three
  cleanup functions existed and **nothing called any of them**, so sessions,
  spent sign-in tokens and hourly IP buckets had accumulated since the day each
  table was made. `app/api/cron/cleanup/route.ts` runs daily and calls all
  three, and adds an expiry to analytics events, which had none at all despite
  each row carrying a browser identifier and sometimes an email address.
- **The numbers are read out of the constants, never restated.** The policy
  imports `CACHE_TTL_DAYS`, `ANALYTICS_RETENTION_DAYS`, `SESSION_DURATION_DAYS`
  and four more, so the published figure and the code that enforces it cannot
  disagree. An invariant asserts each one is read rather than written as a
  digit, and a mutation proves the assertion catches it.
- **The section worth reading twice is "Addresses you look up".** It says
  plainly that a resolved mapping joins a permanent index and answers other
  people's lookups, and equally plainly that nothing about _who looked it up_
  is ever shared. That is how the product works, and a policy that left it
  implied would be the most misleading thing on the page.
- **A removal route for people in the index**, who may be in it having never
  used the service. No proof of ownership is asked for, because the alternative
  is demanding more information from a stranger than we already hold on them.
- **Processors are named by role**, except identity sources, which are a
  category. That is what GDPR article 13(1)(e) permits, and it keeps the
  sourcing rule in CLAUDE.md intact.

### 2026-08-25 (OAuth for the MCP server)

- **The MCP server is an OAuth 2.1 resource server.** Add
  `https://walletlink.social/api/mcp` to a client that supports it and the first
  tool call opens a consent screen: no key to create, copy or paste. The bearer
  key still works and every existing installation is untouched.
- **Why.** Anthropic's software directory policy, section 5.D, requires OAuth
  for an authenticated remote MCP server. A static bearer key does not satisfy
  it whatever else is true of the server, so a directory listing was blocked on
  this and on nothing else.
- **The whole authorization server is in this repo.** RFC 9728 protected
  resource metadata, RFC 8414 authorization server metadata, RFC 7591 dynamic
  registration, RFC 7009 revocation, client ID metadata documents, RFC 9207
  issuer identification, and PKCE with `S256` required rather than offered.
  Every client is public and no client secret is issued.
- **The access token is an `api_keys` row.** Metering, the three rate-limit
  windows, the balance check and the usage ledger all key off that table, so
  anything else would have meant a second copy of each, which is where a meter
  starts disagreeing with itself. `expires_at` bounds a token to an hour,
  `revoked_at` ends it, and one new column, `oauth_grant_id`, tells it from a
  key somebody pasted into a config. The consequence is written down rather
  than implied: an access token also authenticates a REST call, because the
  five tools are the six endpoints and there is nothing on one surface that is
  not on the other.
- **Refusal is a 401, never a tool error.** A 200 carrying `isError` is read by
  a client as a tool that failed: the model is handed the text and the turn
  moves on, no token is refreshed, nobody is offered a connection. A mistyped
  bearer key is the deliberate exception, because that person needs to read
  "your key is invalid" and has no connection to repair.
- **The discovery documents are rewrites in `next.config.ts`, not routes.** The
  App Router does not route a directory whose name begins with a dot, and does
  not say so: an `app/.well-known/` route compiles, emits no warning, and is
  absent from the build. Found by building it and reading the route list.
- **The sign-in detour carries nothing a client supplied.** `/oauth/authorize`
  validates and stores the request first, then refers to it by an opaque id, so
  the magic-link round trip has no attacker-controlled URL to carry.
- **Refresh tokens rotate and the replaced value is kept.** Presenting it is
  proof of a leak rather than a bad string, since the real client already
  exchanged it, and that revokes the grant. A replayed authorization code does
  the same.
- **Connected applications** are listed and revocable from the API keys modal,
  and not gated on holding credits: an account on the free allowance can
  connect a client, so it must be able to disconnect one.
- **The key cap no longer counts access tokens.** Without the exclusion,
  connecting a client would push a dashboard key past the cap and revoke a
  credential somebody was using.
- **The exchange validates before it spends.** Review caught the first version
  consuming the authorization code and checking `client_id`, `redirect_uri` and
  PKCE afterwards. A single attempt with a wrong verifier therefore burned the
  code and made the real client's retry look like a replay, which revoked the
  grant: anybody who could see a code could destroy the connection behind it
  while holding nothing else. Two smaller ones alongside it: `redirect_uri` is
  now required on the exchange rather than compared only when supplied, since
  the authorization request always carries one and comparing it optionally is
  the same as not comparing it; and a consent that loses a double-click race
  revokes the grant it just wrote, which was otherwise holding a slot in the
  per-account cap and pushing a live connection out of it.
- **A failed exchange no longer misreports itself.** Review found two more in
  the same place. A code near its expiry was judged by the Node clock in
  `loadCode` and by Postgres's in the consume, so an ordinary first exchange
  arriving a moment late failed the second and was read as a replay, which
  revoked the connection it was trying to establish. And because expiry was
  checked before `consumed_at` was visible, a replay that arrived after the
  window reported as merely expired and revoked nothing, which is the case
  replay detection exists for. One clock decides now, and `consumeCode` returns
  four outcomes rather than a boolean, because a boolean forced the caller to
  guess and it guessed wrong in both directions.
- **97 new invariants and 33 new guard mutations**, taking both to 119 and 43.
  Every claim above that says an attacker cannot do something is an assertion
  that tries it, and every assertion is proved to catch a real deletion.

### 2026-08-25 (the guard that tries the attack)

- **`scripts/check-invariants.ts`**, 22 adversarial assertions, run on every
  PR. Each one is an attacker doing the thing a comment claims is impossible.
- **Why.** Four defects reached review on 24 and 25 August with the same shape:
  a comment asserting a security property, and nothing that could contradict
  it. "Possession of the payload is proof", when every field of a settled
  payment is public onchain. "A replayer also needs the reply", when they
  replay from their own socket. "A header means this is metered", when
  `Bearer hunter2` is not a key. "This table is in the nightly dump", when it
  was in neither dump list. Each was checkable in seconds; none was checked
  twice. CI enforced button radius, palette, contrast and control height on
  every PR and nothing about the money path.
- **`scripts/check-invariants-guard.ts` reintroduces ten real defects and
  requires each to be caught.** It earned its place immediately: **four** of the
  first draft's assertions passed while the code they protected was deleted.
  The TTL assertion signed the wrong message, so the request was refused by the
  message binding and the TTL was never reached. The HMAC assertion recomputed
  the HMAC locally and so verified itself. The backup assertion used `[a-z_]+`,
  which cannot match a table name containing digits, and
  `x402_recovery_redemptions` has three. The fourth was found by review after
  the first three were fixed: the future-date assertion reused a live token
  with a different timestamp, so the HMAC refused it first and the `age < 0`
  branch was never reached. It was the assertion written immediately after the
  stale-challenge one, making the same mistake that had just been corrected
  three lines above.
- `issueChallenge` now takes an optional `issuedAt`, so a check can exercise it
  at a chosen moment rather than reimplementing what it is testing.
- No test framework, no new dependency, no database and no secrets, so it runs
  on a fork's pull request.

### 2026-08-25 (saying the rail exists)

The onchain rail went live and nothing pointed at it but its own docs page.

- **`/vs/formo` gains the row the rail was built for.** Both sides now take
  USDC on Base with no account, which makes it the one row comparing like with
  like. The difference is what the money buys: Formo charges a fixed $0.05 per
  address whether or not it resolves, and the Agent pack is $1 for 12
  **matches**, about $0.0198 an address, with a wallet that resolves to nobody
  costing nothing. Roughly 2.5x further on a list that matches at our measured
  rate. Both figures are derived from `lib/packs.ts` rather than written down,
  so the copy cannot drift from what the rail charges.
- **`llms.txt` gains a section**, which matters more than the rest: it is the
  surface an agent actually reads, and an agent is who the rail is for. Price,
  what a dollar buys, that misses are free, and how to recover a lost key.
- **README** gains a feature row and a section on the design.
- **The pricing UI is deliberately untouched.** `PackPricing` and
  `UpgradeModal` say nothing about the Agent pack, because a $1 pack shown
  beside a $29 Trial is the cannibalisation that keeping it out of `PACKS`
  exists to prevent. A surface that should advertise it imports `X402_PACKS`
  explicitly.

### 2026-08-25 (key recovery, which the payment could never provide)

`GET /api/x402/recover?wallet=…` issues a challenge; signing it with the wallet
that paid returns a new API key against the same credits. Off unless
`X402_RECOVERY_SECRET` is set.

- **This is the endpoint three failed attempts inside `/buy` were reaching
  for.** Each tried to serve a key to a returning payer from the payment
  payload: first on `from` and `nonce`, then on the EIP-3009 signature over
  them. All are published when the payment settles, the first two in USDC's
  `AuthorizationUsed` event and the third in the settlement transaction's
  calldata. **Nothing a caller can copy from a settled payment distinguishes
  the buyer from anyone reading Base.** Proving current control needs a value
  the wallet could not have seen in advance, which is a challenge this server
  issued.
- **The challenge carries no database row; the redemption does.** Verifying it
  is a stateless HMAC over the wallet and the moment, the same shape
  `unsubscribeUrl` already uses, under its own secret so rotating it
  invalidates only recovery challenges.
- **A short window is not single use, and the first version confused the two.**
  It relied on five minutes, reasoning that a replayer would also need to read
  the reply carrying the key. They do not: they send the captured request from
  their own connection and receive their own key in their own response. With
  the three-key cap they could also fill it and lock the buyer out of the
  recovery they were trying to use. `x402_recovery_redemptions` records a spent
  challenge, insert-first so the primary key decides a race rather than a read
  both redemptions pass. Verified: the buyer's redemption returns a key, an
  immediate replay returns 409, and two simultaneous redemptions of one
  challenge produce exactly one key.
- **The message is written to be read in a wallet**, because that is where it
  is shown: it says what it authorises, says no funds move, and names the
  wallet and the moment, so a signature captured for one purpose cannot be
  presented for another.
- **A challenge is issued for any wallet, whether or not it ever bought.**
  Refusing early would make the endpoint a free oracle for which wallets hold
  credits. Whether an account exists is answered after a signature proves who
  is asking.
- **The key is minted, not recovered.** Only a hash was ever stored, so the
  original cannot be produced by anyone including us. The credits are
  untouched: they belong to the account rather than to the key.
- Scoped to `origin = 'x402'`, so a signature can never open an account created
  some other way if `users.wallet` is ever written by something else. Bounded
  at 30 requests an hour per IP under a new `/api/x402` key, since asking for a
  challenge costs nothing.
- Verified against a production build with a seeded account: an unsigned
  request, a different wallet's signature, a forged token, a tampered
  `issued_at`, an expired challenge and a wallet with no account are all
  refused with one message and no key; the real buyer signing a live challenge
  is served.

### 2026-08-24 (the onchain rail)

Step five of the sequence. `POST /api/x402/buy` sells a $1 Agent pack for USDC
on Base, with no account, no card and no email. Off by default: without
`X402_PAY_TO` the endpoint answers 503, because a payment rail with a default
address is a rail that pays somebody else.

- **A pack, never per call.** The `exact` scheme charges before anything has
  resolved, which contradicts the one thing this product is sold on. The rail
  sells credits, the credits are metered on matches exactly as a card purchase
  is, and misses stay free.
- **$1 buys 12 matches, about 51 resolvable addresses at the measured rate.**
  That is $0.0198 an address, against $0.05 for the nearest comparable
  per-request service, and one dollar is exactly one full `/v1/batch` call.
- **The pack is deliberately not in `PACKS`.** `PACK_IDS` drives the pricing
  grid, the upgrade modal, the schema.org offers, `llms.txt`, the public price
  endpoint and nine comparison-page renders, so a fifth key would have appeared
  in all of them. `X402_PACKS` keeps it out, and because
  `app/api/checkout/route.ts` resolves a Stripe price through `isPackId()`,
  `agent` cannot be bought with a card at all. The gate is structural rather
  than a filter somebody has to remember.
- **Payments are remembered by the authorization, not the transaction hash.**
  The hash is unknown when a facilitator times out and can name an unmined
  transaction on a `settlement_pending`, so keying on it would double-grant in
  exactly the case the key exists to prevent. `credit_lots.settlement_id` holds
  `<network>:<from>:<nonce>` from the EIP-3009 authorization, which is fixed
  before settlement is attempted and which USDC itself refuses to honour twice.
  A separate column from `stripe_payment_id`, because that one is read as "this
  was a card sale" by two other queries.
- **The EIP-712 domain is the detail that silently breaks everything.** The
  first working version emitted `extra: {}`, which produces signatures that
  cannot recover to the payer, so every payment is rejected for no visible
  reason. Passing the price as money rather than as an explicit asset makes the
  SDK fill the domain from its own table: `USD Coin` version `2` on Base
  mainnet, and `USDC` on Base Sepolia, which is also how a testnet-verified
  rail fails on mainnet.
- **An x402 account gets no free allowance.** It cannot be created without a
  settled payment, so there is no faucet at signup; the faucet would be on the
  other side, where a spent lot falls back to 100 matches every 30 days for a
  wallet that cost a dollar to create. `getBalance` withholds it for
  `origin = 'x402'`.
- **The account is real but unreachable, on purpose.** Credits hang off
  `users.id` through five NOT NULL foreign keys, so a wallet that pays needs a
  row. Its email is synthetic under `.invalid`, reserved by RFC 2606 and
  guaranteed never to resolve, and `email_opt_out` is true from the moment the
  row exists so every lifecycle send already skips it. `ON CONFLICT DO NOTHING`
  plus a re-select rather than read-then-write, so two settlements from one
  wallet cannot 500 a buyer who has already paid.
- **A settled payment can be retried, which the first version could not do.**
  Settlement is the one step that cannot be repeated: the EIP-3009
  authorization is spent onchain the first time, so a second `settlePayment`
  for the same payload fails. Going straight to settle meant a caller who lost
  the response retried into a settlement error and never reached the idempotent
  grant that exists to serve exactly them. They had paid, and the only route to
  their key was a support thread. The settlement is now looked up before
  anything is verified or settled, which is also what makes the documented
  `newly_granted: false` reachable at all. A fresh key rather than the old one,
  because only its hash was ever stored, bounded at three active keys per
  account so a replayed payload cannot mint without limit.
- **A replay reports, and mints nothing.** Two attempts at reissuing a key to a
  returning payer were both wrong in the same way. The first matched on `from`
  and `nonce`, which are in USDC's public `AuthorizationUsed` event. The second
  verified the EIP-3009 signature, which the facilitator submits as
  `transferWithAuthorization` calldata, so it is public too. **Once a payment
  settles, every field of it is on a public chain**, and nothing in a payment
  payload can prove who holds the wallet afterwards. Proving that needs a
  challenge this server issued, which is a recovery endpoint and not this one.
  The replay branch now returns the balance and the settlement reference, and
  `signedByPayer` was deleted rather than left as a security helper that
  secures nothing.
- **The key cap no longer fails a purchase that already settled.** The pack is
  recorded before the key is minted, so throwing at the cap answered
  `GRANT_FAILED` for a payment that had succeeded and credits that existed. A
  capped account now gets 200, the balance, and the reason there is no fourth
  key.
- **One manual path, and it is loud.** Settle happens before the grant, because
  granting first would hand out credits for a payment that might fail. A
  database failure in between takes money without recording it, so that case
  logs the settlement reference at error and answers 500 rather than returning
  a key it did not create. The grant is idempotent on that same reference, so
  it can be issued by hand and cannot be issued twice.
- Verified against a production build: 503 unconfigured, a correct v2 challenge
  configured, and all three malformed-payment paths refused before anything
  settles.

### 2026-08-24 (two money bugs, found on the way to x402)

Groundwork for the x402 rail, aimed at what the code actually does rather than
at what the brief assumed. Both of these are on the **live Stripe path** and
neither needs x402 to bite.

- **A failed grant was reported as an already-completed one, and the purchase
  was lost.** `grantPack` caught every error and returned false, with a comment
  asserting the cause was a unique violation. The webhook reads false as
  "already granted", logs exactly that, and answers 2xx, so Stripe never
  retries. Any transient database failure therefore charged a customer and gave
  them nothing, and the only line in the log said the opposite of what had
  happened. It now returns false only for a genuine duplicate and throws
  otherwise, so the webhook answers 500 and Stripe retries; `grantPack` is
  idempotent, so a retry after recovery grants exactly once.
- **The duplicate test could never have fired anyway.** Drizzle wraps every
  driver error in a `DrizzleQueryError` and puts the original on `.cause`, so
  `error.code` is `undefined` and only `error.cause.code` carries `23505`. A
  check on the top-level code reads as correct and matches nothing.
  `isUniqueViolation` walks the cause chain, and was verified against this
  repo's own Drizzle rather than assumed.
- **`drawDown` could spend a lot past its own limit.** It read `granted` and
  `consumed`, computed the take in JavaScript, then added it. The increment was
  atomic; the number being incremented by was stale. Two debits in flight for
  one account both read the same `consumed` and both added a take computed from
  the same room. Demonstrated against Postgres: a lot with 150 of room took two
  concurrent debits of 100 and finished at **200 consumed against 150 granted**.
  The take is now computed inside the statement under `FOR UPDATE`, and the
  amount actually taken is returned rather than assumed. Same scenario now
  lands on exactly 150.
- That invariant is stated in this function's docstring and in `db/schema.ts`
  ("Always <= granted") and has no constraint behind it. `LEAST` makes the
  overshoot unrepresentable rather than merely unlikely.

### 2026-08-24 (prettier, enforced instead of dormant)

- **Formatted the repo and added `.github/workflows/format.yml`.** 170 files
  changed. Prettier had been installed for months with nothing running it: no
  CI, no git hook, no lint-staged, and `eslint-config-prettier` installed and
  never imported. 150 of 352 files had drifted out of conformance.
- **The unenforced middle was the dangerous state.** A formatter that runs on
  every commit is safe, because drift never accumulates. One that never runs is
  harmless dead config. One that runs occasionally against a 43%-nonconformant
  repo turns every `npm run format` into a hundred-file rewrite nobody can
  review, which is exactly how a one-line fix earlier today arrived as a diff
  with an unrelated reflow in it.
- **Verified by rendering, not by reading the diff.** The visible text of all 93
  prerendered pages was captured before and after: identical. eslint reports the
  same 12 errors and 19 warnings on the same four files as before, so nothing
  new was introduced.
- **Formatting broke a guard, which is worth knowing about.** The published-
  figures registry looks for the 13% on the share card with a regex that
  assumed the number sat on the same line as its opening `<span>`. Prettier
  reflowed that element across ten lines, and the guard reported `NO MATCH` on
  a page where nothing had changed. The pattern now tolerates whitespace
  wherever the formatter is allowed to put it, which in JSX is everywhere
  except inside a string. It failed loudly rather than silently, which is the
  right direction for a guard to fail in, and it is the argument for enforcing
  a formatter once rather than letting one loose occasionally.
- **The OpenAPI gate fired on a formatting-only change**, correctly: the
  reformat touched two v1 route files and `lib/api-sources.ts`. The diff there
  is line joins and splits with no value, name or behaviour changed, so the PR
  carries the `no-docs-needed` label, which is what that label exists for.
- **A finding that did not survive the check.** Bugbot reported that reflowing
  `{FREE_WINDOW_DAYS}-day` across a newline renders "30 -day window", and it was
  accepted and worked around in PR #179. It does not. JSX trims the newline
  adjacent to an expression. React emits `<!-- -->` between the resulting text
  nodes as a hydration delimiter, a browser never renders a comment, and the
  first attempt at verifying this replaced every tag including comments with a
  space, which invented the phantom twice over. The workaround is reverted and
  the trap is written down in CLAUDE.md.

### 2026-08-24 (listed, and said out loud)

- **Published to the official MCP registry** as `social.walletlink/wallet-identity`,
  status active. Step four of the sequence. The name is reverse-DNS because the
  registry requires it: a domain namespace is the reverse form of the domain,
  the same convention as a Java package, so `walletlink.social` becomes
  `social.walletlink`. Nothing user-facing carries that string; clients install
  the server as `walletlink`.
- **Verified by DNS, not by GitHub**, so the namespace is the domain rather than
  `io.github.starl3xx`. That is the stronger claim: it says walletlink.social
  vouches for this server, not that a GitHub account does. The TXT record sits
  on the apex, SPF-style rather than DKIM-style; a selector would fail with a
  generic signature error. The Ed25519 signing key is outside the repo at
  `~/.walletlink/mcp-registry-key.pem`, and the Cloudflare record is commented
  with its location, because it is the only way to publish an update.
- `server.json` is checked in as the source of truth for future publishes. The
  registry caps `description` at 100 characters, which rejected the first
  attempt.
- **The server is now said out loud on the surfaces that should say it.** The
  pack feature lists in `UpgradeModal` and `PackPricing`, the README feature
  table, and `llms.txt`, which is the surface an agent actually reads and had
  no mention of the MCP server at all.
- **`/vs/formo` gains a row.** Formo puts its MCP server behind Scale, the
  second of three plans. Ours is on every pack and on the free allowance,
  because it carries the same key and draws the same credits as the API it
  wraps. That is a like-for-like comparison rather than a claim.
- **`/mcp` was already taken on the docs site, and the repo said so.** Mintlify
  serves its own documentation-search MCP endpoint at
  `docs.walletlink.social/mcp`, which `docs/DOCS-SITE.md` has recorded since the
  site was built. A page at `docs-site/mcp.mdx` is shadowed by it: a browser
  asking for that URL gets `Method not allowed` as JSON, not the page. It was
  live that way for about an hour, and the dead URL was in the registry
  listing, the keys modal and the API reference. The page is now `/mcp-server`,
  the listing is republished at 1.0.1, and `docs/DOCS-SITE.md` says the path is
  reserved.
- **The OpenAPI spec was reachable all along.** Static files in `docs-site/`
  are served from the docs root, so `docs-site/openapi.yaml` has been public at
  `docs.walletlink.social/openapi.yaml` since it landed. It was left out of
  `llms.txt` on the assumption that it was not, which was never tested. It is
  now linked from `llms.txt` and from the MCP page, still without a `docs.json`
  entry, since registering it would generate a page per endpoint and duplicate
  the nine hand-written ones.
- The free-tier line rendered "30 -day window" for one commit. Running
  `prettier --write` over a file that had never been formatted reflowed
  `{FREE_WINDOW_DAYS}-day` across a newline, and JSX collapses that into a
  space. A template literal now keeps the figure and its hyphen atomic.

### 2026-08-24 (one click into an agent)

- **The API keys modal now offers "Add to Cursor" and "Copy Claude Code
  command"**, both already carrying the key that was just created. Step three of
  the sequence, and the lowest-friction install path that exists: no approval
  gate, no config file, no copying a key between two windows.
- **They are offered there and nowhere else, on purpose.** A key is shown
  exactly once, so a link published in the docs could only carry a placeholder,
  and a placeholder installs a server that fails on first use. The one screen
  where the plaintext key exists is the one screen where a working link can be
  built.
- **Nothing about the key's handling changes.** A `cursor://` link is handled by
  the local application and never fetched, so no key reaches an HTTP request, a
  referer or a log. The command goes to the clipboard, not to us. The key is
  still not persisted anywhere in the client.
- `lib/mcp-install.ts` holds the encoding. Cursor's deeplink base64s the server
  config object **on its own**, not wrapped in the `mcpServers` map the file
  format uses; passing the wrapped shape produces a link that installs an empty
  server.
- Docs gain the Claude Code one-liner and a note that `-s user` installs it
  everywhere rather than in one project.

### 2026-08-24 (the MCP server, which bills nothing of its own)

- **`app/api/mcp/route.ts`** puts five tools over the six `/v1` endpoints, so an
  agent can resolve a wallet without a person first reading an API reference.
  Remote, no OAuth, same bearer key and same balance as the REST API.
- **The design that matters is what this layer does not do: it never
  authenticates and never bills.** Every v1 handler already calls
  `authenticateApiRequest` itself and already calls `trackApiUsage` itself, and
  `trackApiUsage` performs the credit debit. A layer that did either on top
  would have authenticated twice, incremented the rate limiter twice and charged
  the caller twice for one tool call, and the debit is deliberately not
  idempotent, so the second charge would have been real money. Instead each tool
  builds a request carrying the caller's own `Authorization` header and hands it
  to the handler.
- **Three of the four flagged traps dissolved as a result.** `api_usage.endpoint`
  keeps recording the same six literals the REST surface records, so a
  client-supplied tool name can never mint a new key and
  `requests_by_endpoint` stays the bounded set the docs promise. The rate
  limiter is entered once per call, at the weight the equivalent REST call
  carries. And MCP prices identically to REST by construction rather than by a
  table somebody has to keep in step.
- **Discovery answers without a key.** `initialize` and `tools/list` reach no
  handler, so a client with no key or an empty balance still sees what the
  server offers. A handshake that answered 402 looks to every client like a
  server that is simply broken. That leaves one genuinely unauthenticated
  surface, so it is bounded by IP at 120 an hour in `lib/ip-rate-limiter.ts`.
  The bound is decided by JSON-RPC method, **not** by whether an
  `Authorization` header is present: the first version gated on the header,
  which meant any junk string in it removed the only cap on discovery. A header
  is not a key.
- **Which side the allowlist sits on is the whole design.** The second version
  listed the handshake methods and bounded those, which left every method it
  had not thought of, `resources/read`, `prompts/get`,
  `notifications/cancelled` and any string a caller invented, falling through
  to the unbounded branch. The MCP layer refuses all of them, so they reach no
  meter, which is exactly the surface the limit exists to cover. It now
  allowlists the metered side instead: everything is bounded except a body
  whose calls are _all_ `tools/call`. A method missing from that set is
  bounded, which is the safe direction to fail in, and a mixed batch is
  bounded too, or ninety-nine `tools/list` calls with one `tools/call`
  appended would buy the whole batch a free pass.
- **A failed call is a tool error, never a transport error.** 401, 402, 429 and
  400 from a handler would end the JSON-RPC session in most clients, and the
  person would see a dead connection rather than "no credits left". The HTTP
  status at this layer is always 200 and the failure travels as content the
  model can read out.
- **A handler called as a plain function has no wrapper to catch a throw.** Over
  HTTP, Next turns one into a 500. `lib/mcp-call.ts` reproduces that, or an
  unhandled throw would escape into the transport.
- **The fourth trap is real and unfixable, so it is documented at the top of the
  route.** `scripts/check-design-language.mjs` greps `app/` for Tailwind words
  and cannot tell a class from an English word, so a tool description containing
  the standalone word "rounded" fails CI. The banned list is in a comment there.
- Verified against a local production build: discovery with no key returns all
  five tools, an invalid key comes back as HTTP 200 with a readable tool error,
  the batch body stream drains through the synthetic request, the reverse
  cursor arrives on `nextUrl.searchParams`, and a throwing handler becomes a 500
  result rather than an escaped exception.
- New docs page at `docs-site/mcp.mdx`, with the connection block for Claude and
  for Cursor.

### 2026-08-24 (a machine-readable API, and the 43.9% it could not reach)

- **`docs-site/openapi.yaml`** describes the whole public API in OpenAPI 3.1:
  six operations, both authentication forms, every error code, the rate-limit
  headers, and the staleness headers on the single wallet lookup. It is the
  dependency the MCP server, SDK generation and agent discovery all sit on.
- **It records the four shapes rather than averaging them.** The same idea is
  returned four slightly different ways across the endpoints: `/batch` omits
  `verified` on the Farcaster object that the other three include, the forward
  lookup returns a `quality` object where the reverse lookups return a bare
  `quality_score`, and `also` appears on the forward paths only. Writing one
  schema that was true of none of them would have been tidier and wrong, so
  there are separate schemas and each says why it differs.
- **Writing it found a shipped bug that made 43.9% of the index unreachable.**
  `isValidFarcasterUsername` was `[a-z0-9_]{1,20}`. Measured against the
  4,699,611 usernames we hold: 1,477,534 contain a dot, 189,078 contain a
  hyphen, **zero** contain an underscore, and 334,345 are longer than 20
  characters. The rule allowed the one character that never occurs and rejected
  both that do, so `GET /v1/reverse/farcaster/{username}` answered 400
  INVALID_USERNAME for 2,065,051 names that are in the table, including
  `vitalik.eth`, which is the worked example on our own published docs page.
- **The new rule is `[a-z0-9][a-z0-9.-]{0,31}`**, derived from the index rather
  than from the fname spec, because the column holds both fnames and ENS names
  and the lookup matches on the column. It accepts 4,223,912 usernames, up from
  2,634,560. The leading-alphanumeric requirement is what still rejects
  Farcaster's `!<fid>` placeholder for an account with no username set, which is
  475,698 rows and not an addressable handle.
- **Two published pages were describing something the code does not do.**
  `usage.mdx` showed `requests_by_day` as an object keyed by date; it has always
  been an array of `{ date, count, credits }`. `errors.mdx` and
  `reverse-farcaster.mdx` carried the old username rule.
- **CI gains a narrower gate.** `docs-freshness.yml` already fails a PR that
  touches the API surface without touching `docs-site/`, but that accepts any
  prose edit, which would let the spec drift while a sentence changed. A second
  step requires `docs-site/openapi.yaml` specifically when a route, a validator,
  a plan limit or the `sources` enum moves, and a second job runs
  `redocly lint` whenever the spec itself changes, since a spec that no longer
  parses breaks the playground and every generated SDK without breaking a test.
- **Blog code blocks are readable again.** The typography plugin styles `pre` as
  light text on a near-black ground; the blog overrode only the ground, so every
  fenced block rendered gray-200 on gray-100.

### 2026-08-24 (the concierge shortlist, with the numbers already run)

- **`scripts/concierge-signals.ts`** turns the traffic plan's "three
  personalised replies per weekday" from an hour of manual searching into a
  review pass. It finds candidates, computes an honest number for each from our
  own index, and prints a drafted reply. It makes no writes, never seeds and
  never posts.
- **The plan's premise did not survive contact.** It named Clanker deployers as
  the densest pocket. Clanker is not a launch feed: `lib/clanker.ts` keeps a
  wallet and a social handle and throws the token address away (`topics[1]`, read
  in a comment only), so there is nothing to measure. A token deployed this
  morning has no holders either: two sampled live had three transfers each, being
  the pool, the locker and the deployer. And handle-shaped records are often
  launchpad bots minting tokens _about_ a public figure's post, so a reply about
  "your holders" would reach someone with no connection to the token. Clanker
  stays a good wallet-to-X source and is not used as a prospect list.
- **The strongest lane was already in the database.** We hold holder data for 76
  contracts and 51 clear the public listing floor, so they already have a live
  report at `/holders/<chain>/<address>` that their team has never been told
  about. 50 named candidates, all carrying measured numbers, at zero API cost.
- **The other two lanes reflect what is actually available.** X search runs
  through the repo's own twitterapi.io key, anchored to a marketplace or explorer
  link because the unanchored keyword query measured about three quarters
  giveaway farms. Farcaster uses the free Warpcast endpoint: Neynar is over its
  period budget (11,557,744 against a 10,000,000 plan limit) and pauses **all**
  requests on overage including the live paid lookup path, so no new Neynar
  caller may spend before 2026-09-01.
- **A report link and a source link are different fields.** They were one, and
  the draft printed whatever it held as "the full report is already public": on
  an X candidate that was the prospect's own announcement post, so the reply
  would have pointed a team at their own tweet and called it our analysis.
- **Every lane resolves contracts through one shared helper.** The resolution
  lived inline in the X lane, so the Farcaster lane extracted an address and
  then drafted "NO NUMBER AVAILABLE" for contracts we hold and have published. A
  lane should not be able to forget how to look something up.
- **The Farcaster lane links the cast, not the caster.** It pointed at the
  author's profile, which leaves the operator to go and find the announcement
  they are meant to be answering. The X lane links the tweet; this now links
  the cast, with the profile as the fallback.
- **One naming rule, shared.** The index lane rejected the seeder's `Unknown
Token` placeholder from the start. Once the other lanes learned to resolve
  collections they began preferring the collection name over the poster, so a
  placeholder started beating a perfectly good `@username` and produced a reply
  addressed to "Unknown Token". `isNamed` and `displayName` now serve every
  lane.
- **Dedupe follows an identity that merges.** Keying on "contract if present,
  else handle" is not enough: a contract-keyed winner picks up a handle when a
  post merges into it, and the next post from that handle still hashed to its
  own key and took a second slot. An alias map makes the two identities
  converge whichever arrives first.
- **The candidate cap breaks the query loop, not just the tweet loop**, so a run
  that is already full stops paying twitterapi.io for a page it cannot use. And
  candidates are deduped by contract, then handle, before the shortlist is
  sliced: with `source=all` one prospect arriving from two lanes ate two of the
  three daily slots.
- **The honesty rules are in the code, not the operator's head.** Always name the
  measured denominator, because seeding caps at 2,000 wallets and "1,707 of your
  20,977 holders" would be false. Quote `reachableAny` as a floor with "at
  least", because `checked` runs well below `holderCount`. Use the median
  Farcaster following, never the mean. Drop any collection where
  `measurementInProgress` is true, because a near-zero reachable count there
  means "not yet checked" rather than a finding. With no measured number the
  draft refuses to invent one and offers the published per-chain figure instead.

### 2026-08-24 (the changelog stops saying the relaunch was never sent)

- **Two entries claimed the relaunch campaign had not been sent.** It was sent
  on 2026-08-23: 100 grants, 100 emails, 0 failures, 25,000 matches granted,
  confirmed against `lifecycle_emails`. Both statements were true on the day
  they were written, so they carry a dated correction in place rather than
  being rewritten. A changelog that quietly revises its own history is worth
  less than one that shows where it was wrong.
- Found while checking whether the ~100 dormant accounts were still eligible for
  the welcome sequence. They are not, and the reason is not the `SEQUENCE_START`
  cutoff everyone reaches for first: they hold credit lots now, so the purchase
  exit rule excludes them independently. That distinction matters if the cutoff
  ever moves. `docs/EMAIL-SEQUENCE.md` carried the same claim and was corrected
  in PR #172.

### 2026-08-24 (a failed send stops being retried 288 times a day)

- **The five-minute runner had an unbounded retry loop.** `claimAndSend` deleted
  its claim when a send failed, which put the account back in exactly the state
  that made it eligible. Under one daily cron that was one retry a day. Under
  the five-minute cron it is 288 a day, per account, forever, for any failure
  that does not fix itself. Worse, `isEmailConfigured` only checks
  `RESEND_API_KEY` while `sendLifecycleEmail` also refuses without
  `EMAIL_UNSUBSCRIBE_SECRET`, so a whole class of permanent refusal passes the
  route's precondition and lands straight in the loop.
- **A failure is now written down.** New columns `attempts`, `failed_at` and
  `last_error`. The claim became an upsert that re-takes a failed row only once
  its backoff has elapsed (10, 20, 40, 80 minutes) and only while it is under
  `RETRY_CEILING` (5). A row now carries four states, and selection and the
  claim are written from the same four so they cannot disagree: delivered,
  in flight, retryable, dead. Migration:
  `scripts/migrate-lifecycle-retry.ts`, **run before deploy**.
- **The daily runner pins a user to their earliest undelivered email, stated
  explicitly.** Making selection agree with claim eligibility silently dropped
  the hold that kept a user on welcome-1: a welcome-1 that was backing off or
  exhausted no longer matched the first pass, so the user fell through to the
  second and would have received welcome-2 of a sequence whose first email never
  arrived. Each pass now requires that exactly the earlier emails are confirmed,
  which is the rule the old behaviour only implied. The JS dedupe stays as a
  safety net; it can no longer fire.
- **The reclaim skips recorded failures** (`failed_at IS NULL`). They are also
  unconfirmed, but they are a retry schedule rather than an abandoned claim, and
  deleting one would reset its attempt count and restart the loop.
- **The new cron was watched by nothing.** It is now in the health pane's `JOBS`
  list at `maxAgeHours: 2`, and it emits a heartbeat on every run rather than
  only when it sends. "No row" previously meant both "nothing to do" and "dead
  since Tuesday", which is precisely the distinction that pane exists to make.
- **Cron heartbeats are no longer counted as lookups.** Nine scheduled routes
  report health by writing a `lookup_completed` row carrying an `eventSubtype`,
  and every product query counted them as work a person did. At nine a day that
  was a rounding error; at 288 the machines would have been the majority of our
  "lookups". `NOT_A_HEARTBEAT` in `lib/analytics.ts` is now applied everywhere
  the count is read.
- **`migrate-lifecycle-claim.ts` is safe to re-run.** Its backfill was
  unbounded, so a second run after deploy would have marked live and abandoned
  claims as delivered and silently lost those emails. It is now bounded to
  pre-cutover rows, and its verification asserts the same bound rather than
  failing whenever a cron legitimately holds a claim.
- **The first-touch runner has its own send cap** (`FIRST_TOUCH_MAX_SENDS` 100,
  not the daily 200) plus a 240s wall-clock guard, so a run exits cleanly
  instead of being killed partway and leaving claims for the reclaim.
- `docs/EMAIL-SEQUENCE.md` and the module header described one cron, an
  immediate day-0 send and a ledger that proves delivery. All three were stale
  the moment the split shipped. Also corrected there: **the relaunch campaign
  has been sent**, 100 accounts on 2026-08-23, which that file and this one both
  denied for a day.

### 2026-08-24 (the welcome email stops arriving a day after the welcome)

- **Welcome-1 now sends about five minutes after signup, not up to 24 hours
  later.** The sequence ran on one daily cron at 15:00 UTC, so an account
  created at 15:01 waited 23 hours and 59 minutes for the email that greets it.
  New cron `/api/cron/welcome-first` at `*/5 * * * *` runs `welcome-1` only,
  for accounts past `FIRST_TOUCH_DELAY_MINUTES` (5). Worst case is now about
  ten minutes.
- **The delay is deliberate, and zero would be worse.** The account row is
  written at magic-link _verify_, so an inline send puts welcome-1 in the inbox
  in the same second as the sign-in link, and the email the person needs
  competes with the one they did not ask for. Five minutes clears the link and
  is long enough that most people have run their first lookup, which is the
  state welcome-1's copy assumes.
- **Sends now claim before they send.** `lifecycle_emails` is unique on
  (user, key), but the row was written _after_ the send, so two runners racing
  the same user delivered twice and inserted once: the constraint recorded the
  race instead of preventing it. That was theoretical with one cron and real
  with two, which overlap exactly at 15:00. `claimAndSend` inserts first and
  sends only if it took the row; a failed send deletes the claim so the next
  run retries rather than marking a person as emailed by an email that never
  left.
- **The daily runner keeps its day-0 pass** as the safety net, and both runners
  now select through one shared `ELIGIBLE_USER` fragment so the cutoff,
  opt-out, legacy-tier, whitelist and purchase exits cannot drift apart.
- **A claim nobody redeems is a welcome email that never arrives.**
  `claimAndSend` deletes its claim when the send _returns_ a failure, but it
  cannot delete anything when the process does not return at all: a timeout, an
  OOM or a deploy between the INSERT and the send leaves a row every runner
  reads as "already emailed", retried by nothing and reported to nobody. New
  column `lifecycle_emails.confirmed_at` is written after the send succeeds, so
  a row is proof of delivery rather than of intent, and `reclaimStaleClaims`
  deletes unconfirmed claims older than `CLAIM_RECLAIM_MINUTES` (15) before
  either runner selects. The residual window resolves in favour of sending: a
  process that dies after the send but before the confirm mails that person
  twice, and one duplicate greeting beats a welcome that silently never
  arrives.
- **The delay is a fact about the account, not about one cron.** Held only in
  the fast runner, the daily runner's day-0 pass still computed `now() - 0
days`, so an account created at 14:59:30 got welcome-1 thirty seconds later
  at 15:00, next to its own magic link. `FIRST_TOUCH_DELAY_MINUTES` moved into
  `ELIGIBLE_USER`, where no runner can reach past it.
- **Selection asks whether an email was delivered, never whether a row exists.**
  Once the claim is taken before the send, a bare `NOT EXISTS` reads an
  in-flight claim as a completed send: the daily runner found no welcome-1
  pending, fell through to welcome-2, and would have delivered the second email
  beside the first while the first was still leaving. Both runners now select on
  `confirmed_at IS NOT NULL`, which holds that user at welcome-1 until an email
  actually left. The lowest-pending ordering is the reason the daily runner
  loops in key order, so this is the predicate that has to carry it.
- **The reclaim is scoped to this sequence's own keys.** `lifecycle_emails` is a
  shared ledger: `scripts/relaunch-trial-grant.ts` writes 100 rows under
  `relaunch-trial-2026-08`. An unscoped delete would have read every one of them
  as an abandoned claim of ours, removed it, and let a `--send` re-run mail 100
  accounts that had already been mailed. A reclaim may only ever collect claims
  the runner doing the reclaiming could itself have taken. The relaunch script
  now also writes `confirmed_at` explicitly, because a ledger where "delivered"
  is implicit in one writer and explicit in another survives right up until
  somebody widens a WHERE clause.
- **The key scope binds as `sql.param(...)::text[]`, not a bare array.** Drizzle
  expands a plain JS array into one placeholder per element, so
  `ANY($1, $2, ...)` reaches Postgres as "op ANY/ALL (array) requires array on
  right side". `reclaimStaleClaims` runs first in both crons with nothing
  catching it, so the bare form would have thrown on every run before a single
  send: the scoping fix above would have shipped as a total outage of the
  sequence. Same binding `lib/x-accounts.ts` and `lib/clanker.ts` already use.
- **The readers were updated too, not just the writers.** A row stopped meaning
  delivery the moment `claimAndSend` began taking it first, so `getEmailStatus`
  (the admin Lifecycle card) and `scripts/relaunch-report.ts` now count
  `confirmed_at IS NOT NULL`. Unfiltered, the pane reported an in-flight claim,
  and an abandoned one waiting on the reclaim, as mail that went out: it would
  have answered "did the send go out" with yes on exactly the runs where it had
  not.
- **The suppression guard in `relaunch-trial-grant.ts` is deliberately NOT
  filtered.** Reporting should be accurate and suppression should be
  conservative: any row at all means do not send again. Filtering there would
  turn a stuck claim into a second email.
- Migration: `scripts/migrate-lifecycle-claim.ts`, **run before deploy**. It
  backfills `confirmed_at = sent_at` on existing rows, which were written under
  the old send-then-insert order and are all real deliveries; without the
  backfill the first reclaim would delete them and mail those accounts again.
  No new table, so no `migrate-grant-readonly.ts` entry.

### 2026-08-24 (the docs stop advertising a plan nobody is on)

- **The legacy Unlimited tier is gone from `docs-site/`.** The Plans table
  carried a second column, `Unlimited (legacy)` / `Startup`, with 300 rpm, 50k
  requests a day and a batch size of 200, and three other pages repeated "or 200
  on a legacy Unlimited account".
- **Nothing was on it.** Two accounts hold a legacy tier, one `pro` and one
  `unlimited`. `TIER_API_PLAN` maps `pro` to `developer` and `unlimited` to
  `startup`, and only the `pro` account has ever created an API key. So no key
  in existence carries `Startup` limits, and the column documented a plan a
  reader could neither buy nor reach. Checked against the database before
  removing it, not assumed.
- **The code is untouched, deliberately.** `legacyTierIsUnmetered`, the tier
  values, `TIER_LIMITS` and `TIER_API_PLAN` all stay: both accounts keep exactly
  what they bought, and if the `unlimited` account ever creates a key it still
  gets `startup` limits. CLAUDE.md requires this, and the removal was only ever
  about what is published.
- The admin pane keeps its Legacy badge and tier row, because it is the tool for
  managing those two accounts and hiding them there would make it lie.
- Also removed the `app/lookups.mdx` note about accounts that bought Pro or
  Unlimited before credits existed. The `plan_limits` defensive-parsing advice in
  `usage.mdx` is kept, with the legacy phrasing dropped.

### 2026-08-24 (the blog gets its front door)

- **New post: "How to find the X account behind an Ethereum wallet"**
  (`content/published/find-twitter-account-from-wallet.md`). Three methods, what
  each one proves, four minutes by hand, and the answer rate at scale. The 26
  existing posts all assume the reader already knows that resolving a wallet is
  a thing that can be done; this is the entry point none of them is.
- **Its figures are declared, not hardcoded.** The post states the index size,
  the Farcaster count and the X-handle count, so it is added to the `files` list
  of all three claims in `scripts/check-published-figures.ts`. The wording was
  chosen to match the patterns already there, so the guard checks it with no new
  regex. All three verified against `/api/public-stats` before publishing.
- **Both sample rates are declared, not just the index counts.** The post states
  the 23.7% any-identity rate and the ~13% reachable rate, so both rows of its
  table are registered in `MEASUREMENTS.published`. Declaring only the headline
  is how a post ends up stating a current resolution rate beside a stale reach
  rate, which is the exact conflation this guard exists to police.
- Keeps "any identity" (23.7%) and "reachable on X or Farcaster" (~13%) apart,
  and says in the post why quoting the first where the second belongs overstates
  an audience by half.

### 2026-08-24 (the sweep resumes instead of restarting, and stops leaving 580 MB behind)

- **Reclaimed 580 MB.** `farcaster_sweep_seen_1786631580832` held 3,676,509 rows
  from a sweep that started 2026-08-13 14:33 UTC and hit the Neynar ceiling ~6.5
  hours in. The database went from 3,245 MB to 2,665 MB.
  `scripts/cleanup-sweep-seen-tables.ts` collects these, dry-run by default. It
  drops with a plain `DROP` rather than `SET ROLE`: the `sweep_runner`
  membership is `set=false`, so assuming the role is refused, while
  `neondb_owner`'s inherited `neon_superuser` is enough. Probed inside a
  transaction that rolled back rather than reasoned about.
- **The monthly sweep resumes.** A budget-stopped `--full` now records where it
  stopped in `ingest_state.farcaster_sweep_resume`, and the schedule runs
  `--auto`: resume if there is a checkpoint, full sweep if not. Before this, each
  month restarted at FID 1, spent its budget re-covering the same ground,
  stopped in about the same place and abandoned another ~580 MB table. August
  spent 11,557,744 credits against a 7,500,000 ceiling without finishing.
- **A budget-stopped sweep now drops its own seen table** instead of keeping it
  "for forensics". It can never be used again, so keeping it only accumulated
  storage.
- **Revocation cleanup is deliberately NOT extended across segments**, and the
  reason is in `SweepCheckpoint`. Carrying the seen table across resumed
  segments would have been the obvious design and is a data-loss path: cleanup's
  integrity guards (a 100,000-row floor and a seen-vs-upserts ratio) are
  per-table, so an accumulated table describes the _earlier_ segments. A final
  segment that swept its whole range and silently returned nothing (a Neynar 404
  maps to `[]`, and `failedCalls` only counts nulls) would add zero wallets,
  trip no guard, and clear every pure-sweep row in the range it was meant to
  cover, deleting outright the rows the sweep was the only source for. Order
  10^6 rows. The floor's own comment claims to catch exactly that, and does on a
  single-run sweep, where the count really is zero.
- Cleanup therefore still requires one run covering the whole range, which is
  what it required before. It also now checks `fidsRequested` against the range
  rather than treating "did not budget-stop" as "covered it", and tests
  `budgetStoppedAtFid !== undefined` rather than truthiness, since FID 0 is
  falsy and would have fallen through to the branch that cleans up.
- `clearSweepCheckpoint` upserts `'null'::jsonb` rather than deleting the row:
  `sweep_runner` has INSERT and UPDATE on `ingest_state` but **not DELETE**, so a
  `DELETE` would have thrown on the success path immediately after cleanup had
  already cleared rows. It passes locally, where the owner role has DELETE.
- Checkpoints are validated on read (`isUsableCheckpoint`). A missing, null,
  zero or string `nextFid` each sweeps nothing while looking like a completed
  run.
- **Only `--full` and `--resume` write a checkpoint.** Lifting the write out of
  the seen-table branch to serve the resume path dropped the mode guard with it,
  so a `--range 1 50000` validation run that budget-stopped would have
  overwritten a real full-sweep checkpoint with its own narrow range. The next
  `--auto` would resume that span, complete it, clear the checkpoint, and the
  full sweep's progress would be gone with nothing reporting it. Found by Bugbot
  on the second review pass; the first pass returned no findings.

### 2026-08-24 (the money is backed up, constrained, and the banned figure is gone)

- **`credit_lots` and `credit_ledger` are in the nightly backup.** They are the
  only record of who paid and what they spent, `db-backup.yml`'s own header says
  it captures "the irreplaceable tables", and they were not in it. The dump
  covered 6 of 30 tables; it now covers 8. Both the `-t` entry and the
  `backup_reader` grant are needed, and `pg_dump` fails outright if they
  disagree, which is the right failure mode.
- **`scripts/migrate-grant-readonly.ts` now grants both read-only roles**,
  `sweep_runner` (CI) and `backup_reader` (the dump), from one table list each in
  one file. Two scripts with one list each is how the second stops being
  maintained.
- **Foreign keys on the two money tables.** `credit_lots.user_id` and
  `credit_ledger.user_id` now reference `users(id)`. Both columns were already
  `uuid` and `NOT NULL` with zero violations across 106 rows, so this is a
  catalog change with a 106-row scan, instantly reversible with `DROP
CONSTRAINT`. Applied by `scripts/migrate-money-fks.ts` against the **direct**
  endpoint, with `SET LOCAL lock_timeout` inside an explicit transaction.
- **`NO ACTION`, not `CASCADE`, unlike the four other keys to `users`.** A
  purchase record must outlive the account that made it. **Deleting a user who
  holds credit lots now fails** instead of silently deleting their payment
  history: a loud failure is recoverable, a silent deletion is not. 22 user rows
  were deleted in the current stats window by something outside this repo.
- **A non-uuid `userId` is rejected at `/api/jobs`.** Two values in `lookup_jobs`
  came from a harness outside this repo and are the reason a join from that
  column throws. Rejected rather than null-coerced, because a NULL `user_id`
  marks a system job whose partial results are withheld from every caller.
  `lib/user-id.ts` regenerates a corrupt localStorage value so a browser holding
  one self-heals instead of getting a permanent 400.
- **The uncited "~2.5% industry average" is gone from the last four surfaces.**
  It was purged from every public surface on 2026-08-22 and survived in
  `README.md`, `PROJECT_OVERVIEW.md`, the email sequence and the SEO draft. All
  four now say "low single digits", qualitatively, as CLAUDE.md requires.

### 2026-08-24 (`npm run db:push` refuses, and the ingest tables become visible)

- **`db:push` would have dropped eight tables holding 4.25M rows.** Measured
  against production: `drizzle-kit push` produced a 118-statement plan, 58 of
  them destructive, opening with `DROP TABLE ... CASCADE` on `x_accounts`
  (448,069 rows), `wallet_holdings` (121,826),
  `farcaster_sweep_seen_1786631580832` (3,676,509), `seeded_contracts`,
  `ingest_state`, `x_handle_attempts`, `clanker_unresolved_ids` and
  `farcaster_sweep_seen`. It also wanted to drop two `social_graph` indexes with
  no re-create, which puts a live endpoint onto a sequential scan of 5.1M rows.
  **None of the eight is in the nightly backup.** `ingest_state` is the smallest
  and the worst to lose: its five jsonb rows are every sweep checkpoint and
  budget counter, nine days before the X-handle sweep restarts.
- The command was documented in CLAUDE.md, README.md and PROJECT_OVERVIEW.md,
  and `push` only prompts on a TTY: in CI or with `--force` it does not ask. It
  now refuses via `scripts/db-push-refuses.mjs`, which carries the measurement so
  the refusal cannot be deleted as a mystery. The real command survives as
  `db:push:unsafe` for a scratch database or a Neon branch.
- **The seven declarable ingest tables are now in `db/schema.ts`** as read
  models, with column types read out of the live database rather than copied from
  the migration scripts. `farcaster_sweep_seen_1786631580832` cannot be declared,
  because `lib/farcaster-sweep.ts` creates it at runtime with a timestamp suffix;
  that is recorded in a comment instead. Four partial-index predicates and two
  `social_graph` indexes are still not reproduced, and the comment says so rather
  than leaving them to look like oversights.
- **CLAUDE.md gains a "Schema changes" section**: hand-written SQL in
  `scripts/migrate-*.ts` with the owner URL is the sanctioned path; `db:generate`
  was abandoned in January and its journal has never matched the database; and
  DDL must run against the **direct** endpoint, not the pooler, because Neon's
  pooler keeps a bare `SET` on a shared backend across client connections.
- **No database change.** Nothing in this entry mutates a row, a column or a
  constraint. Rollback is `git revert`.

### 2026-08-23 (a guard that opens a browser)

- **`scripts/check-control-height.mjs`**, the first guard here that can answer
  "what height did this actually render at". Every visible element carrying
  `h-control` or `size-control` must measure the token, on three pages at six
  widths from 320 to 1280, and no page may scroll sideways. 174 rendered
  controls checked per run.
- **It checks only elements that declare the contract**, so there is no
  exception list and no judgment about what counts as a control: an element that
  never asks for the control height is not one. The responsive forms
  (`sm:h-control`) are skipped for the same reason.
- **No dependency, no browser download.** It drives the runner's own Chrome over
  the DevTools protocol through Node's built-in WebSocket. The alternative was a
  test-runner dependency and a ~180MB Chromium per CI run to send three CDP
  messages. It starts `next dev` with `DATABASE_URL` blank, so it needs no
  secrets; the pages it measures all render without one.
- **Its fixture is the bug it was written for.** Like the other guards it proves
  itself before reporting, and that matters more here: a detached browser, a
  selector matching nothing, or a settle that fires before the font loads all
  produce an empty violation list, which reads exactly like a healthy page. So
  it measures the 22px `flex-1`-in-a-`flex-col` case, which it must catch, and
  the `sm:flex-1` correction, which it must not flag.
- **Verified against the real regression, not only the fixture.** With the fix
  reverted in `InputMethodPicker.tsx` it reported 8 failures and exit 1, at
  320/360/390/430 and clean at 768/1280, which is the defect's exact signature.
  The failure message names the cause and the two correct spellings.
- `docs/DESIGN-LANGUAGE.md` Enforcement now lists four guards rather than two,
  and records that its own "a grep cannot answer whether this renders" paragraph
  described a live defect for as long as it stood unenforced.

### 2026-08-23 (the homepage gets the phone pass the header already had)

- **The two alternates were 22px tall on every phone.** `altClass` carried a
  bare `flex-1`, and `flex-1` is `flex: 1 1 0%`: on a flex item the basis
  supplies the main size, so `height` is never consulted. Below `sm` that row is
  `flex-col`, so the 0% basis replaced `h-control`, the container had no free
  space to grow into, and `min-height: auto` dropped each pill to its content
  height. `sm:flex-1` restores 34px on a phone and changes nothing above it.
  Measured 22px at 320/360/375/390 and 34px at 640 before, 34px everywhere
  after, which is why no desktop review ever caught it.
- **The same defect, one card down.** The reverse-lookup field measured 35.5px
  against a Segmented and a button at 34px: three heights in one control row,
  the exact failure `--height-control` was created to end, reappearing three
  panes below the header where it was first fixed. Now 34/34/34.
- **The proof row cost 137px on a phone and 69px on a desktop.** Three figures
  need 273px; two 48px gaps ask for 369px against the 342px a 390px phone
  leaves, so the row wrapped 2 + 1. `gap-x-4` below `sm` fits it on one line
  down to 360. The opening block goes 263px to 195px and the dropzone's top edge
  394px to 326px.
- **The chain strip stopped dangling its separator.** `.join(' · ')` is 410px
  natural and wraps at every phone width, so line one ended on a middot. Laid
  out as flex children with a gap, which is the ruling the proof row above it
  already carried. The middots go at every width, as they did there.
- **The dropzone drew a white halo in dark mode.** Its class string hand-copied
  four of `FOCUS_RING`'s five classes and dropped `ring-offset-background`;
  Tailwind's initial ring-offset colour is `#fff`, so the page's primary action
  painted a white gap inside its own focus ring. It imports the shared string
  now.
- **DESIGN-LANGUAGE.md named sixteen tokens that do not exist.** `--h-ctl`,
  `--r-container`, `--t-display`, `--d-base`, `--e-out` and the rest resolve to
  nothing; every occurrence in the codebase was inside a comment. Renamed to
  what `globals.css` actually declares. The doc's own first line is "If a value
  is not here, it should not be in the code."
- **Two sections added to the doc**: the flex-item rule above, with the
  measurements, under Control height; and "The page on a phone" beside "The
  header on a phone", which had a measured pass over one row and none over the
  body. Also the arithmetic for why the control height stays 34px: `size-control`
  takes width from the same token, and 44px puts the phone header 16px over a
  320px screen.

### 2026-08-23 (llms.txt rewritten, and Venice.ai joins the Ask AI row)

- **/llms.txt roughly triples**, from a summary with four link lists to a file
  an assistant can answer from without visiting the site. New sections: who it
  is for and the jobs people hire it for, what a match is and what it costs,
  the five evidence classes and the quality-score bands, the four reachability
  states (including `reassigned`, which the file had never named), coverage as
  two numbers rather than one, and the API in prose. The Product section gains
  `/holders` and the shape of a per-collection report URL; Docs gains the two
  product-side pages and Scan depth; every comparison entry gains the one claim
  its page actually makes; all 26 blog posts are listed with descriptions.
- **Every figure interpolates a constant**, including the ones just added
  (`X_HANDLES_HELD`, `KNOWN_AGENTS`) and the API limits, which now come from
  `API_PLANS[CREDIT_API_PLAN]` rather than being typed. The reason is written
  into the route's header: `check-published-figures.ts` reads this file's
  _source_, so a literal typed here is invisible in both directions, and only
  the four hardcoded percentages are actually watched. All 57 figures pass.
- **The chain rates are labelled.** "Base 46.2%, Ethereum 16.6%" now says what
  it measures ("have an X or Farcaster account") and when it was measured, and
  the two-number rule is stated beside it rather than left implicit.
- **Venice.ai joins the Ask AI row.** It takes no prefill parameter:
  `?prompt=`, `?q=`, `?message=`, `?text=` and `?input=` were each checked
  against the rendered app on 2026-08-23 and all five land on an empty
  composer, so the link opens the chat and the visitor types. Recorded in the
  code rather than discovered again by the next person.

### 2026-08-22 (marketing and docs audit: 6-auditor sweep, 49 files corrected)

- **The uncited "2.5% industry average" and its "9x" derivative are purged**
  from every public surface: docs, homepage JSON-LD, llms.txt, the welcome
  sequence, and eleven blog posts (one retitled). Comparisons now use our
  measured figures or "low single digits, published by typical tools".
  CLAUDE.md and the positioning doc (v3) ban the number so it cannot return.
- **Provider names removed from public copy**: three blog posts named data
  vendors; they now describe evidence classes and mechanisms only.
- **Resolution vs reach un-conflated across seven posts**: 22% is the
  any-identity rate; the messageable X-or-Farcaster share (~13%) is now
  stated wherever "reachable people" were counted from the larger number.
- **Figure integrity**: the owner-attested claim's checker query now counts
  the four new attested sources (the Sybil import had moved the measured
  share under the published floor with nothing wrong); its watch list gains
  the four /vs pages and two comparison posts, and the pattern survives JSX
  line wraps. A known-agents claim (13,622, live-verified) joins the
  registry with new `KNOWN_AGENTS` constants. The docs coverage page's
  stale 95.9% resolution coverage is corrected to 98.1%, and
  "We resolved every X handle" lost its "every". 54 figures, all passing.
- **Truth fixes**: "Most bought" (no sales data) is now "Recommended"; the
  free allowance reads "rolling 30-day window" everywhere instead of
  "every 30 days"; /vs/holder speaks of Holder in the past tense with the
  retired treatment and drops a "forever" promise; the Addressable OG
  description matches the body's pricing claim; cache TTL corrected to 7
  days in two posts; the priority-score post now describes the formula the
  product actually computes (Farcaster followers, a paid field); two posts
  stop claiming a public agent dataset that does not exist; the fabricated
  "[DAO Name]" case-study attribution is anonymized; blog JSON-LD stops
  stamping dateModified with render time; an uncited "80% of builders"
  claim went qualitative in three posts.
- **Docs-site accuracy**: INVALID_CURSOR joins the error table, the
  reverse-Farcaster example drops reachability fields the API never
  returns there, examples use x.com, quickstart marks which flow steps
  need a pack, and chain lists and counts interpolate their constants.

### 2026-08-22 (the Snapshot and OpenSea harvests go on weekly crons)

- **Two scheduled workflows**: `snapshot-profile-harvest` (Sunday 06:00
  UTC, 500 hub requests a week, walks the users table from its checkpoint)
  and `opensea-account-enrich` (Sunday 06:30 UTC, 200 wallets against the
  missing-X default). Both idle cheaply once their pools drain.
- **`scripts/migrate-grant-harvest-writes.ts`** (run 2026-08-22): the
  attested-link ingest writes social_graph, handle_conflicts and
  ingest_state, and `sweep_runner` held write on only the first — no
  ingest_state grants at all and read-only handle_conflicts — so a harvest
  cron on that role would have died in CI with "permission denied", the
  exact trap CLAUDE.md documents for reads. Granted SELECT/INSERT/UPDATE on
  both (no DELETE; a scheduled job holds nothing it does not need).
- The Sybil import ran the same day: 2,615 rows carry `sybil_list`
  (2,100 new wallets, 257 fills, 258 corroborations) and 166 conflicts are
  recorded for the resolver.

### 2026-08-22 (three more attested-link sources: Sybil, Snapshot, OpenSea)

- **`scripts/import-sybil-list.ts`**: Uniswap's deprecated Sybil delegate
  registry, a frozen public JSON of signature-verified wallet-to-handle
  pairs. Dry-run against the live graph: 2,781 usable links, 2,100 new
  wallets, 257 fills, 258 corroborations, 166 conflicts to record.
- **`scripts/harvest-snapshot-profiles.ts`**: Snapshot profiles are set
  with a wallet-signed message and may name a Twitter handle. Walks the
  public hub API oldest-first with a checkpoint in ingest_state and a
  per-run request budget.
- **`scripts/enrich-opensea-accounts.ts`**: OpenSea accounts are wallet
  logins with OAuth-connected socials. Per-address enrichment, defaulting
  to the most-followed Farcaster wallets missing an X handle. The endpoint
  sometimes returns a numeric X user id instead of a handle; those are
  counted and skipped, because an id is only ever stored beside the handle
  it belongs to.
- All three are thin adapters over the shared attested-link ingest, with
  sources `sybil_list`, `snapshot_profile` and `opensea_profile` wired into
  the public-source allowlist (attested-social), `calculateQualityScore`
  (+25 peers) and `isTwitterVerified`. Every script is dry-run by default.

### 2026-08-22 (DeBank binding-tweet harvest, written ahead of credits)

- **`scripts/harvest-debank-bindings.ts`**: DeBank's Twitter binding flow
  makes users tweet their wallet address from their own account, so the
  corpus of those tweets is a public set of owner-published handle-to-wallet
  attestations. The script sweeps X search for the two template phrases in
  windows and hands the pairs to the shared attested-link ingest
  (`lib/attested-links.ts`), which owns the fill-only rules, the agreement
  gate, conflict recording and the quality contract; the script adds one
  corpus-specific rule (a handle spraying bindings across more than three
  wallets is dropped). `debank_tweet` is wired as an attested-social peer:
  the public-source allowlist, `calculateQualityScore` (+25) and
  `isTwitterVerified`. The last of those also gains `eas` and `clanker`,
  which wrote `twitter_verified = true` on ingest but were missing from the
  recompute, the exact bug the ethos entry there documents. Dry-run by
  default (read-only classification of what a commit would do);
  interrupt-safe checkpoint in ingest_state; stops cleanly on a request
  budget or a 402. Needs `TWITTERAPI_IO_KEY` with credits, which is why it
  ships unrun.

### 2026-08-22 (footer: Farcaster, llms.txt, and ask-an-AI links)

- **@walletlink on Farcaster** joins X and GitHub in the footer's social
  row, now that the account exists.
- **llms.txt is linked** beside the copyright, so the page written for AI
  crawlers is discoverable by the people who check for one.
- **"Ask AI about walletlink.social"**: prefilled-question links to
  ChatGPT, Claude and Perplexity above the legal row. The assistants read
  /llms.txt and the public pages; the question is deliberately neutral so
  the answer is theirs to give.

### 2026-08-22 (the holder hub stops listing unfinished measurements)

- **A listing floor on /holders, the sitemap and prerendering**: a report
  appears only once it shows at least 20 reachable people at 5% or more of
  its measured holders (`LISTING_MIN_REACHABLE`, `LISTING_MIN_RATE` in
  `lib/holder-pages.ts`). Three collections listed 0% reachable when in
  fact under half a percent of their holders had ever been checked: the
  resolution jobs never ran under the API budget pause, and a zero that
  means "not yet checked" was published as a finding. The floor keys on the
  reachable count because it only ever undercounts, so a collection
  graduates onto the hub automatically at the revalidation after its
  measurement catches up. Below-floor pages stay live at their direct URLs.
- **The hub label leads with the outcome**: "(N reachable people)" replaces
  "(2,000 holders measured)", which claimed measurement the budget pause
  had not delivered. Listings order by reachable people, best first.
- **Below-floor pages say why their numbers are small**: a caution note
  ("Measurement in progress: N of M holders checked so far") renders
  whenever such a page has under half its holders checked. A fully checked
  page that still misses the floor carries no note, because there the
  numbers are the finding.

### 2026-08-22 (the results table gains the attested filter and a row-detail dialog)

- **"Attested only" pill**, first in the filter row: isolates exactly the
  distinction the product is sold on, through `attestationOf` so the pill
  and the gutter dot share one definition. Ungated: the dot already shows
  on every free row.
- **A row-detail dialog** on the shared modal anatomy surfaces what the
  grid holds but hides: full copyable address (the same in-place swap),
  evidence and reachability states with visible labels, Lens, GitHub,
  Farcaster bio, the second X handle, and the agent fields on agent rows.
  Opened from a pinned per-row details button in a new trailing column,
  keyboard reachable, titled by ENS, handle, or wallet.
- These are the openstatus data-table patterns judged worth porting;
  the assessment deliberately skipped the installable blocks, the command
  palette, cell renderers, and infinite scroll as mismatched to this
  token-native client-side grid.

### 2026-08-22 (premium polish: the guidelines audit and the motion pass land)

- **Two data-honesty bugs.** The results table rendered every holdings value
  as USD even when the column is a token balance ("Bag"); it now formats a
  plain decimal in the browser locale. And the holder pages typed the
  free-allowance figures; they interpolate the constants.
- **Accessibility across the grid and checkout**: the attestation dots carry
  sr-only text, "Copied!" is a status announcement above the sticky header,
  the search input has a name, error and caution panels announce, the email
  field autofills and focuses on validation failure, loading buttons keep a
  text label, and username inputs stop autocorrecting.
- **An unsaved completed lookup warns before the tab closes**; exporting or
  saving clears the guard.
- **Motion joins the system**: row hover and the sort arrow use the motion
  tokens (the arrow rotates instead of teleporting), the sort header gets
  the one focus ring and the one press transform, copy toast, checkout
  errors and the Buy button's label swap share one fade-in mechanism, dead
  shimmer CSS is gone, and disabled controls fade rather than snap (opacity
  joins .transition-control, kept under reduced motion; decided today).
- **"Top influencers (1K+)" is gated** behind credits with the lock
  affordance: ungated, it leaked the locked follower signal one bit at a
  time (decided today). Also: one empty-cell character everywhere, real
  ellipses, prose links get the link-variant affordance, the Farcaster
  platform colours become tokens, and the pricing h1 carries its emphasis.

### 2026-08-22 (holder reachability reports: the programmatic SEO play ships)

- **`/holders/[chain]/[address]`: a report page per seeded collection.**
  Every page ranking for "[collection] holders" lists bare addresses; these
  answer who the people behind the wallets are and how many are reachable,
  from the index at hourly ISR (61 pages at launch, growing with the daily
  seed cron; no static figure literals, so nothing joins the figure
  checker by its own rule). Labels keep the discipline: "holders measured"
  and identity counts stay distinct from the attested-green "reachable
  people" number; the 2,000-holder measurement cap is disclosed on capped
  collections; aggregates only, never a wallet or handle list.
- **An overlap section links the mesh together** ("these holders also
  hold", seeded collections only), plus a `/holders` hub grouped by chain,
  sitemap entries (hub 0.8, reports 0.7) and a footer link.
- **`scripts/cast-farcaster.ts` and `scripts/setup-farcaster-signer.ts`**
  (PR #150): casting as @walletlink through an approved Neynar managed
  signer, dry-run default, budget-gated.

### 2026-08-22 (the welcome sequence goes live for new signups)

- **The five-email welcome sequence sends, daily at 15:00 UTC.** Jake
  approved the copy (his edits in `docs/EMAIL-SEQUENCE.md` are canonical and
  are mirrored verbatim in `lib/welcome-sequence.ts`, with `**bold**` and
  `*italic*` markers now rendered by the lifecycle template).
  Enrollment starts at accounts created on or after 2026-08-23: the earlier
  ~100 signups stay reserved for the relaunch campaign, which has still not
  been sent. **Corrected 2026-08-24: it was sent on 2026-08-23**, 100 granted
  and 100 emailed, 0 failures. Those accounts now hold credit lots, so the
  purchase rule excludes them from the welcome sequence independently of the
  cutoff. Exits: any credit lot, opt-out, legacy tier, whitelist. Every
  send is at-most-once via `lifecycle_emails`; a missed day catches up one
  email per user per run. The cron heartbeats as `welcome_sequence` and the
  admin health pane watches it.

### 2026-08-22 (/llms.txt: the marketing site becomes citable)

- **`/llms.txt` exists** (`app/llms.txt/route.ts`). The docs site already
  auto-serves its own; this is the marketing half, so an answer engine asked
  "how do I find the X handle for a wallet address" has a plain-text,
  citable statement of the product, the coverage facts, and the pricing
  model. Every figure interpolates the shared constants where one exists;
  the reachability and owner-attested sentences are phrased to match their
  declared patterns, and the route joined those claims' watch lists in
  `scripts/check-published-figures.ts` (40 figures checked, up from 36).
  No provider names, no refund ambiguity (the no-refund policy is stated).

### 2026-08-22 (the admin panel reads what the instrumentation writes)

- **The checkout funnel shows the step it was blind to.** The Revenue tab
  gains "Reached Stripe" (checkout_redirected) between started and completed,
  plus a caution line with checkout_failed counts and their reasons. Both
  events existed to explain the started-to-completed gap and were write-only
  since they shipped.
- **Paywall triggers surface on the Behavior tab.** New
  `getPaywallTriggers` + `/api/admin/analytics/paywall`: buy-credits modal
  opens grouped by the gate that opened them. The per-gate names shipped
  earlier today; rows named `limit` and `feature` are the legacy labels.
- **Lifecycle email lands on the Growth tab.** New `getEmailStatus` +
  `/api/admin/email`: sends by email key from the `lifecycle_emails` ledger,
  plus the opt-out count. Both were readable only through ad-hoc SQL.
- The health pane now watches the 08:40 handle-conflict resolver cron (its
  heartbeat existed; the JOBS list did not know it), and the dead
  `getEventCounts` helper is gone.

### 2026-08-22 (/pricing through the critical readers, and two figures stop being typed)

- **The pricing copy survived a 7-critical-readers pass.** Headline is now
  "Pay per match. Misses cost nothing." (the model in the H1 slot instead of
  an "X, not Y" template); the lede carries the evidence claim and the
  free-proof line; "honest" is no longer self-applied; and a new FAQ entry
  states the refund policy plainly: no refunds, check first with the free
  allowance (decided by Jake 2026-08-22, recorded in
  .agents/product-marketing.md v2).
- **"12 months" and "seven chains" are derived, not typed.** New
  `CREDIT_LIFETIME_MONTHS` in lib/packs.ts; `CHAIN_COUNT_WORD` now imported
  where it was retyped. Interpolated at every surface that said either:
  /pricing, PackPricing (all /vs pages), the layout JSON-LD, the success
  page, and the buy-credits modal.

### 2026-08-22 (/pricing exists)

- **`/pricing` is a page.** Until now the packs rendered only inside the
  buy-credits modal and on the /vs pages, so "walletlink pricing" searches
  and AI agents shortlisting tools found nothing at a URL. The page reuses
  `PackPricing` (every number a constant), computes its worked example from
  `MEASURED_MATCH_RATE`, answers the five pre-purchase questions in visible
  prose, and opens the buy-credits modal with the `pricing-page` trigger.
  Added to the sitemap at 0.9 and to the footer Product column. The
  site-wide FAQPage JSON-LD already carries the pricing answer, so the page
  adds no second structured-data block.

### 2026-08-22 (lifecycle email pipeline and the relaunch Trial-grant campaign)

- **Lifecycle mail exists as a category, separate from transactional.**
  `sendLifecycleEmail` in `lib/email.ts` sends with List-Unsubscribe and
  one-click headers, replies to help@walletlink.social, and refuses to send
  without `EMAIL_UNSUBSCRIBE_SECRET` (a send with no working unsubscribe is
  not a degraded send, it is one we must not make). Magic-link and purchase
  mail are unchanged and ignore the opt-out.
- **Schema: `users.email_opt_out` and the `lifecycle_emails` send ledger**
  (unique on user and email key, so every lifecycle send is at-most-once).
  Migration is `scripts/migrate-email-lifecycle.ts`; **run it before this
  deploys** (drizzle selects declared columns, the twitter_renamed_from
  lesson), then `scripts/migrate-grant-readonly.ts` for the CI role.
- **`/api/email/unsubscribe`**: stateless HMAC verification, GET for the
  footer link, POST for RFC 8058 one-click. Sets the flag and never reveals
  whether an address has an account.
- **`scripts/relaunch-trial-grant.ts`**: grants the Trial pack ($0 lot,
  synthetic payment id, noted) to every account that never bought and sends
  the campaign email. Dry-run default, `--to` preview, `--send` to execute,
  idempotent at both steps. Nothing has been sent. **Corrected 2026-08-24:
  sent 2026-08-23**, 100 grants and 100 emails, 0 failures, 25,000 matches
  granted. Track it with `scripts/relaunch-report.ts`.
- Funnel figures that motivated this (measured 2026-08-22): 102 accounts, 93
  from 2026-01, 11 ever ran a lookup, 0 ever bought, 2 signed in within 30
  days. Activation is the failure point, so the campaign gives the dormant
  list a concrete reason to return.

### 2026-08-22 (free-to-paid: gate analytics, checkout prefill, email sequence drafts)

- **The buy-credits modal logs which gate opened it.** `useUpgradeModal().open`
  takes an optional trigger name, and every gate passes its own:
  `export-x`, `column-followers`, `column-priority`, `reverse`,
  `contract-import`, `contract-import-link`, `deep-scan`, `submit-blocked`,
  `limit`, `limit-banner`, `header`. Before this every open logged as the
  generic `limit` or `feature`, so nothing could say which gate converts.
- **Signed-in buyers no longer retype their email at checkout.** The modal
  seeds an empty email field from the session on open; a deliberately typed
  different address survives.
- **`docs/EMAIL-SEQUENCE.md`: a five-email welcome sequence, drafted and
  stress-tested, not wired.** Copy passed a 7-critical-readers pass (one
  critical, six high findings fixed). The file carries the implementation
  plan: opt-out column, unsubscribe endpoint, state table, daily cron.
  Nothing sends without Jake's approval.

### 2026-08-22 (product marketing context document)

- **`.agents/product-marketing.md` is the positioning source of truth for
  marketing work.** Auto-drafted from README, `lib/public-figures.ts`,
  `lib/packs.ts` and the /vs pages; every figure in it is verified, and it
  bans quoting numbers that are not in `lib/public-figures.ts`. Marketing
  skills read it automatically, so positioning is defined once. Known gaps
  flagged inside: verbatim customer language and testimonials.

### 2026-08-22 (two open copy decisions closed)

- **The homepage headline is confirmed.** "Wallets in. People out." stays; the
  placeholder marker in `app/page.tsx` is gone.
- **The Buy credits dialog keeps its display-size title.** The one named
  exception to the dialog anatomy is now decided, not pending:
  `docs/DESIGN-LANGUAGE.md` records the reason (the purchase moment earns
  display type).

### 2026-08-22 (reverse lookups paginate, and the slice is no longer arbitrary)

- **`/v1/reverse/twitter/{handle}` and `/v1/reverse/farcaster/{username}` take
  a `cursor` query parameter and return `meta.next_cursor`.** Keyset
  pagination over (`fc_followers DESC NULLS LAST`, `wallet ASC`), encoded and
  strictly validated in `lib/reverse-cursor.ts`; a cursor the API did not
  produce answers `400 INVALID_CURSOR`. The +1-row probe makes `next_cursor`
  exact, and `truncated` now means more results remain after this page (on
  the first page that is the same signal as before).
- **The routes gained an ORDER BY.** They served an arbitrary, nondeterministic
  100-row slice; they now walk Farcaster reach first with the wallet address
  as tiebreak, matching the web app's `/api/reverse` ordering, which also
  makes the "ordered by Farcaster reach, matching the API" line in
  `docs-site/app/lookups.mdx` true.
- Billing is per page: 2 rate-limit units per request, 1 match credit per
  wallet returned, unchanged in rate.
- Docs: both reverse pages document `cursor`, `next_cursor`, the ordering and
  the live-index caveat; the "no pagination" paragraph is gone.

### 2026-08-22 (api_usage stores route templates, not concrete paths)

- **`api_usage.endpoint` now holds the route template.** The three
  parameterized `/v1` routes pass `/v1/wallet/{address}`,
  `/v1/reverse/twitter/{handle}` and `/v1/reverse/farcaster/{username}` as
  literals, and the dormant `withApiAuth` wrapper derives the template with
  the new `routeTemplate()` in `lib/api-usage.ts`. This bounds
  `requests_by_endpoint` in `/v1/usage` at one key per route, and it stops
  persisting the addresses and handles a customer looked up in an analytics
  table that echoed them back.
- **`scripts/migrate-endpoint-templates.ts`** rewrites the already-written
  rows to the templates. Hand-written idempotent SQL, per the migration
  pattern; it verifies that no concrete path remains under the three routes.
- `docs-site/api-reference/usage.mdx` documents the new keying and drops the
  unbounded-cardinality warning.

### 2026-08-22 (the renamed-from guard covers the fill-if-empty ingests)

- **`lib/ens-harvest.ts` and `lib/attested-links.ts` refuse a fill equal to
  `twitter_renamed_from`.** Both writers only fill a NULL `twitter_handle`,
  and the stored handle is NULL exactly on rows that were cleared, so an ENS
  text record or an attested link that still carries the dead string could put
  it back. A refused fill writes nothing: no handle, no url, no user id, no
  source label, no quality bump, no timestamp. With this, every social_graph
  writer that carries an incoming X handle holds the guard, and the
  `lib/conflict-resolution.ts` header now documents that invariant.
- **Stale records corrected.** `PROJECT_OVERVIEW.md` closed the open item (the
  sweep and live lookup guards shipped in PRs #135/#136), and
  `docs/DOCS-SITE.md` now records the Mintlify GitHub sync as connected, which
  it has been since content merged to `main` started publishing.

### 2026-08-22 (handle conflicts: the unreachable bucket resolves itself)

- **Bucket 1 of the conflict queue resolves automatically.** Measured on
  2026-08-22, 1,602 of the 2,914 open `handle_conflicts` had our stored X
  handle reaching nobody (`not_found` 1,363, `unavailable` 239) while the
  handle an attested source named was live, and in 1,598 of those the source
  also supplied the numeric id of the account, which matched. A customer who
  sends to our handle there reaches nobody, so there is nothing to protect by
  keeping it. `lib/conflict-resolution.ts` accepts theirs when the conflict is
  unresolved, the graph still serves the handle the conflict calls ours, the
  row is not admin-curated, ours is `not_found` or `unavailable` on a check no
  older than 7 days, theirs is live with an id on a check no older than 7
  days, and any id the source supplied equals the live one. A source with no
  id (the onchain attestation sweep) qualifies on liveness. Stale or missing
  checks are re-run first through `sweepHandles`, within a credit cap, one
  lookup to a row before two, rows whose our side is already known dead first.

- **What accepting writes.** `social_graph.twitter_renamed_from` = the old
  handle (new nullable column; `scripts/migrate-handle-renames.ts`, hand-written
  SQL, idempotent, no grant needed), `twitter_handle` = theirs, `twitter_url`,
  `twitter_user_id` = the source's id or the live one, `twitter_verified` =
  true, the source appended to `sources` without duplicates, `last_updated_at`
  = now(); `handle_conflicts.resolved_at` = now() with `resolution`
  `accepted-theirs: ours unreachable`; the wallet's `wallet_cache` row is
  deleted so the old handle is not served from cache for up to 7 days.
  **Apply the migration before this deploys**: `db/schema.ts` declares the
  column, and every `db.select().from(socialGraph)` in `lib/social-graph.ts`
  selects it, so a build that reaches production before
  `scripts/migrate-handle-renames.ts` has run fails every graph read with
  `column twitter_renamed_from does not exist`. One
  statement per batch of 500, with data-modifying CTEs, so a batch is atomic on
  the `neon-http` driver, which has no transactions. Every condition is
  re-tested inside the statement. Where two sources both qualify for one
  wallet, the one with an id is taken, every qualifying row naming the same
  handle closes with it, and a row naming a different handle stays open. A
  second run writes nothing.

- **Daily cron `/api/cron/resolve-conflicts` at 08:40 UTC**, after the
  reachability sweep at 08:00, same bearer auth and shape as the other crons,
  `maxDuration` 300, a `handle_conflicts_resolve` event. The recheck spend is a
  fixed `CONFLICT_RECHECK_CREDITS` (default 300, about fourteen lookups) rather
  than a share of the balance, and is refused when the balance cannot be read
  or sits at the reserve; acceptance still runs, since it costs nothing.
  `npx tsx --env-file=.env.local scripts/resolve-handle-conflicts.ts
[--dry-run] [--limit N] [--credit-cap N] [--recheck-days N]` is the manual
  entry. The dry run prints counts, the blocked reasons, what it would re-check
  and a sample of 20, and writes nothing, rechecks included.

- **The first run is the one that matters.** Every check behind the 1,602 was
  made on 2026-08-17, so a run before 2026-08-24 accepts them without spending
  a credit. After that, each row costs two lookups to re-qualify, and the
  default cap clears about seven rows a day.

- **Bucket 2 is surfaced, never swapped.** Where an unresolved conflict has
  both handles live, and any id the source supplied matches the account theirs
  resolves to, the result carries the second handle as `twitter_also`
  (`alsoOnXForWallets` in `lib/handle-reachability.ts`: one query per batch,
  keyed by wallet, `source` mapped through `publicSources`, so a customer sees
  the evidence class and never the provider). Ours stays primary. It appears
  under the X handle in the results row as a muted mono "also @handle" with a
  title saying both accounts reach someone; in the CSV as a `twitter_also`
  column, named like its siblings; in the X list export, which exists to reach
  people, so both handles go in; and in the public API as `twitter.also`
  (`{ handle, url, source }`) on `/v1/wallet` and `/v1/batch`, built in
  `publicTwitterField` and absent, not null, everywhere else. Documented in
  `docs-site/api-reference/wallet.mdx` and `batch.mdx`, which also stop
  claiming that batch omits `twitter.verified`; it has returned it since the
  four routes moved onto one builder. Stamped in `finalizeJobWithResults`
  after reachability, so a saved lookup carries it and a manual correction
  clears it along with the reachability verdict.

- **Admin.** The conflicts pane shows two more tiles, Resolved and Resolved in
  7 days, with the green dot, and the Unreachable hint says the group resolves
  automatically each day. The reader still offers no resolve button.

- **Not closed by this change.** The old handle is still the string Farcaster
  holds for the account, and two writers carry it back over an accepted swap:
  the monthly full Farcaster sweep (`lib/farcaster-sweep.ts`, which treats an
  incoming attested handle as authoritative) and a live lookup that reaches the
  Farcaster API (`lib/social-graph.ts`, which prefers the incoming handle).
  `twitter_renamed_from` is the column those writers need to refuse an
  incoming handle equal to it. Until they do, a swap lasts until the next
  writer carrying the dead string, and the next ingest reopens the conflict.

### 2026-08-22 (vs Formo; Blaze and Airstack marked retired)

- **New comparison: `/vs/formo`.** Formo is analytics and attribution for
  DeFi apps, sold as a subscription (Growth $199 a month billed yearly, $249
  monthly; Scale $399 billed yearly, $499 monthly; read from formo.so on
  2026-08-22 and confirmed in a browser). The overlap is its wallet profiles
  and the Import Wallets feature on Scale, plus a per-address profile over
  x402 at 0.05 USDC. The page prices a 10,000-wallet list three ways with the
  arithmetic shown, computed from `lib/packs.ts`, and says plainly when Formo
  is the right tool. Every Formo figure is dated in the copy. The
  reachability card on this page states the weaker claim the evidence
  supports ("nothing in Formo’s docs says it does") through a new
  `undocumented` prop.

- **Blaze and Airstack are gone; their pages stay.** withblaze.app and its
  dashboard, API and blog hosts no longer resolve (last archived copy January
  2026, no shutdown post found). airstack.xyz redirects to senpi.ai; its app
  and API hosts are down and it deprecated its Farcaster APIs on 2025-03-05.
  Both pages open with a dated "What happened to" section, speak of the
  service in the past tense (`ReachabilityClaim` gained a `retired` prop),
  and drop to priority 0.7 in the sitemap. An unsourced Blaze price was
  removed rather than kept.

- **Footer and related links list live competitors only:** Addressable,
  Holder, Cookie3, Formo. The retired pages link to each other and to the
  live four.

### 2026-08-22 (design review, PR 3 of 3: openings, motion, spacing)

- **Every page opens the same way.** Home now carries the signature the
  comparison pages had alone: a 200-weight display line with one 600-weight
  word, a 300 lede, then a `Figure` row for the three index figures. The
  headline "Wallets in. People out." is a placeholder marked in the code for
  Jake to confirm. `/check`, the blog index, the blog post and admin open on
  the same shape; section h2s are 300/24px everywhere, card titles 600/18px,
  and the reading column is left-aligned on every page.

- **Motion on the scale.** Progress fills, meter bars and the DM progress bar
  animate `transform: scaleX()` at the tokened duration, never `width`;
  `transition-colors` is gone in favour of `transition-control` on every
  surface including `Card` and table rows; the dialog panel arrives by fade
  and `scale(0.97)` over `--d-base` and leaves faster; the close is a ghost
  icon button. `--tracking-body` is applied on `body`.

- **One surface, nine steps.** Every `bg-muted/30`, `/40`, `/50` and
  `bg-card/80` wash is `bg-muted` at full opacity; cards are `p-6`, insets
  `p-4`; the 6, 10, 14, 20 and 40px spacings in the shell, footer, Recent
  wins, dropzone and `/vs` proof strips moved to the nearest step. The
  drag-over scrim is the dialog scrim. One `InlineError` for every error
  beside a control, replacing four shapes.

- **Blog copy.** Titles and table row labels in sentence case; 182 typed
  double hyphens and em dashes replaced with the mark each sentence wanted;
  one list marker. Figures unchanged and re-verified.

- **Admin.** Figures at 200 with tabular numerals, one stat-tile anatomy,
  pane headings and the h1 on the tier, one refresh control, one loading and
  one empty treatment, the conflicts filter as `Segmented` with short labels
  below `sm`, match rates as figures rather than progress bars.

- **Three new guard rules** so none of this comes back: `transition-colors`
  and `transition-all`, a `/NN` wash on a surface token, and a tracking
  literal (`tracking-tight`, `tracking-[-0.028em]`) all fail CI. Recorded in
  `docs/DESIGN-LANGUAGE.md` with the opening shape, the dialog anatomy and
  the left-aligned reading column.

### 2026-08-22 (design review, PR 2 of 3: use the primitives)

- **One figure, one weight.** `Figure` is the hero-figure weight (200) and
  loses its `brand` prop; prices, DM counters, Recent wins and the results
  hero count all render through it. `font-bold` is gone from the app: the
  five-weight scale has no 700, and `strong` now lands on 600 by a base rule.

- **Green is a fact.** The reachable count, the progress counters and pulse,
  a sent DM, a valid key, a delivered sign-in link and a completed purchase
  are `attested`; violet is back to meaning "you can act on this". The
  second green pair kept for the upgrade checklist is deleted.

- **The primitives own the patterns.** One focus ring (`FOCUS_RING`) shared
  by Button, Input, Textarea and Segmented; press feedback on every Button
  variant; the remaining shadcn semantics out of Button, Table and Progress;
  Eyebrow and Badge at the specified 11px, which the design guard now allows
  in exactly those two files. The account menu is `OverflowMenu`; admin
  tables are `Table`, admin chips are `Badge`, admin banners are one error
  and one success treatment.

- **Results.** Locked columns carry one "Unlock" control in the header
  instead of sixteen muted buttons; filters have constant labels and the
  segmented selected treatment; column headers say X handle, Farcaster and
  Farcaster followers; the wallet-cell chips are `Badge`; in-cell text
  controls are the link variant. Export buttons carry one icon and `XMark`.
  Progress stages use Phosphor glyphs, no growing dot or shadow, a green
  pulse, and Cancel at the control height.

- **One word.** "X" in running copy and `XMark` where a mark is wanted, on
  every surface including the share buttons, the overflow menu and admin;
  "Farcaster" in full. One CTA label ("Run a lookup") on the blog post and
  the five comparison pages, through `Button`. The contract dialog's title
  matches its trigger. Related comparisons name each page one way.

- **Dialogs.** Titles on the primitive's one treatment (Buy credits keeps
  its display title pending a decision); one action-row layout via
  `ModalFooter`; radius and inset kept below `sm`; the revealed API key wraps
  instead of scrolling sideways; one external-link glyph.

- **Guard.** The arbitrary-size rule now catches `rem` as well as `px`, and
  the border-opacity rule covers `caution` and `destructive`. The wordmark
  moves from an arbitrary 32px to `text-3xl`, which also puts it on the
  title tracking token.

### 2026-08-22 (design review, PR 1 of 3: defects and the shell)

- **One header on every page.** `PageShell` now renders the account cluster
  itself (balance chip, Buy credits, theme control, Sign in or avatar), so
  `/check`, the five `/vs` pages and the blog carry the same header as home.
  Before this a dark-mode visitor on `/vs` at desktop width had no theme
  control anywhere on the page, and a signed-in buyer there saw no balance.
  The upgrade dialog moved into a provider (`useUpgradeModal`) so the header
  can open it from any route. "Sign in" at every width; below `sm` Buy credits
  is the icon control with an accessible name rather than a "+" pill.

- **Phones can read the results and the blog again.** The results table is
  the product's one genuine data table, and it now scrolls sideways inside its
  own box with the wallet column pinned; it used to clip four columns with no
  way to reach them. Blog tables get their own scroll box, so the post no
  longer scrolls the whole page at 375px.

- **Control edges at 3:1.** Every textarea and the two home alternates drew
  their edge with the decorative hairline (1.26:1). A `Textarea` primitive
  shares `Input`'s edge; the alternates are `Button` outlines. Pending stage
  labels no longer sit at half opacity below AA.

- **Keyboard and screen readers.** Sort headers are real buttons with
  `aria-sort`; icon-only controls have names; form labels are associated with
  their fields; the admin job dialog is the `Modal` primitive with a focus
  trap and Escape instead of a hand-rolled `fixed inset-0`.

- **One badge.** `CHIP` and six hand-rolled chips are `<Badge>`, including the
  two "Credits" badges that sat forty pixels apart in two shapes. A
  `destructive-tint` token joins the other three tints.

- **Smaller defects.** The results heading derives a real name ("4 pasted
  wallets", the CSV file name, "Holders of X") and never falls back to
  "Results"; the cache note reads the 7-day TTL from the constant instead of
  saying 24h; the chat launcher is 48px and sits below open dialogs; admin
  queue health reads its payload instead of hard-coded zeros; measured-good
  admin states are green, not violet; `/vs` capability cells carry alt text
  and the pricing blocks have a gap.

### 2026-08-22 (Farcaster DMs for every pack)

- **Farcaster DMs open to pack holders.** The in-app DM sender had stayed on
  the legacy Unlimited account after the pricing change, because it was not on
  the pack feature list. It is now, and the button, the docs and the two
  pack feature lists say so. The route behind it had no auth at all (it
  proxies Warpcast with the caller's own key); it now requires a session and
  the same entitlement as the button.

### 2026-08-22 (the rest of the product catches up with the pricing)

- **Every surface now describes credit packs.** An audit after the pricing
  change found 168 places still describing the retired tiers: the app UI, the
  API error messages, the admin, the five comparison pages, thirteen blog
  posts, the public docs and the internal docs. All fixed in one branch, so a
  customer, a search engine and the AI assistant get the same answer. Text
  that exists only to serve the two legacy accounts keeps its tier names and
  says so.

- **Pack buyers were refused what the pack sold them, server-side.** The
  client gates were fixed with the pricing change; the routes behind them
  still read `tier`, which a pack never changes. Reverse lookup, contract
  import, adding addresses to a saved lookup and "new since you looked" all
  returned 403 naming Pro or Unlimited. Priority scores and follower counts
  were stripped from every pack buyer's job. Contract import was capped at 500
  holders for an Index buyer. `hasPaidAccess` in `lib/credits.ts` is the
  server twin of the client's `entitled`, and every gate uses it.

- **Two holes in the meter closed.** The free-window sum counted pack-paid
  debits against the free allowance, so the month after a buyer's lots ran out
  reported it exhausted. And `/api/lookup`, the original streaming path the
  UI stopped using in January, ran up to 5,000 wallets per request for any
  signed-in account with no balance check, no debit, and priority scores for
  everyone. Nothing had called it since the move (no rate-limit bucket was
  ever opened for it); it answers 410 with the replacement.

- **API keys need a live pack, not the free allowance.** `available > 0` is
  true for every signup inside its window, which would have let any free
  account mint a key. The server now matches the modal that offers keys.

- **The API says what was billed.** `/v1/batch` returns `meta.matched`, the
  billed count; `found` still counts ENS, Lens and GitHub, so `found >=
matched`. `/v1/usage` returns a `credits` object. `/api/developer/plans`
  returns the packs instead of three monthly plans nobody could buy, and
  `POST /api/checkout` no longer accepts a tier.

- **Admin sees packs.** Revenue is keyed on what was sold (`byProduct`), the
  dependency check watches the four pack price variables, the overview counts
  credit holders, and the per-user control can no longer grant a legacy tier:
  goodwill credit is a lot, not a tier.

- **Removed:** `upgradeUser` and `createCheckoutSession(email, tier)`, both
  uncalled since the pricing change, and the `/api/lookup` rate-limit entry.

### 2026-08-20 (credits, and a rating nobody gave us)

- **Pricing moves from one-time tiers to credit packs, metered in matches.** A
  match is a wallet resolved to an 𝕏 or Farcaster account; a wallet we cannot
  resolve costs nothing. Free is 100 matches every 30 days, then Trial $29 for
  250, Campaign $99 for 1,500, Scale $299 for 6,000, Index $899 for 25,000.
  Credits last 12 months. Still one-time payments: Stripe stays on
  `mode: 'payment'`.

- **The meter was the actual problem, not the price.** Free was 500 wallets per
  lookup with unlimited lookups and no cumulative quota, so the largest job in
  the product's history split into 27 free uploads and the median job of 300
  fitted whole. Nothing the product has ever done needed paying for. A
  per-lookup cap punishes the honest user and rewards splitting a file; the
  allowance is cumulative and account-wide now, so twenty runs of 500 debit
  exactly what one run of 10,000 debits.

- **Why packs rather than the subscription that was proposed.** 95 of 100
  identified people were active in exactly one calendar month and never
  returned, and 104 of 110 person-months consumed under 1,000 wallets. A monthly
  plan against that distribution posts roughly 95% logo churn at month two,
  nine to twenty-five times worse than the worst benchmark bucket for companies
  with no annual option. Packs also avoid building a customer portal, dunning,
  proration and the revocation path that `provisionPaidCheckout` is deliberately
  built without.

- **Why a match rather than a submitted wallet.** The median hit rate on a real
  list is 2.7%, and 29 of 64 real-list jobs returned under 2%. Billing by
  submitted wallet charges people for our coverage gaps. Billing by match makes
  the weakest number in the product irrelevant to what anyone pays, and it is
  the only version of "we do not guess" that reaches the invoice.

- **`aggregateRating` claimed 4.8 from 50 ratings, and there are no 50
  ratings.** The product has 102 accounts, one payment, and no review collected
  anywhere. That was fabricated structured data served to Google and to AI
  assistants, on a site whose whole position is reporting only what it can
  evidence, sitting two hundred lines from a FAQ answer about how carefully we
  distinguish an attested handle from an inferred one. Removed.

- **The two existing paying accounts keep exactly what they bought.** Neither is
  metered, on any path. The Unlimited account gets one condition, an
  anti-enumeration ceiling of 1,000,000 wallets in a rolling 24 hours, which is
  75x the largest job anyone has ever run and cannot reach a customer. Attaching
  any condition to a promise sold without one is a retraction, which is why it
  is set that high and why the message says the cap is on bulk extraction rather
  than on lookups.

- **Export is never capped, on any plan, and that is now a stated position.**
  The export is the product: upload a CSV, get a resolved CSV back. Cookie3 caps
  enriched exports at 5,000 wallets on a $299 plan and `/vs/cookie3` attacks
  them for it, so capping ours would have deleted our own comparison page. What
  gets gated instead is volume, and nothing else.

- **`PackPricing` is one component on five comparison pages**, for the same
  reason as `ReachabilityClaim`: it belongs everywhere and it contains numbers.
  Each page previously hardcoded a pricing section beside an interpolated
  `TIER_PRICES`, so half the figures moved when the constants moved and half did
  not.

### 2026-08-20 (a figure that could only fail by growing)

- **Review fixes, and both were the same mistake twice.** The measurement guard
  hardcoded the expected `13` in the checker instead of reading it from the
  record, which checks that the copy still agrees with the checker rather than
  with the measurement: change the sample's rate in `docs/SEO-STRATEGY.md` and
  everything stays green, which is exactly the failure the guard was added to
  catch. Both rates now come out of the record, so there is one authority and
  the checker is not it. The blog table publishing 23.7% is declared too, having
  been left out of the first version.
- **A consolidation that leaves one copy behind has not consolidated anything.**
  `lib/x-accounts.ts` still asserted its own 417,872 in the present tense,
  outside both claims, in the same commit that corrected the literal everywhere a
  customer reads it. Declared now, on the numerator and the denominator.
- **A dated record of one run is not a claim about the current total.** That file
  also says the first sweep resolved 417,998 handles in a four-hour window on
  2026-08-17, twice, as the evidence for why the staleness threshold is per
  handle. Both sentences are correct and stay correct: rewriting accurate history
  to satisfy a regex is the worse trade. Claims take an `ignoreNear` list for
  this, kept to narrow phrases rather than a file-level opt-out, because an
  exemption has to be honest about what it exempts.
- **And the anchor phrase stopped matching mid-commit, which is the argument for
  all of it.** Reflowing a doc comment split "we hold" across a line, the
  denominator pattern went quiet, and only the check's own NO MATCH line caught
  it. Every word of that phrase now tolerates a comment continuation.
- **The exemption then created the hole it was meant to avoid.** `ignoreNear`
  skipped historical figures inside the comparison loop, but the NO MATCH test
  ran before it, on raw regex hits. So a file whose every occurrence is exempt
  satisfied the test and compared nothing: green, with zero verification.
  `lib/x-accounts.ts` sits exactly there, one reworded sentence away from going
  quiet with two dated historical figures still matching. Exemptions are applied
  before the test now, so the question it asks is "is there a live claim here"
  rather than "did the regex hit anything". Verified by rewording that sentence:
  it fails NO MATCH where it previously passed.

- **A published count sat three days stale and every check reported green.**
  The resolved-handle figure said 417,872 across the docs, the README, the
  reachability panel and the AI prompt while the database held 428,059. Nothing
  caught it, and nothing was ever going to: the claim is declared as a `ceiling`,
  which passes whenever the published number is at or below the truth, because
  understating a count that only grows is safe. Safe is not the same as true. A
  ceiling now takes a second bound in the other direction, `staleBelow`, and
  fails at 2% behind with its own `STALE` line rather than an overstatement
  warning that would read as the wrong problem.

- **One fact, three numbers, again.** 417,872 in five surfaces, 422,990 in
  `lib/handle-reachability.ts`, 428,059 in the database. Its denominator was in
  the same state: 446,070 in one module header, 446,043 in another and in the
  docs, 446,329 in the database. Both now live in `lib/public-figures.ts` as
  `X_HANDLES_RESOLVED` and `X_HANDLES_HELD`, the reachability panel interpolates
  the first the way the homepage already interpolated the index size, and the
  denominator is declared for the first time. A coverage percentage is only as
  honest as the number underneath it, and nothing had ever looked at that one.

- **4.7M and 4.8M are two facts one digit apart, and only one was declared.**
  4.7 million is the Farcaster half; 4.8 million is every wallet with any
  identity. The blog post and `lib/eas-attestations.ts` carried an undeclared
  4.7M that reads exactly like a stale 4.8M. It is neither: it is correct, and it
  was one well-meaning correction away from becoming the wrong number, which is
  precisely how 4.8M, 4.9M and 5M happened the first time. Declared now.

- **The match rates cannot be settled by a query, so they are checked another
  way.** 23.7% any-identity and the ~13% reachable figure beside it came from a
  random sample of 600 holders across 18 collections, not from the database. The
  nearest query measures index composition rather than what a customer's list
  will match, and a green tick against the wrong predicate is a lie with a
  checkmark on it. Instead the measurement carries its date, the check fails when
  the sample is older than 120 days, and the published figure must still equal
  what the sample produced. That catches both real failures: an edit that changed
  the number without redoing the work, and a sample quoted for a year while the
  index it sampled tripled.

- **What is deliberately not declared, said out loud.** "22%" appears in about
  ten blog posts, and the same two digits carry unrelated facts in the same
  folder: one case study's governance participation went from 5.2% to 22.4%. A
  pattern loose enough to catch the match rate catches that too and reports it as
  drift. Declaring them properly is one entry per post, which is a job rather
  than a line, so the checker prints the gap as a note instead of pretending.

- **Four patterns were wrong the moment they were written**, and the check said
  so before this shipped: the resolved-handle window reached 33 characters into a
  neighbouring sentence and read "235,858 persisted negatives" as the claim, the
  denominator pattern matched the numerator sitting one sentence above it, and
  the coverage page's split stopped matching when its sentence moved from "were
  live" to "are live". The registry is only as good as its patterns, and the
  cheapest place to find that out is a local run.
- **A guard whose tolerance is wider than the gap it guards does nothing.** The
  Farcaster claim exists to stop 4.7 being "corrected" into the 4.8
  any-identity figure, and at a 3% tolerance that exact mix-up passed: 4.8
  against a true 4.6996 is 2.14% off. The mirror passed too, 4.7 against a true
  4.813 being 2.35% off. Both are 1% now. The rule a tolerance has to satisfy is
  not "is this close enough to be honest" but "is this tighter than the
  distance to the nearest value it could be confused with".

### 2026-08-20 (a comparison page aimed at the wrong Cookie)

- **`/vs/cookie` argued against a product that does not compete with us.** The
  page was built around Cookie.fun, which indexes AI agents and gates its premium
  analytics behind staking 10,000 $COOKIE. It ranks agent mindshare. It does not
  resolve a wallet list to anybody, so nobody choosing between it and us was
  making a real choice, and the page drew agent traders rather than people with a
  holder list. The competitor is Cookie3, a separate subscription product that
  sells "Advertise: Twitter<>Wallet Matching" as a line item on a published price
  sheet. `/vs/cookie3` replaces the page, and `/vs/cookie` 308s to it rather than
  404ing, because the old URL is in a sitemap that has already been crawled and
  is linked from four sibling pages and the footer.

- **The argument turned out to be a ceiling, not a price.** Cookie3's own plan
  table caps Twitter matching at 10,000 accounts on Website ($59/mo), Basic
  ($299/mo) and Growth ($749/mo) alike. Paying more buys wallet volume and export
  headroom and leaves the cap exactly where it was; only Enterprise, which is
  unpriced, lifts it. So a 50,000-wallet match is not buyable at any published
  price. That is their number rather than ours, which is what makes it worth
  building a page on.

- **Their prices carry the date they were read.** A competitor's price sheet is
  the one fact on a comparison page that goes stale without anything failing, so
  the table says when it was taken. Cookie3 does not make it easy to check: the
  nav "Pricing" link is inert and /pricing 404s, so the real table sits partway
  down /business.

- **The page also says the two Cookies apart.** The names collide, both products
  come from the same orbit, and a reader who lands on the wrong one has no way to
  tell. A short section names which is which and sends the agent-research reader
  where they meant to go.

### 2026-08-19 (a dot that only lined up at one row height)

- **A manual correction now reaches the saved lookups that show it.** Editing a
  wallet in the admin enrichment tab wrote to `social_graph` and stopped there,
  so every completed lookup kept the value a person had just declared wrong.
  A completed lookup is normally a record of what was true when it ran, and that
  is right; a manual edit is the one exception, because its whole purpose is to
  say the stored value was an error. Found on a real import, where a wallet kept
  showing a handle that no longer belongs to its owner after the correct one had
  been entered by hand. Only the corrected wallet's own row is touched, and only
  the fields the edit set.

- **The attestation dot sat below the address it belongs to.** The gutter pinned
  it with `items-start pt-3`, a fixed 12px from the top edge, while every other
  cell in the row is centred by the row's own `items-center`. The two agree at
  exactly one row height and drift at any other, which is why it looked fine
  when it was written and wrong in a screenshot. The gutter now centres like
  everything beside it.

### 2026-08-19 (the Bag, and a list that repeated people)

- **A contract import now shows how much each wallet holds.** Every holder
  source already returned the balance beside the address and all three parsers
  read the address and dropped it. The column itself needed no building: CSV
  uploads have had a holdings column all along, sortable, and feeding the
  priority score. Contract import was the one path that never filled it, so this
  is mostly a matter of stopping the discard and naming the column.
- **Whole units, or nothing.** An ERC-20 balance is an integer in the token's
  smallest unit and means nothing without `decimals`, so `decimals()` joins
  `name()` and `symbol()` on the metadata call. When it does not answer, the
  column is hidden rather than filled by assuming the usual 18: a wrong exponent
  misstates every row by orders of magnitude, and no column is honest where a
  confident wrong number is not. Balances go through `BigInt` before
  `formatUnits`, because a whale balance loses precision in a double well before
  the decimal point.
- **NFTs count items.** `getOwnersForContract` was asking for
  `withTokenBalances=false`; it now asks for true and sums the quantities per
  owner, so ERC-721 reads as the number owned and ERC-1155 as total quantity
  held. The cost is a response that grows with supply rather than with holder
  count, for the same single request.
- **A wallet missing from the map is one we did not measure**, not one holding
  nothing, so nothing is zero-filled anywhere along the path.
- **The header says "Bag" only where it is one.** A contract import is always a
  balance or an item count; an uploaded CSV column may be a USD value, and
  relabelling that "Bag" would be wrong. Same column, same sort, same score.
- **The Twitter list export repeated people.** One person with several wallets
  is several rows and one handle, which is the thing this index exists to
  reveal, and the file listed them once per wallet. Deduped on the lowercased
  handle, since X is case-insensitive and our sources disagree on casing. The
  button's count is now derived from that same list rather than counted
  separately, and the "left out" figure counts distinct dead handles too:
  reporting handles going in and rows left out put two different units in one
  sentence.

### 2026-08-19 (the footer names the company)

- **The site footer now reads "© 2026 Starl3xx Labs LLC"** rather than naming
  the site back to itself, and the byline points at starl3xx.fun rather than at
  an X profile. The year stays derived from the clock, so it is right next
  January without anyone remembering it.

### 2026-08-19 (a first-party consumer, and a sentence that expired overnight)

- **A first-party project now reads the index through the public API**, on its
  own service account with a real plan rather than an internal bypass. One
  account per consuming project, so revoking one touches nothing else and the
  usage panel attributes load to the project that caused it rather than to a
  person who owns several. `scripts/provision-api-account.ts` does it, and
  writes the key to a file at 0600 rather than printing it, because terminal
  scrollback gets pasted into issues.
- **The plan is metered on purpose.** The rate limiter is the only thing between
  a first-party consumer and the live lookup path a customer is on, and the
  Developer plan's 60/min is tight enough to catch the real failure mode of a
  key wired into a bot, which is a retry loop rather than steady load.
- **Provisioning never downgrades, and never pretends to rotate.** `--tier`
  defaults to `pro`, so re-running to mint a second key would have dropped an
  `unlimited` account to Developer limits without a word, and the key's plan came
  from the argument rather than from the account, which is the same downgrade by
  another route. The tier now only ever moves up the ladder, and the plan is
  derived from the tier the account actually holds. Minting also does not revoke:
  that is right for adding a consumer and wrong for a leak, so existing active
  keys are named as **STILL VALID** and `--revoke-existing` is the flag that
  makes a rotation a rotation. `TIER_RANK` moved to `lib/api-plans.ts`, since
  this was the second caller needing to compare two tiers and the first one had
  it as a private const.
- **The reachability docstring had gone stale in one day.** It said coverage was
  "93.7% and falling, because new handles arrive continuously and no scheduled
  job resolves them". The cron scheduled the next day is exactly the job it says
  does not exist, and coverage is now 94.8% and rising, with 422,990 handles
  checked and none left unchecked. The figure guard passed throughout, because
  it checks numbers against the database and this was a false clause sitting
  beside numbers that were merely stale.

### 2026-08-19 (the safe direction was still a dead end)

- **Yesterday's fix worked, and that is how we found the next one.** The Clanker
  sweep held its checkpoint rather than walking past a deploy it could not
  resolve, reported the run as failed, and the failure was real: the frontier had
  stopped at a single block and was 37,372 blocks behind the chain tip.
- **The account id was not an account id.** That deploy wrote the tweet's own
  status id into the `id` field instead of the user id. It is 19 digits, so
  `isAccountId` accepts it, and it names a user that has never existed. The
  resolver answers “no such user” and always will. Holding for a resolver that
  might recover is the right instinct against an outage and the wrong one here.
- **A permanent hold ends ingestion, quietly.** The scan starts at
  `checkpoint + 1`, so a frontier that never advances scans one fixed window.
  `MAX_RUN_BLOCKS` bounds that window to a week, which means once the tip passed
  it the sweep would have gone blind to new blocks while still reporting a run
  every day. That was due about 2026-08-25. The run cap bounds the work; it was
  never going to end the stall.
- **The frontier now gives up on evidence, not on elapsed time.** An id is
  retired after a reachable resolver has denied it on five separate runs, kept in
  `clanker_unresolved_ids`. A block distance measures how long we have been
  stuck and says nothing about the deploy that stuck us; a denial count is about
  the id itself and cannot be manufactured by an outage.
- **Only an answer counts as an answer.** `resolveAccountIds` now reports which
  ids the resolver actually replied about, separately from which it knew. A
  request that fails or never lands records nothing, so a repeat of the
  2026-08-18 outage, when the resolver's env vars were renamed and unset, would
  have added zero attempts rather than spending a fifth of every id's patience.
  This is the same distinction `x_handle_attempts` exists to make for handles.
- **Abandoning is not a failed run, and is still reported.** The range is
  finished, so the run is a success; `abandonedAccountIds` rides in the event
  metadata because it is the only path by which a link is knowingly given up.
- **The stuck block was cleared by hand, and cost nothing.** Waiting five days
  for the new threshold would have left four of them inside the blind window. The
  skipped deploy turned out to carry a link the same wallet had already
  established 104 blocks later in a well-formed deploy, so the graph lost
  nothing at all. `scripts/repair-clanker-checkpoint.ts` does this, refuses to
  move the checkpoint backwards, and needs `--apply` to write.
- **The catch-up run then cleared the whole backlog**: 18 links from 25 social
  deploys, 5 new wallets, and `blocksBehindHead` back to 0.

### 2026-08-18 (things that looked fine and were not)

- **Three "why is this empty" reports, none of which were empty.** The blog had
  no sort at all, so it came back in filename order and opened on 27 February.
  The admin funnel showed 0 page views above 34 lookups, because `page_view` and
  `csv_upload` were defined in January and never once called: 2,569 events in
  the table, not one of them either. Recent wins showed one tile because the 8%
  filter ran in JavaScript after a SQL LIMIT, so it only ever saw the 25 newest
  jobs while seven qualifying wins sat outside the fetch.
- **The funnel was dividing by a number nobody had collected.** `pageViews || 1`
  turned 34 lookups into "3400%" and 49 upgrade views into "4900%". A rate with
  no denominator now reads n/a, including for windows that predate the fix.
- **The token deploy scan was walking past links it could not resolve.** It
  dropped deploys whose account id the resolver could not answer for, which is
  right, and then advanced its checkpoint anyway, which made the drop permanent.
  It cost nine owner-attested wallet-to-X links on the morning the resolver's
  renamed env vars had not yet been set. The checkpoint is now a high-water mark
  of blocks actually finished, and a run that defers work says so.
- **The handle-liveness sweep is scheduled.** It had never had a cron while the
  docs promised a daily cycle. Its budget derives from the live balance and the
  reset date, `(balance - reserve) / daysUntilReset`, which cannot drive the
  balance below the reserve however often it runs.
- **Six faults had to be fixed before it could run unattended**, the worst being
  that transport failures were never recorded. Never-checked handles sort first,
  so the 22,828 that returned nothing on 2026-08-17 sat permanently at the head
  of the queue: what looked like a backlog was a loop. They are now backed off
  1, 2, 4, 8 days without anything being written to `x_accounts`, because a
  failed attempt is not a resolution.
- **A bulk pass no longer becomes a cliff.** All 417,998 rows were checked in a
  four-hour window, so at a flat 90 day threshold 417,872 of them came due on
  2026-11-15. Each handle now has its own threshold, derived from the handle, so
  the same rows spread across 91 days peaking at 4,804 against a capacity near
  5,112. Nothing rewrote `checked_at`: spreading the expiry is a policy, editing
  the timestamps would be a claim about when we looked.
- **The Health tab answers whether anything is configured and running.** Nine
  capabilities with what breaks without each, seven jobs with their last
  _successful_ run, and a section for work that runs on no schedule, which is
  how the missing cron stayed invisible. It makes no external requests.
- **Two sweeps were reporting failures as successes.** Both wrote their event
  before deciding they had failed, so a 502 left a record identical to a healthy
  run and the panel read them as fine.
- **walletlink.social/check.** One handle, no account, no key: reachable,
  suspended, no longer in use, or not checked yet. It reports how many wallets
  carry the handle and never which ones, because that is the paid reverse
  lookup. Unchecked renders neutral rather than green, since guessing there is
  the behaviour the page exists to disprove.

### 2026-08-17 (a second index behind the first, and a runbook that had moved)

- **A spent daily allowance no longer stops token import.** ERC-20 holder lists
  need somebody's index, because balances are a mapping with no enumerable owner
  list. There was one, it bills against a daily ceiling, and running out took
  the feature down on six chains at once for reasons that were ours rather than
  the customer's. A customer import that meets an exhausted, rate-limited or
  unreachable index now retries against that chain's public block explorer.
- **Five of the six chains, and the sixth is named.** Ethereum, Base, Arbitrum,
  Polygon and Optimism all have a public instance. BNB Chain has none, so it is
  the one chain where exhaustion still stops the feature, and the code and the
  error message both say so instead of implying otherwise.
- **Every URL was measured, not assumed.** One page of holders on a
  customer-sized token: Ethereum 0.8s, Optimism 0.6s, Arbitrum 0.9s, Polygon
  6.7s, Base 15.3s. Base has a latency floor near 11s that barely moves with
  page size, so it returns a first page and usually not much more, correctly
  marked truncated.
- **The first measurement was nearly wrong in a way that would have cost two
  chains.** Probing with USDC timed out on Base and Polygon at every page size,
  which reads exactly like a dead explorer. USDC has 12.7M holders on Base. Both
  instances are fine for the size of token a customer actually imports.
- **Background work is not allowed to use it.** The daily budget reserves 80%
  for customers, so the provider can be exhausted while the seed cron's own
  ceiling still shows room. Without an explicit opt-out the cron would have
  quietly moved a day of unasked-for seeding onto free public infrastructure.
- **An explorer that answers 429 is not asked again for five minutes.** Found by
  tripping Base's throttle while testing. Further calls cannot return holders,
  so they only cost the customer a second on the way to the same error.
- **The check runs weekly, because these URLs are not ours.** An instance can
  move or retire an API version with no commit here, so a pull-request gate
  cannot see it. `scripts/check-holder-fallback.ts` exercises the real fallback
  path, and fails if a chain claims a fallback it has no probe for.
- **The security runbook was not missing, it had moved.** Four places still
  pointed at `docs/SECURITY.md` as a local path; it lives in the private ops
  repo and is gitignored here, so anyone following those pointers found nothing.
  They now say where it is.
- **The half of it that is not a secret is now in `CLAUDE.md`.** A table created
  after the role split inherits no grants, and nothing fails until CI reports
  `permission denied for table <name>` on a run that passed locally. Which
  credential lives where stays private; "a new table needs a grant" is a fact
  about the schema and belongs with the schema.

### 2026-08-17 (every surface, not only the ones I had touched)

- **Four surfaces were outside the check.** The README said 4.7M, two versions
  old. The AI assistant was told to say "reachable" in the sense we had just
  retired. The blog held 71 uses of "22%" over 19 posts, a figure removed from
  the structured data the same day because nobody could say where it came from.
  The social media skill said 15-25%.
- **Blog: only the search descriptions were changed.** A dated post saying 22% in
  August is a record of what we believed then, not a claim about today. The
  description is different: it is the text a search engine shows, so it speaks
  in the present. Four were corrected; the body text stays.
- **The check now works in both directions.** It compared each declared figure
  with the database. It now also reads the copy and reports any figure that is
  **not** declared. A registry catches a number that drifts; it cannot catch a
  new number somebody writes tomorrow, which is how "22%" reached 19 posts while
  every declared figure passed.
- **Both directions were tested with wrong input, and both were broken.** The
  new sweep asked "does this file have any declared figure", so one declared
  figure made every other figure in the same file pass. Two false numbers put
  into the README went through. It now works for each match, not each file.
- **A comment is not published text.** The first correct version then reported
  the explanation inside `lib/public-figures.ts` as an undeclared figure, which
  would teach everyone to stop writing explanations. Comments are removed before
  a source file is read.
- The social media skill is outside the repository, so the check cannot see it.
  It now carries the current figures and says plainly that it is checked by a
  person, not by the machine.

### 2026-08-17 (one number, one place, and the claim moved to where people read it)

- **The header said 4.8M, the documents said 4.9M, and a correction earlier the
  same day made 20 files say 5M.** Three numbers for one fact. The header was
  right: `/api/public-stats` counts wallets with at least one identity. The
  correction counted every row, which adds 235,858 records that mean "we checked
  and found nothing". Those are real records and they are not wallets we
  resolved to a person.
- **`lib/public-figures.ts` now holds the figures.** Five comparison pages, the
  share card, the page description, the structured data and the home page all
  read from it. One change moves all of them. Live pages still read the API,
  which is the true source; the file exists because documents and page
  descriptions are built before a request exists.
- **The match rate is a range now, with the measurement behind it.** There is no
  single number: 26 collections, 72,318 holders, three chains, measured against
  our own index with no outside calls. Base 46.2%, Ethereum 16.6%, Robinhood
  Chain 15.6%. Base is about three times Ethereum because Base is where
  Farcaster lives, so the chain moves the result more than the collection does.
  An average would hide that.
- **The old "22% match rate" claim is gone.** Nobody knew where it came from and
  no measurement produced it.
- **The check we look at is on the comparison pages now.** Farcaster stores a
  proved X account as a name, written once, with no account number and no later
  check. Every tool built on those proofs carries the same dead names, and none
  can say which. We resolved all of them: 69.6% work, 20.7% suspended, 9.7% are
  names nobody holds. One component, five pages, and the figures come from the
  same file as everything else.
- **The word "reachable" now means one thing.** It was used for "has an X or
  Farcaster account" in marketing and for "the account still works" in the API.

### 2026-08-17 (a machine for the docs rule)

- **Every number we publish is now checked against the database.**
  `scripts/check-published-figures.ts` holds a list of each published figure: the
  file that holds it, how to read it, and the query that proves it. 11 figures
  are checked today.
- **It runs on a timer, not on a pull request.** The index grows every day, so a
  number that was correct when written becomes wrong with no commit, no
  difference and no pull request. A pull-request check cannot see that. It runs
  every Monday, and also on a pull request that changes the copy.
- **A claim it cannot find is an error, not a note.** If the words change and
  the list is not changed, the check would silently examine fewer things each
  time and report success all the way down.
- **The check was tested with wrong numbers.** The first version had a 5%
  tolerance on an exact count, and a wrong figure of 399,999 for a true 417,872
  passed. A number written to the digit is an exact claim and gets no room.
- **Corrected: the index passed 5 million**, so "4.9 million" was low in 2 doc
  pages and 20 places in the app.

### 2026-08-17 (we check if the X account still works, and we say so)

- **The X names in the index are now checked against X.** 417,872 of them
  resolved. 69.6% work, 20.7% are suspended accounts, and 9.7% are names that
  nobody holds now. About one third of every attested X name reaches no person.
  (This entry said "All 440,700 of them" when it was written on 2026-08-17. That
  was wrong on the day: 440,700 was the number of handles held, not the number
  resolved, and the sweep leaves transport failures unrecorded so they retry.
  Corrected 2026-08-18.)
- **This is a strength, not a fault.** Farcaster records a proved X account as a
  **name**, written one time, with no account number and no later check. So
  nothing in the protocol sees a name change or a suspension. Every product
  built on those proofs carries the same third. We are the only one that looked.
  "The owner proved this, and it still works" is a stronger statement than
  either half.
- **Results table.** A name we checked and found dead is marked, is not a link,
  and says why. It is not a link because a suspended account goes to a notice
  page and a freed name may belong to a different person now, so a click could
  show a stranger as the owner of the wallet.
- **Handle list export leaves the dead ones out.** That file gets pasted into a
  sending tool, so a dead name in it is a wasted send at best. Names we have not
  checked stay in: "not checked" is not "dead". The button says how many were
  left out and why.
- **CSV export gains `twitter_reachable`.** Empty where we did not check.
- **API: `reachable`, `reachability` and `reachability_checked_at`.** Absent, not
  false, when we have not checked. `suspended` and `unclaimed` stay separate
  because only one of them means the record can point at a different person.
- **One builder for the twitter field.** Four routes described the same fact
  three different ways, and one of them did not return `verified` at all.
- **The conflict list can be read.** 2,671 open, of which 1,496 are cases where
  what we serve reaches nobody and the other source works. Before this they were
  saved and unreadable. It shows the evidence and does not decide: a suspension
  can be lifted, and a person can hold two accounts.

### 2026-08-16 (two more attested sources, and one shape for all of them)

- **One set of write rules, three sources.** The rules that decide what reaches
  the graph moved out of the Ethos code into `lib/attested-links.ts`. A source
  now only produces a list of links; it cannot decide how they are written. This
  was extracted, not copied, because the rule was wrong once already: it put a
  source label on 2,479 rows that the source had never attested. Written one time
  for each source, that is one chance to be wrong for each source.
- **Proof that the move changed nothing.** The Ethos sweep was run again after
  the change. Every number is the same: 83,891 links, 0 new, 0 filled, 81,412
  agree, 2,479 conflicts.
- **Onchain attestations: 5,492 new wallets.** Links published on Base and
  Optimism as attestations. Two record types across two chains, read by one
  adapter. 16,509 records give 6,343 links. This is chain data, so there is no
  key, no meter, no rate limit and no supplier who can stop us.
- **86% of them were wallets we had never seen.** The expectation was the
  opposite. These people use crypto and our index already holds 4.7 million
  Farcaster wallets, so we expected a large overlap. There is almost none.
- **Clanker: 163 links in 30 days.** A person tells a bot on X to make a token,
  and the bot writes the account and the wallet into the chain record. Both
  halves are proved by the act. It is a small flow, and it is here because two
  thirds of the records carry the **number** of the X account, which cannot go
  stale the way a name can.
- **The identifier has two shapes, so the shape decides, not the label.** The
  same field holds a number for some records and a name for others, under seven
  different platform labels. A number of five digits or more is an account
  number; anything else is a name.
- **Icebreaker was measured and refused.** Of 1,227 profiles, 84 give a verified
  pair, and 69 of those we already hold. 15 new. The unverified ones are
  self-declared, which is what this product says it does not use.
- **Corrected before release: 3,566 rows were saved and could not be found.**
  The two new sources wrote the X name as the source wrote it, in mixed case.
  The reverse search makes the question lower case and looks for an exact match,
  so those rows were correct, present and impossible to find by name. 56.5% of
  the new rows. The names are now made standard in the one shared place, where no
  new source can forget the step, and the 3,566 rows are corrected.
- **Two smaller faults found at the same time.** When the same wallet and name
  arrived two times, the last one won, which could throw away the account number
  that is the whole reason for the Clanker source. And a record type that failed
  after its first page was counted as read, so a part-finished sweep reported
  success.
- Index now 4,938,576 wallets, 1,149,451 with an X handle.

### 2026-08-16 (a new source, and the first way to see a handle go bad)

- **72,867 more wallets have an X handle.** The count moved from 1,070,680 to
  1,143,547, which is 6.8% more. The graph moved from 4,836,596 wallets to
  4,905,352. The new source is an identity platform where a person proves the
  wallet with a signature and the X account with a sign-in.
- **The source is read once a day, not once for each lookup.** It holds 39,442
  people and 83,891 addresses. That is all of it, in about 80 requests and under
  three minutes. It covers about 0.3% of the wallets in a customer file, so a
  call for each lookup would pay for a wait and change almost nothing.
- **81,412 rows now hold the X account id.** This is the more important part. A
  handle is a name that the owner can change, and a change tells us nothing. An
  account id does not change. This is the first field in the pipeline that can
  show the difference between a new name and a dead account.
- **The id is only written next to a handle that it belongs to.** If we hold a
  different handle, we write no id and we change no handle. To do it the other
  way would make a row that says a specific account owns a name that it does not
  own. That is worse than either source alone.
- **2,479 disagreements are recorded in a new table, not settled in code.** Of
  250 that were examined: our handle no longer opens an account 54% of the time,
  and where both handles open an account, 90% of the time ours belongs to a
  person who does not hold the wallet. A rule in code would throw that away.
- **A new evidence class in the API: `attested-social`.** The owner attested
  both ends, so `aggregated`, which means "correlated, not attested", was not
  correct. The class is named for the method, never for the supplier. The
  published statement "over 99.9% of Twitter matches are owner-attested" stays
  true at 99.98%.
- Published numbers corrected in 20 places: the index is 4.9 million wallets.
- **Corrected before release: the label went on rows it did not belong to.** The
  first version of the write added the source name to every row it touched, and
  not only the rows it agreed with. So a wallet where the new source named a
  different account kept our handle, which is correct, and then took their
  label, which is not. The API showed `attested-social` for 2,479 handles that
  this source never attested. The write now uses the same agreement test for the
  label that it uses for the account id, the 2,479 rows are repaired, and 129
  scores that the label had raised are calculated again with the real function.
- **Two more faults of the same kind, found by following the first.** The live
  lookup path did not know the new source: it gave the source the unknown-source
  score of 5, and it did not accept the source as attested, so the next lookup
  would have quietly removed the verified mark from a handle that nothing had
  disproved. Both are corrected, and the score in the sweep is now the same
  number the live path calculates.
- **The quality number was wrong on 81,325 rows, in both directions.** The write
  raised a score to a floor but could never lower one, so rows written with the
  first, too-high floor kept it. 55,309 rows that said more than they should are
  corrected. Rows that say less than they should are left alone on purpose: a
  swept row that carries a low estimate until a real lookup calculates it is how
  every source here already works, and raising them would move some across the
  trust line, which changes what the product does with them.
- **An address that two people both claim is now dropped.** Postgres refuses to
  change one row two times in one statement, so a repeated address would stop a
  whole batch, after the conflicts for that batch were written. It is also the
  right answer: if two people each say an address is theirs, this source cannot
  say which, so it is not attested evidence.

### 2026-08-16 (colour that no guard was looking at)

- **The share cards and the sign-in email did not use the brand colours.** Both
  render outside the CSS cascade, so they must write colour values directly.
  Eleven of those values had moved away from the tokens they stand for. Only two
  were correct. Every grey had a blue tone in it, but the greys in the design are
  pure grey. This is the mark of a person who took a colour from Tailwind.
- **The blog card wrote eight colours of its own.** It uses the shared card
  colours for the background and the text, then wrote the other eight directly,
  because the shared set had no values for a light card. A shared set with a hole
  in it does not get made larger; it gets avoided. The hole is the fault, and the
  light-card values now close it.
- **Two colours in the shared set were dead.** No card read them.
- **Four Tailwind palette colours were live in the interface.** A green line on
  the growth graph, a green heat map, and two greens in the assistant. Each was
  written as `hsl()`, `rgba()` or a hex value, so the guard, which looks for
  class names, could not see any of them. They are tokens now, and the assistant
  uses the brand colour, because a button is an action and green is for a fact.
- **The "Copied!" message was black on black in the dark theme.** It used
  `bg-black text-white`. The dark background is almost black, so the message had
  no edge. It uses `bg-foreground text-background`, which is correct in both.
- **A new guard: `scripts/check-og-palette.mjs`.** It reads the tokens from
  `app/globals.css` at the time it runs, not from a copy, and it fails the build
  if a card or email colour is not a token value. Values that cannot be a token,
  such as the gradient on the dark card, are listed by name with the reason. The
  guard was tested against the three values that had moved, and it caught all
  three.
- **`lib/` was not in the design CI trigger.** A change to only `lib/og-fonts.ts`
  did not start the check at all, so the fault was invisible two times over.
- **The OKLCH maths moved to `scripts/lib/oklch.mjs`.** Two guards need it. Two
  copies of a colour conversion give two chances to be wrong in a way that looks
  correct.
- Removed five unused Next.js example SVG files.

### 2026-08-16 (the design skill gave instructions that CI rejects)

- **The frontend-design skill now points at `docs/DESIGN-LANGUAGE.md` first.**
  The skill is written for new work with no design system. This project has one,
  and the skill did not mention it. An agent that read the skill and not the
  design language wrote code that looked correct and failed the build.
- **Four raw colour values are gone from the skill.** It named hex values for the
  accent, the border and two text colours. `app/globals.css` holds those values
  as tokens, and an ESLint rule and `design-tokens.yml` both refuse a raw colour.
  The skill now names the token and the meaning, not the value.
- **The radius guidance was wrong in all three of its numbers.** It asked for
  8-12px cards, 6-8px buttons and 4px badges. The scale is 14px containers,
  pill controls and 6px chips. The skill now lists the five named values and says
  which ones CI refuses.
- **A reuse ladder was added before "write a new component".** Five questions,
  stop at the first yes: does it need to exist, does it exist already in
  `components/ui/`, does a token cover it, can it be a prop, and only then write
  something new. It also says what may never be skipped: accessibility, error
  states, input validation, and anything asked for by name.

### 2026-08-16 (a window that moves with the provider)

- **The count of requests is a moving 24 hours now, not a calendar day.** It
  was a box that emptied at midnight UTC. The provider does not empty its box
  at midnight UTC: it stopped our requests at 06:11 UTC and gave answers again
  at 15:55 UTC on the same day.
- **A box that empties at a different moment does not fail safely.** When ours
  empties and theirs does not, we read 0 while theirs is almost full, so the
  background task believes that it has a full day at the moment when there is
  nothing. This is how the stop happened: 7 imports late on one day and 2 early
  on the next were in 1 window of theirs and 2 of ours.
- **A moving total cannot agree with their box either**, because we do not know
  where their box starts. But it is never behind: each request in the last 24
  hours is in the count, wherever they put the line. The fault becomes a small
  amount of extra care, not a hole.
- **The write puts each event in one statement**, so 2 imports at the same time
  cannot lose each other. Old events go away on the next write.
- The Usage panel says "last 24h" now, not "today", because the number does not
  become 0 at midnight.

### 2026-08-16 (the cost of a request, read and not calculated)

- **A holder-page request costs 50 units, not 35.** The answer from the provider
  has a header, `x-request-weight: 50`, so there is no need to estimate this and
  no reason to prefer an estimate to it.
- **The old 35 came from arithmetic on a day total**, and it was 30% low. That
  method can only be as good as the belief that nothing else was in the total,
  and a budget guard must not hold that belief.
- **So the allowance is about 7.9 imports of 10,000 holders each day**, not 11.
  One import costs 101 requests and 5,050 units.
- **The day boundary of the provider is not midnight UTC.** They stopped each
  request at 06:11 UTC and gave answers again at 15:55 UTC on the same day. Our
  count starts again at midnight UTC, so when our day changes and theirs does
  not, we read 0 while they read almost full. This is written down as a known
  limit, because a correct answer needs a 24-hour moving total.

### 2026-08-16 (the meter was not connected)

- **The count of holder-index requests was never written.** The database held no
  record of it, for each import that the product has ever made. The write used
  `void`, which starts the operation and does not wait for it. On a server that
  stays alive, that is correct. Here the code runs in a function that can stop
  the moment it sends its answer, and an operation that nobody waits for is the
  one that stops.
- **So each guard read zero.** The limit for the background task never operated,
  because it compared its work against a count of 0. The Usage panel showed no
  cost. The first sign of the fault was the provider, which stopped each request
  for the remainder of the day.
- **The write waits now.** The cost is one database operation, some tens of
  milliseconds, at the end of an import that used some seconds and made as many
  as 100 requests.
- **A guard that fails open must show that it is open.** This one could not tell
  the difference between "no cost today" and "no information", and gave 0 for
  both.

### 2026-08-15 (a link can carry a contract)

- **`/?contract=0x…&chain=base` opens the importer with the address in place.**
  For Pro and Unlimited only, the same as the importer. A person on the free
  plan gets the upgrade window, which is what the contract card does.
- **The link fills the field. It does not press the button.** To get the holders
  has a cost against a daily allowance, and to arrive on a URL is not a request
  to spend it. The person sees the address and the chain, then decides.
- **The page reads the URL and then removes the parameters**, so a refresh
  cannot do the import again and the address does not stay in the history.
- **It waits for the account to load.** The tier is "free" while the session
  loads, so a person with Pro would have seen a window that offers a thing they
  have.

### 2026-08-15 (you can see the edge of a field now)

- **The line around a text field was almost invisible**: 1.26:1 against the page
  in the light theme and 1.48:1 in the dark theme. The rule is 3:1, because the
  line is the thing that says "this is a control".
- **The same line is on the outline button**, where the edge is the full
  affordance.
- **The 2 values are calculated, not chosen.** Each is above 3:1 against each
  surface that a control sits on.
- **The line for a card or a table does not change.** The rule permits
  decoration to stay quiet, and the thin-line look depends on it.
- **A new test measures each colour pair in both themes.** It reads the tokens
  from the CSS, and it tests its own colour mathematics against measurements
  from a browser first.

### 2026-08-15 (the header fits a telephone)

- **The header went past the edge of each telephone screen.** It needed 606px
  and did not become smaller, because each part had a fixed size and its text
  could not go to a second line.
- **Below 640px, 4 things change**: ".social" goes away, the theme control moves
  to the foot of the page, the chip that says "Free" goes away, and the mark and
  the name become smaller together.
- **A person with Pro or Unlimited keeps the chip at each size**, where it is
  the only thing that says the account is paid.
- The header needs 309px now. On a computer, nothing changes.

### 2026-08-15 (recent wins, on one line)

- **The homepage strip is named "Recent wins" now.** It says "Recent activity",
  but it shows only the lookups with a hit rate above 8%. This filter is
  correct, because the strip is proof for a buyer. But the name made a promise
  of a full record. Of the last 25 lookups, 13 were below the line, so a day
  with 12 lookups looked like a day with none. The filter stays. The word
  changes.
- **The strip keeps to one line at each width.** It asked for 6 cards and used
  `auto-fill`, which makes as many columns as the space permits. At the full
  width that is 5, so card 6 went to a second line alone. The count and the
  columns are together in the code now: 1 card, then 2, then 3, then 5.
- The steps come from a measurement of the card, not from an estimate. Below
  about 177px the text in the card goes to a second line, so 2 cards start only
  at 640px, where each one gets 290px.

### 2026-08-15 (the admin navigation shows all of itself)

- **The 12 destinations in the admin panel now go on more than one line.** They
  were in 2 strips that moved sideways. A sideways scroll bar puts things behind
  a movement that a person does not know is possible, and on a narrow screen it
  hid one half of the panel. The design language does not permit this, and the
  panel broke the rule in the most costly place: its own navigation.
- **The buttons make a grid: 2, 3 or 6 across.** The count of 6 is the same as
  the tiles below them, so the 2 parts make one rhythm.
- **A screen reader gets a name for each group and the current position.** Each
  group is a `nav` with a name, so a person can move past 12 controls. The
  button for the open page says `aria-current`. Before, only the violet colour
  said it.
- The 12 buttons were written out one at a time in the page. They are one list
  in `AdminNav` now, with the group titles in the standard label component.

### 2026-08-15 (the dialog footer holds, and selected text has one colour)

- **`ModalFooter` holds its position now.** No dialog used it, and that was the
  sign. It was inside the part that moves, so it held nothing. **A part that
  nobody uses usually does not do the thing that its name says.**
- **It is a property of `ModalContent`, not a child.** A child cannot go out of
  the box that it is in. The property puts the row below the body, with a line
  above it, so that you see it is separate from the text that moved up behind
  it.
- **The contract import preview uses it.** That step is tall: a chain selector,
  a count of holders, a warning about a limit and an example of the addresses.
  Its 2 buttons are the reason for the step, so they stay below the movement.
  The 2 other steps are short and use no footer, because a footer takes space
  from the screens that have the least.
- **Selected text is one colour on each surface.** Before, it was the colour of
  the operating system everywhere, but the brand colour inside an input. So the
  product had 2 colours for one thing, and the one that did not agree was the
  only one that a person chose.
- The rule uses the light brand colour, not the full brand colour. A selection
  covers a full paragraph, and a strong violet behind the words fights the words
  that it must show.

### 2026-08-15 (a keyboard can reach the cards, and the trend lines are back)

- **The 6 cards on the admin Pulse page work with a keyboard now.** Each card
  had a click function on the `div` and nothing more: no role, no stop for the
  Tab key, no Enter and no Space. They looked like controls, because they had a
  pointer and a border that changes on hover. A keyboard could not reach any of
  them. **A hover state is not a control if only a mouse can find it.**
- **The correction uses a real button.** `CardActivator` puts a `<button>` over
  the full card. A real button gives the focus, the Enter key, the Space key
  and the accessibility tree together. A `role` attribute with a key function
  gives only the parts that you remember.
- **The sparkline trend lines show again.** Two of them used the colour
  `hsl(var(--primary))`. But each token in this product is an `oklch` colour,
  so this makes `hsl(oklch(...))`, which is not a colour. The browser removes
  it and gives no message. A measurement in Chrome shows the result: the line
  colour became `none`, so the line was not drawn, and the area colour became
  black. **An incorrect colour is easy to see. A colour that is removed looks
  like a design.**
- **A new test refuses `hsl(var(--...))` and `rgb(var(--...))`.** It found the
  fault immediately in a real file.

### 2026-08-15 (each dialog keeps its contents now)

- **The upgrade modal no longer puts its two buttons below the panel.** The
  change on 2026-08-15 that was to correct this did only one half of the
  operation, and the fault stayed. A dialog was a grid. Its body received
  `min-h-0`, which lets the box become smaller. But the row of the grid stays
  at `auto`, which is the size of the contents. So the row became larger than
  the dialog, the body filled the row, and `overflow-y-auto` never received a
  box that was too small. Thus it did not cut the contents and it did not show
  a scroll bar.
- **A dialog is a flex column now.** The body is `flex-1 min-h-0
overflow-y-auto`. A measurement in Chrome shows the difference at a screen of
  663px: before, the panel was 631px and the body was 1298px, with the button
  644px below the edge of the panel. After, the body is 629px and the button is
  25px inside the panel.
- **All 6 dialogs had this fault**, not only the upgrade modal. Each one is
  correct now.
- **The 2 upgrade buttons stay on the screen.** Each card holds its own button,
  so one bar at the bottom is not possible. The card is the column: the list of
  features moves, and the button stays at the bottom edge. On a telephone the
  cards go one above the other and the dialog moves as before.
- **A dialog uses `100dvh`, not `100vh`.** On a telephone, `vh` is the largest
  size that the screen becomes. A dialog with this measurement goes behind the
  address bar exactly when the address bar is on the screen.

### 2026-08-15 (the generator now makes the correct thing)

- **The component generator makes Phosphor icons now.** `components.json` told
  `npx shadcn add` to use Lucide. This is not the icon set of this product, and
  it is the machine that put back the defaults that the last change removed.
  The value is `phosphor`, which the shadcn source shows is correct and which
  points to the package that this project already has.
- **The `lucide-react` package is removed.** No file imported it. A second icon
  set that nobody imports is still a second icon set that a person can find.
- **A new test refuses a Lucide import**, so the failure gives the reason in one
  line.
- **The design language has a new page: "Adding a shadcn component".** A
  generated component compiles, shows correctly and is incorrect. It has the
  radius, the shadow, the control height and the colour words of the library.
  The page gives the 6 steps to correct it. It also gives the rule for a
  component that already exists: make a new option on the component that you
  have; do not make a second file.
- Note: `baseColor` has no correct value. Each value makes the same `--primary`
  colour, because the components use it. So the test looks at the result
  instead. **Set the generator where you can. Test the result where you cannot.**

### 2026-08-15 (the library defaults that stayed behind)

- **Drag a file onto the page, and the target is violet again.** It was black.
  `--primary` is a shadcn default that this project never changed. It is almost
  black in the light theme and almost white in the dark theme, and its name
  makes it look like a brand token, so it moved through the product without a
  challenge. Both drop targets used it. One of them showed a violet edge at
  rest and a black edge during the drag, which is the same component with two
  colour systems in it.
- **The same default is now removed from six more places**: the period control
  and the stage bars in the admin dashboard, six cards that you can click, the
  text selection colour in each input, and the unused `Progress` part.
- **The period control in the admin dashboard is now the standard segmented
  control.** It was the third control of this type that somebody built by hand.
  It was 2px shorter than the button beside it, the arrow keys did nothing, and
  the selection moved without an animation.
- **Each card shows its edge again.** The `Card` part drew its hairline at 60%
  opacity. In the dark theme the border token is already 10% white, so 60% of it
  is 6% white. Six more faded edges are also at full opacity now.
- **Two hand-made text links are now the standard button.** The `link` type
  already existed, but no code used it, because its 34px height opens up a table
  row. It has an `inline` size now, so the height is not a reason to copy the
  classes a third time.
- **Two new tests keep all of this out.** `check-design-language.mjs` refuses
  the `primary` token and a faded hairline. Both tests have fixtures, and both
  found real faults on the first run: the six faded edges and one more incorrect
  hover colour that a manual search did not see.

### 2026-08-15 (a usage meter, and a page for each account)

- **A new Usage panel measures daily volume. It does not limit it.** No plan has
  a daily allowance, and this makes none. It exists so that a decision about a
  limit uses the behaviour that we see, and not a number that seems correct.
  - It reads in wallets, never in lookups. Eleven lookups of 200 wallets and
    eleven lookups of 10,000 wallets are both “eleven”, and only one of them is
    a problem. The worker learned this when it counted jobs.
  - The most important column is the busiest single day of each account. A limit
    is only reached on a busy day, so a limit below the highest day of an
    account has already refused a customer one time.
  - It also shows the money that this volume costs: the credits for this month
    and the requests for today, from the same counters that the guards read. So
    the panel and the limits cannot disagree.
- **Each account now has a page.** Click an address in the Usage panel or in the
  Users table. The page gives:
  - The money paid, from Stripe, with each refund. A paid tier with no payment
    gets the label “gifted, not paid”, because a tier is a permission and not a
    receipt.
  - Volume: the total for the life of the account, the busiest day, the days
    with activity, and a graph for each day.
  - The last 25 lookups, with the method, the network, the contract and the scan
    depth of each one.
  - The count of saved lookups and of API keys.
- **The page replaces the panel, and does not sit above it.** Two subjects on
  one screen make the reader decide which numbers belong to which.

### 2026-08-15 (a daily budget for the token holder index)

- **A customer used 75% of the daily allowance in two hours.** The ERC-20
  holder index has a daily limit. On this day a paying customer made 11 contract
  imports, and 7 of them had the maximum of 10,000 wallets, on Ethereum and BNB
  Chain. That is approximately 810 requests. The daily seed cron made
  approximately 71 requests in the same period, which is 8% of the total. So the
  cron is not the cause. A customer who uses the product is the cause.
- **When the allowance stops, each ERC-20 import stops.** This applies to
  Ethereum, Base, Arbitrum, Polygon, Optimism and BNB Chain together. NFT import
  is not affected, because it uses a different supplier. Robinhood Chain is not
  affected, because it uses its own explorer.
- **The message said “try again in a moment”.** That is the message for a rate
  limit. A daily allowance comes back tomorrow, not in a moment, so the customer
  makes the same request again and it fails again. The message now says that the
  limit comes back tomorrow, and it says which other methods still work. The
  test reads the body of the response, not the status, because the status is
  401 in some cases and 429 in others.
- **`lib/holder-index-budget.ts` gives the cron a limit.** It follows the same
  rule as the Neynar budget: measure each request, but stop background work
  only. A customer is never refused.
  - 80% of each day is held for customer imports. The cron gets the other 20%,
    which is approximately 228 requests. Six ERC-20 seeds need approximately
    126, so a normal day is not affected. The cron also runs at 07:00 UTC,
    before the customers of the day.
  - The cron measures its limit against the total for the day, not against its
    own total. If it measured only its own use, a busy morning would let the
    cron start with a full limit.
  - The count is in requests, because we can count each request exactly. The
    limit is in compute units, and the supplier gives no price for each
    endpoint. The number 35 units for each request comes from measurement of
    this day: approximately 880 requests used approximately 30,000 units. Two
    environment variables can correct it without new code.
  - If the count cannot be read, the guard permits the work. It exists to stop
    high cost, and to stop each cron because of one failed query would make a
    worse problem.

### 2026-08-15 (a modal that spilled, and controls that did not look like controls)

- **The upgrade modal put its last button below its own edge.** The dialog has a
  maximum height, and the content in it has `overflow-y-auto`. But the content
  is a grid item, and a grid item does not become smaller than its content
  unless you tell it to. So the maximum height did nothing, no scroll bar came,
  and the content went past the bottom of the white panel. “Upgrade to
  Unlimited” was below the edge, and a person could not press it. One property
  corrects it: `min-h-0`. Each modal in the product had this fault. Only the
  upgrade modal was tall enough to show it.
- **The two plan columns now have the same height, and their buttons align.**
  Unlimited has more features than Pro, so the two buttons were at different
  heights.
- **The segmented controls now look like buttons.** The method is from iOS,
  because iOS solved this first:
  - The moving part has two shadows. A wide soft shadow lifts it off the track.
    A narrow dark shadow below it draws the bottom edge. One shadow alone looks
    flat.
  - The unselected side is no longer grey. Grey is the colour of text that you
    cannot use, so the control said that half of itself was not available.
  - A hairline divides the segments, and it disappears on each side of the
    selected segment. The line says “these are separate buttons”. Its absence
    beside the selection keeps the control one object.
- **The colour toggle: System is now in the middle.** The order is Light,
  System, Dark. System is the default, and it is the middle of what the other
  two mean.
- **The colour toggle icons now use one weight.** The selected icon changed to
  the filled weight, which the design language keeps for status dots. At 16 px
  it makes the Monitor icon a solid block beside a line-drawn sun and moon. The
  moving part and the colour already show the selection.
- **Two buttons got an icon.** “Find wallets” has a wallet. “Sign in” in the My
  lookups panel has the same icon as “Sign in” in the header.

### 2026-08-15 (a price we do not sell, a term we never defined, and a feature that moves tier)

- **Five comparison pages showed $149.** Pro is $99. The number was written into
  each page, and it stayed after the price changed. A person who read a
  comparison page got a price that no plan has. Each page now reads the price
  from `TIER_PRICES`, which the checkout also reads, so the two cannot disagree
  again. The tables that said “$99 - $249” were correct, and they now read the
  same constant.
- **The social-media skill also said $149.** That file writes future posts, so
  it made new copy with the incorrect price. It is corrected, and it now has an
  instruction to read the constant before each draft.
- **“The index” had no definition.** Eight documentation pages use the term.
  None of them said what it is. The documentation home page now gives the
  definition first: the index is our own database of 4.7 million wallet
  identities, not a cache in front of the API of another company. Each later use
  links to that definition.
- **Growth of a saved lookup is now an Unlimited feature.** This has two parts,
  and both move together:
  - Add addresses to a saved lookup.
  - See which rows found an identity since you last opened it, which the `NEW`
    label shows.
  - The server enforces both. The `PATCH` that writes the joined result and the
    `GET` that calculates the new rows each examine the plan. A control that is
    only hidden is not a limit.
  - A change of name stays available to each owner of a lookup, because Pro
    includes full history, and a history that you cannot label is worse for no
    reason.
  - The gate on `GET` also stops the query, not only the answer. That query
    examines each wallet in the lookup, and it is the most expensive operation
    on the endpoint.

### 2026-08-15 (the same correction, applied to each surface that gives it)

The previous entry corrected the X-coverage statement in the documentation, the
structured data and the comparison pages. It did not examine the other places
that give the same statement. This entry corrects those, and it found a second
and more serious fault.

- **The published blog gave the names of two data suppliers, and it gave the
  order of the pipeline.** The rule is to give no supplier name in a public
  place. Five published posts broke it, in the first person: “we use X”, “Via
  the X API, we check…”, and a numbered list of the three steps in order. The
  API deliberately does not give this information: `lib/api-sources.ts` maps
  each internal name to a class of evidence, so that a customer cannot read the
  supply chain from a response. The blog gave it in words instead.
  - `farcaster-integration.md`: “We’ve integrated the X API”, and a 3-step list
    that named a supplier for each step.
  - `walletlink-vs-addressable.md`: a list with the title “walletlink.social
    uses”, which named two suppliers.
  - `farcaster-verified-addresses.md`: “(we use X)”, and a sentence that named
    a supplier.
  - `twenty-two-percent-match-rate.md`: two sentences that named a supplier.
  - `docs/SEO-STRATEGY.md`: three answers written for a customer, each of which
    named a supplier. This document supplies the words for future copy, so each
    error in it makes more errors later.
  - Each is now written as a class of evidence: an onchain record, a
    protocol-level verification, an identity index.
- **One post keeps the supplier names, and this is correct.**
  `wallet-identity-stack.md` explains the identity ecosystem to a reader who is
  building their own system. It names the products that exist in that ecosystem,
  which is the subject of the post. Only one sentence tied that architecture to
  ours, and that sentence is changed.
- **`README.md` said “owner-attested only”.** The same absolute as the
  documentation. The README is the first page a person sees in a public
  repository, and `docs/README.md` says that the repository is public so that
  this claim is checkable. So the README must be exact.
- **`docs/SEO-STRATEGY.md` now gives the rule for future copy.** Do not write
  “owner-attested only”. Write “over 99.9% are owner-attested, and each match
  carries its evidence”. It is stronger, a person can check it, and it stays
  correct when we add a source.

### 2026-08-15 (say what the X coverage really is, in a way that stays true)

- **The coverage page said “one of two routes”. The code has more.** It said
  that each X handle comes from a Farcaster verification or from an ENS text
  record. The pipeline also uses an identity index, which gives the `aggregated`
  class. The measurement: 1,070,576 wallets have an X handle. 1,039,525 come
  from a Farcaster verification and 39,906 from an onchain record or a manual
  review. Only 201 come from the identity index alone. So the statement was
  99.98% correct, and it was still not accurate.
- **The page now gives the rule, not the count of the sources.** Two routes are
  owner-attested and give almost all the coverage. An identity index gives the
  rest, and each of those records has the `aggregated` label. The promise to the
  customer is that each match carries its class of evidence, and that the
  classes do not change when we add a source. That statement stays correct as
  the number of sources increases.
- **The guarantee is enforced, and the page says so.** The classification is an
  allowlist. A new source with no classification gives no evidence class. It
  cannot get the classification of a different route. So a new pipeline cannot
  make `onchain` or `farcaster` mean something wider than it means today.
- **The same statement was in the structured data and on four comparison
  pages.** One said we return “only” owner-attested matches. One said the
  matches come from onchain records, when most come from a Farcaster
  verification. All are corrected. “We never guess” stays, because it is true at
  each evidence level: an identity index correlates published profile data, and
  it does not infer from a display name, a description or a time correlation.

### 2026-08-15 (a control that painted itself out, and two missing doc pages)

- **The scan-depth control was invisible on the upload panel.** Its track uses
  the `muted` colour. The panel uses the same colour. So the control had no
  edge: the unselected half showed only its text, and the selected half looked
  like a white shape with no relation to it. The control now has a hairline
  border, which is the rule that the design language already gives for
  separation. The correction is in the component, not in the page, because the
  next `muted` surface would cause the same fault.
- **Checkboxes used the colour of the operating system.** A checkbox with no
  style shows its tick in the accent colour of the operating system, which is
  blue on macOS. Blue is not in this product’s palette. All checkboxes and radio
  buttons now use the brand colour.
- **The design language now gives a rule for this fault.** A control must show
  its own edge. Examine each control on the page background, on the muted
  background and in a card. If one of the three makes it disappear, it needs a
  hairline border. No test can find this fault: the CSS is correct, each guard
  gives a pass, and the control is not visible.
- **Two new documentation pages.** “Running a lookup” gives the three ways to
  supply addresses, the networks for a contract import, the address limit for
  each plan, and the export formats. “Scan depth” gives the difference between a
  fast scan and a deep scan, and it says that the API always behaves as a fast
  scan.
- **A code comment named 2 networks where the code supports 7.** The comment in
  `lib/chains.ts` for token holder lists was written when two indexes were in
  use. Comments become incorrect in the same way as documentation.

### 2026-08-15 (a health report for the social graph, and a weekly repair)

The graph holds 4,755,201 rows. 99.5% of them have a reachable identity. The
`wallet` column is the primary key, so the table cannot hold a duplicate row.
There were no duplicate identities either: no handle was stored under two
casings, no wallet address had capitals, and no field held an empty string. The
faults were 63,275 rows, which is 1.3% of the table.

- **`scripts/graph-audit.ts` gives a read-only health report.** It counts
  malformed values, duplicate identity, rows that disagree with themselves, and
  the freshness of the data. It makes no change. Use it before a repair, and to
  find a new type of fault.
- **`lib/graph-repair.ts` corrects only what the row itself proves.** These
  faults were found and corrected:
  - 1,113 rows said `twitter_verified` but had no handle.
  - 34,189 rows had a `twitter.com` link. The Farcaster sweep writes `x.com`,
    and the ENS harvest wrote `twitter.com`. All links now use `x.com`.
  - 27,970 rows had a “first seen” time after their “last updated” time. A row
    cannot get an update before it exists.
  - 1 row had a handle with capitals, 1 had an ENS name with capitals, and 1 had
    a link that pointed to a different account.
- **Two writers made these faults. Both are corrected.** The negative-result
  writer gave a JavaScript time to one column and let the database supply the
  other. The database time is later, so each new negative row got a “first seen”
  time after its “last updated” time. The ENS harvest wrote the old domain name.
  Without these two corrections, the repair would find the same rows each week.
- **The repair runs each Monday at 09:00 UTC.** It has these guards:
  - It contains no `DELETE` statement.
  - Each repair has a row ceiling and stops above it. A repair that suddenly
    finds many more rows than usual has a fault in its own test, so it must stop
    and report.
  - A dry run is the default. You must give `--apply` to write.
  - It never changes the primary key.
  - It counts the rows again after the write, to prove that the repair did the
    work. If rows still agree with the test, it reports the difference.
- **Three problems need an answer from an external source, so the repair does
  not touch them:** 3 ENS names that are on more than one wallet, 6 Farcaster
  ids that carry more than one username, and 112 Farcaster usernames that have
  no id. The cron counts them and reports them.

### 2026-08-15 (one scan-depth control, in place of two checkboxes)

- **The options row asked the wrong questions.** It gave four checkboxes in one
  line: Save to history, ENS onchain lookup, Fast mode and Notify when done. Two
  of them named parts of the pipeline. Those two also disagreed with each other.
  Fast mode removed the slow sources. ENS is the slowest source. A person who
  selected both asked for two opposite things. The panel now asks two questions,
  each with its own label:
  - How deep do you want the scan? Fast, or Deep scan.
  - Do you want to keep this lookup? If yes, what is its name?
- **Fast now does what its name says.** A fast scan reads the walletlink index
  and the cache. It makes no live request, and it writes nothing back. Before
  this change it skipped one live source and called another, so it was neither
  quick nor complete, and one line of text could not describe it. The Farcaster
  sweep is complete, so the index already holds almost all of the data that the
  remaining call supplied.
- **Deep scan is the default, and it includes onchain ENS.** An ENS text record
  is the only source where the owner of the wallet publishes the handle. That
  evidence is what makes a row attested instead of inferred, and the product is
  sold on that difference. ENS was off by default before. ENS stays a paid
  feature; a free account gets every other source.
- **The time estimate follows the choice.** A deep scan calculates 18 seconds
  for each 1,000 wallets: 10 seconds for the live sources, and 8 seconds for the
  onchain ENS records. A fast scan calculates 5 seconds for each 5,000 wallets,
  because two indexed queries do not get much slower as the list gets longer.
  The estimate for a deep scan is now approximately twice the old number. The
  old number did not include ENS.
- **The two buttons have icons.** “Choose different file” has a swap icon.
  “Start lookup” has a magnifying glass.
- **A fast scan gave an empty row for a wallet that the index knows.** Step 1
  applies a stored row only when its quality is high and fresh, or medium. A
  high-quality row one day past its refresh window went to the live sources
  instead, because the live answer must not lose to the old one. A fast scan has
  no live pass, so those wallets came back empty. A fast scan now takes what is
  stored. The other modes do not change.
- **The cache step erased data that the index had found.** It merged the cached
  row with a spread. Each field of a cached row is present, and an empty field
  holds `undefined`, so the spread wrote `undefined` over a value from the
  index. A wallet with a Farcaster name in the index and a Twitter-only cache
  row lost its Farcaster name. The cache now supplies only the fields that it
  has.
- **Two contract imports in one visit recorded the first contract twice.** The
  start-lookup callback did not list the contract in its dependencies. Each
  setter that changes the contract also sets the input source, so the callback
  usually refreshed. Two contract imports in sequence set the input source to
  the same value, React stops an update that changes nothing, and the callback
  kept the first contract. The admin Source column then gave the wrong name for
  the second lookup.
- **A fast scan wrote index rows back to the index.** The write resets the
  “checked at” and “stale at” times. A fast scan makes no live request, so it
  put a new time on data that no source had confirmed. A later deep scan then
  trusted that time and did not call the sources. One fast scan stopped the next
  correct scan for the full trust interval. A fast scan now writes nothing.
- **The progress bar marked the ENS stage complete for a free account.** A job
  that cannot use ENS goes directly to the next stage. The stage list still
  included ENS, so the position moved one place too far, and a paid stage showed
  as complete. The list now includes only the stages that the job runs.
- **The progress bar showed the name of a data supplier.** The rule is to give
  no supplier name in the interface. That stage is now “Profiles”. ENS and
  Farcaster are protocols, not suppliers, so they keep their names. The stage
  list also had the wrong order and did not include the index read that starts
  each job. The list controls which dots are complete, so the order was
  incorrect on the screen. A fast scan now shows only the two stages that it
  runs.

### 2026-08-15 (job context in the admin panel, and two faults it exposed)

- **The Jobs table showed a localStorage uuid in the User column.** A signed-in
  job stores the `users.id`, so it joins to a real address. The table did not
  join, so it printed a raw uuid for the only paying customer on the platform.
  The column now shows the email. It shows "anonymous" for a visitor who never
  signed in, and "system" for a cron job.
- **A new Source column names what was looked up.** A contract import now
  records the contract on the job, so the table says "USDG ethereum" instead of
  only "5,000 wallets". Without it, a 1.6% match rate had no explanation. Jobs
  created before this change have no contract recorded and show how the wallets
  arrived.
- **`truncated` could never be true when the source did not report a total.**
  Three holder sources replaced an unknown total with the number of wallets they
  returned. The flag compares those two values, so it always calculated
  `5000 < 5000` and said the list was complete. A USDG import of 5,000 holders
  told the buyer it held every holder. An unknown total now stays unknown, and a
  result that exactly fills the limit is reported as truncated. The import
  preview no longer prints "N of N total holders" for an unknown total, because
  that still reads as a complete list. It says the import hit its maximum and
  that the token probably has more holders.
- **The worker admitted five jobs at once, whatever their size.** On 2026-08-13
  the seed cron queued five 2,000-wallet jobs and the worker took all five, so
  10,000 wallets hit Web3Bio together. Web3Bio answered 500 to about 1,200
  requests in each batch, and average latency went from about 20 seconds to 3.5
  minutes. The worker now budgets by wallets in flight, not by job count. Small
  jobs still run together. Large jobs run one at a time. It also admits a job
  that is already in progress before it starts a new one, because a budget plus
  the old queue order would let large cron jobs spend the whole budget each tick
  and leave a customer's half-finished lookup waiting.

The graph was not damaged by that incident. The guard in `job-processor.ts`
excluded every wallet whose check failed, so 5,432 wallets kept no row instead
of a false "no socials" row.

### 2026-08-15 (Stripe made no Customer objects)

- `createCheckoutSession` did not set `customer_creation`. The default value is
  `if_required`. A one-time card payment does not require a Customer, so Stripe
  made none. The account held **zero Customer objects**, and it had real
  completed sales. `customer_email` fills the field in the form. It does not
  make a Customer. Every payment therefore stored an empty `stripe_customer_id`,
  and the admin Users pane showed a dash in the Stripe column for each paying
  account. The value is now `always`.
- The Users pane shows the payment intent when no Customer exists. Sales from
  before this change have no Customer. The payment intent identifies the sale in
  Stripe. `/api/admin/users` now returns `stripePaymentId` for this purpose.
- The checkout reuses the Customer when Stripe already has one for that email.
  `customer_creation: 'always'` alone makes a new Customer for each checkout. A
  buyer who upgrades from Pro to Unlimited would get a second Customer. The
  second id would replace the first, and the first would become an orphan. That
  result is the opposite of one identity for one buyer.
- The checkout changes the email to lower case one time. It uses that form for
  the Customer lookup, for `customer_email`, and for both metadata blocks.
  Stripe matches its email filter by case. Every other path uses lower case. A
  buyer who typed a different capitalization on a second purchase would miss the
  Customer and make a duplicate.
- The code no longer writes `''` to `stripe_customer_id`. The callers read the
  value from `session.customer`, which is null when no Customer exists. An empty
  string in an id column says "there is an id, and it is blank".

### 2026-08-15 (the apex domain is canonical)

- Vercel now serves `walletlink.social` directly. It sends a 308 redirect from
  `www` to the apex. The configuration was the opposite before this change,
  while `metadataBase`, `sitemap.ts`, `robots.ts` and each canonical tag
  declared the apex. Each of them published a URL that redirected.
- This difference caused two separate failures. Stripe does not follow a
  redirect, so the webhook pointed at the host that redirected. Every delivery
  failed from 2026-01-17, and no payment gave an account its tier. The X card
  crawler met the same redirect on `og:image`, so it kept an old card.
- `PRODUCTION_URL` now holds the apex. The resolver in `lib/site-url.ts` and the
  SEO declarations state the same origin. No `www` literal remains in the code.
- The Stripe webhook endpoint now points at the apex. The apex answers directly.

**The rule to keep:** a URL that one machine gives to another machine must never
point at a redirect. Declare one origin only.

### 2026-08-15 (the Starter tier is removed)

- Jake retired Starter on 2026-08-12. It stayed in 42 places across 12 files. A
  comment defended it and said that legacy accounts needed it. No legacy account
  existed. **No user ever held the tier, and Stripe took no payment for it.** I
  checked production before I removed anything.
- I removed it from `UserTier`, from the price map, from the limit map, from the
  tier ladder, from the checkout, from the webhook, from the upgrade modal, from
  the account chip and from the analytics types. The new type `PaidTier` names
  the tiers that a person can buy. The signatures no longer write the union out
  four times.
- **The cumulative quota machinery went with it.** `TIER_QUOTA`, `walletQuota`
  and `walletsRemaining` existed only because Starter had a total cap of 10,000
  wallets. Each remaining tier has a per-lookup limit and nothing more.
  `walletsUsed` still counts up. It controls nothing now. It is a lifetime
  record, and an upgrade no longer sets it back to zero.
- `getUserAccess` sends `users.tier` through the new `normalizeTier()`. It no
  longer casts the value. The column holds free text. An unknown value used to
  index the limit map to `undefined`, which gave a broken lookup and no error.

### 2026-08-15 (the share text gave a match rate that was too high)

- The share copy calculated the match rate as
  `(twitterCount + farcasterCount) / totalWallets`. That formula counts a person
  two times if the person has an X handle and a Farcaster account. One real
  lookup of 1,057 wallets published **49%**. The product showed **30.8%** for
  the same lookup, because the formula counted 190 people two times. The copy
  now uses the distinct reachable count. The results header uses the same count.
  The page gives the count to the component from one predicate, so the two
  figures cannot differ.
- `StatsCards` had the same overlap error, and it was corrected earlier. The
  error stayed in `ShareButtons`, because that component calculates its own
  statistics instead of receiving them.

### 2026-08-15 (checkout provisioning, after a customer paid two times and got nothing)

Two separate faults occurred together. Each fault alone was survivable. Together
they took $198 from the first paying customer and gave the customer nothing.

- **The webhook never worked.** Stripe held the endpoint
  `https://walletlink.social/api/webhook`, which is the apex. Vercel served the
  project from `www`, and the apex sent a 307 redirect. Stripe does not follow a
  redirect. It records a 3xx as a failed delivery. Every payment after the
  endpoint was created on 2026-01-17 succeeded in Stripe and gave no account its
  tier. The endpoint now points at the `www` origin.
- **Production never had `NEXT_PUBLIC_URL`.** `createCheckoutSession` used the
  fallback `http://localhost:3000` and built `success_url` from it. After
  payment, Stripe sent the buyer to a dead port on the buyer's own machine. The
  buyer decided that the payment failed, and paid a second time. The new file
  `lib/site-url.ts` resolves the URL in one place. It uses the env var first,
  then the known production origin, then the preview URL, then localhost. It
  uses localhost only when the code does not run on a deployment. Production can
  no longer reach a localhost fallback.
- **`/api/auth/checkout-status` now gives the upgrade.** It only reported the
  tier before. It already asked Stripe, and it already knew that
  `payment_status === 'paid'`. If it had acted on that fact, no customer would
  have seen the webhook failure.
- **One function gives entitlement.** `provisionPaidCheckout()` is idempotent on
  the payment intent, and it records the sale itself. A grant cannot happen
  without a revenue record. Two paths can run at the same time and cannot count
  the sale two times.
- `payment_completed` was a floating promise, and a serverless runtime can
  discard it. The `payment_intent.succeeded` path recorded no sale at all. Both
  are corrected.
- A missing key or a missing webhook secret no longer reports "signature
  verification failed". A configuration error has its own type and answers 500.
  Stripe then retries the event instead of discarding it.
- **The dashboard reads revenue from Stripe, and it subtracts refunds.** It used
  to read the tier of each user. It mapped `pro` to $99 and `unlimited` to $249.
  That figure is entitlement, not income. It invented revenue for a
  complimentary account, and it could not see a refund. One $99 sale, one
  refunded $99 duplicate and one goodwill upgrade gave a report of $249. The
  true net was $99. The new route is `/api/admin/revenue`.
- The dashboard reports an account as complimentary when the account holds more
  than it paid for. This includes the partial case: a person bought Pro and
  received Unlimited. A check on the email alone would still have implied $249.
- `isStripeConfigured()` no longer needs `STRIPE_PRICE_STARTER`. Jake retired
  Starter on 2026-08-12, and the checkout rejects it. The old check meant that
  deletion of a dead env var would answer 503 to every purchase.

### 2026-08-14 (AI assistant on the marketing site)

- Floating chat bubble backed by Cloudflare AI Search over both
  `docs.walletlink.social` (13 pages) and the marketing site (33 pages).
  New `components/DocsChat.tsx`, mounted in the root layout, hidden on
  `/admin` and `/success`, loaded `lazyOnload` so 115 KB stays off the
  critical path.
- Everything is served from `help.walletlink.social`, a **proxied** CNAME, so
  queries and the widget bundle both pass through our zone. The public
  endpoint is unauthenticated and spends Workers AI neurons per answer, so the
  zone is where that spend is bounded: 8 req/10s per IP at the WAF, 20 req/60s
  at the endpoint.
- A system prompt enforces the two rules the corpus cannot: never name a data
  provider, and never merge "~23% has an identity" with "~13% is reachable".
  Both verified against the live endpoint. See `docs/AI-SEARCH.md`.

### 2026-08-14 (public docs site + API source-leak fix)

**`sources` no longer leaks the data supply chain**

- `/v1/wallet`, `/v1/batch` and both `/v1/reverse` endpoints returned the raw
  `social_graph.sources` array, which contains literal vendor names. New
  `lib/api-sources.ts` maps them to evidence classes (`onchain`, `farcaster`,
  `manual`, `aggregated`) on an **allowlist**, so an unmapped internal source is
  dropped rather than published. Breaking change to those response bodies.

**Docs site**

- New `docs-site/` holding the Mintlify content for docs.walletlink.social:
  13 pages covering the concepts and a full `/v1` API reference, written
  against the route handlers rather than against this README.
- `docs-site/` is the _only_ publishable folder. `docs/` stays internal, since
  `docs/SECURITY.md` is the backup and restore runbook.
- Freshness is enforced, not requested: `.github/pull_request_template.md` asks
  for an explicit docs decision and `.github/workflows/docs-freshness.yml`
  fails any PR that changes the public API surface without touching
  `docs-site/` (escape hatch: the `no-docs-needed` label).
- Corrected the Public API section above: those plans are tier benefits, not
  monthly subscriptions.

### 2026-08-12 (daily collection seed cron)

**Top/trending collections and tokens → holder lists → the graph**

- New `lib/seed-collections.ts` + `/api/cron/seed-collections` (07:00 UTC):
  one NFT collection per chain (Ethereum, Base, Robinhood Chain) and one
  trending token on Ethereum + Base per day, holders capped at 2,000 per
  contract, queued through the normal lookup pipeline as visible
  `seed_cron` jobs — Recent Activity now shows real collections with real
  match stats.
- Discovery: OpenSea top+trending (uses `OPENSEA_API_KEY`, or auto-provisions
  a temp key — capped at 2/day, so treat it as best-effort);
  GeckoTerminal trending pools (keyless); Blockscout holders-ranked list as
  the keyless Robinhood fallback. Denylists filter infra tokens (WETH/USDC…)
  and infra NFTs (Uniswap positions et al.) whose holder lists aren't
  audiences.
- Selection is novelty-aware via the new `seeded_contracts` table (30-day
  re-seed window), so the cron works down the rankings instead of re-buying
  the top 10.
- New `wallet_holdings` table records wallet ↔ contract edges at seed time —
  the audience-graph data ("holders of X") that social resolution alone
  can't provide. Migration: `scripts/migrate-seed-tables.ts` (applied).

### 2026-08-12 (ENS text-record harvest)

**Onchain com.twitter / com.github records → social_graph**

- New `lib/ens-harvest.ts`: scans mainnet TextChanged logs (both the 3-arg
  pre-2023 and 4-arg 2023+ signatures, topic-filtered to the two keys, any
  resolver), then resolves each node's CURRENT values fully onchain —
  registry → resolver → `text()`/`addr()` via Multicall3. No subgraph, no
  third-party indexer, no node→name healing needed: `text()` works on node
  hashes directly.
- These are the highest-quality Twitter edges that exist (the wallet owner
  set the handle onchain themselves): source `ens_onchain`,
  `twitter_verified`, quality 50 — below the 70 trust line because the
  Farcaster side was never checked. Fill-only upserts: never overwrite an
  existing handle; `last_updated_at` moves only when something was filled.
- Checkpointed in the new `ingest_state` table
  (`scripts/migrate-ingest-state.ts`, applied 2026-08-12); the daily Vercel
  cron (`/api/cron/ens-harvest`, 05:00 UTC) scans ~7,200 new blocks per day.
- CLI: `npx tsx --env-file=.env.local scripts/ens-harvest.ts
--backfill | --incremental`. Interrupt-safe.
- The ENS registry address comes from ethers' network config, not a typed
  constant — a wrong registry address fails silently (every `resolver()`
  read returns `0x`), which is exactly what happened on the first attempt.

### 2026-08-12 (Farcaster protocol sweep)

**Bulk-ingest every Farcaster verified wallet into social_graph**

- New `lib/farcaster-sweep.ts`: sweeps Neynar `/user/bulk` (100 FIDs/call,
  1 credit/FID — a full network sweep is ~3.3M of the free tier's 10M monthly
  credits) and upserts every verified + custody ETH address with username,
  FID, and follower count. Sources tagged `farcaster_sweep`.
- Swept rows are deliberately medium quality (score 45, no `last_checked_at`):
  they carry Farcaster data but were never checked for Twitter, so lookups
  use them as base data and still resolve the remaining fields. Sweep upserts
  never touch Twitter/ENS/Lens/GitHub columns, and `last_updated_at` only
  moves on identity changes so re-sweeps don't trigger "new matches" badges.
- Daily incremental Vercel cron (`/api/cron/farcaster-sweep`, 05:30 UTC)
  ingests newly registered FIDs (sequential, so new = above max known fc_fid).
- Monthly full re-sweep via GitHub Actions
  (`.github/workflows/farcaster-sweep.yml`) — requires `DATABASE_URL` and
  `NEYNAR_API_KEY` repository secrets.
- CLI: `npx tsx --env-file=.env.local scripts/farcaster-sweep.ts
--full | --incremental | --range A B`. Idempotent, safe to interrupt.

### 2026-08-12 (negative-result persistence)

**Stop re-buying API calls for wallets known to have no socials**

- `social_graph` now persists negative results: wallets that completed the full
  external pipeline with nothing found get a row (all socials NULL,
  `sources=['none']`) with a new `last_checked_at` column. Repeat lookups skip
  all paid API calls for 30 days. Previously this knowledge lived only in the
  7-day `wallet_cache` — the graph held ~5k positives out of ~86k wallets ever
  checked, so ~80% of every repeat list was re-purchased.
- False-negative protection: `batchFetchNeynar`/`batchFetchWeb3Bio` now report
  failed wallets (timeouts, 429s, 5xx) separately from genuine not-founds, and
  failures are never persisted as negatives. Fast-mode and Neynar-disabled runs
  don't persist negatives either (incomplete pipeline).
- All `social_graph` readers updated for rows without socials: v1 API
  wallet/batch report `found: false` (with `checked_at` to distinguish
  "never seen"), stats/analytics denominators count positives only, the
  refresh-stale cron skips negatives, and "new matches" badges ignore
  negative re-checks.
- Migration: `scripts/migrate-negative-persistence.ts` (applied 2026-08-12).

### 2026-08-12 (later)

**Pricing and packaging changes**

- **Pro: $149 → $99**, and contract import moved down from Unlimited into Pro
- **Free per-lookup limit: 1,000 → 500**
- **New analytics events**: `checkout_redirected`, `checkout_failed`; `limit_hit` wired up
- Revenue math in the webhook, admin dashboard and analytics updated to 9900 cents

Driven by the funnel: 41 checkout sessions started, 0 completed. Free gave 1,000 wallets
per lookup with unlimited lookups and ungated CSV export, leaving Pro with little to sell.

**Deploy order matters:** the `$99` Stripe price must exist and `STRIPE_PRICE_PRO` must
point at it _before_ this ships, or the site advertises $99 and charges $149.

### 2026-08-12

**Robinhood Chain support for contract import**

- **New network**: Contract import now supports Robinhood Chain (chain ID 4663) alongside Ethereum and Base
  - NFT (ERC-721/1155) holder lookups via Alchemy's NFT API on `robinhood-mainnet`
  - Requires `ROBINHOOD_MAINNET` to be enabled for the app in the Alchemy dashboard
  - Verified against onchain `ownerOf` enumeration: Alchemy returned exactly the same
    618 holders for StonkBrokers (4,444 tokens) with no gaps in either direction
- **ERC-20 gap handled explicitly**: Moralis has no holder index for Robinhood, so token
  lookups on that network now fail with a clear message instead of an opaque API error.
  The import modal warns before the request is made.
- **New `lib/chains.ts`**: Chain constants (`SUPPORTED_CHAINS`, `CHAIN_LABELS`, `CHAIN_IDS`)
  split into a dependency-free module. `lib/contract-holders.ts` imports `ethers` at module
  scope, so client components importing chain values from it would ship ethers to the browser.
- **Chain selector is now data-driven**: `ContractImportModal` maps over `SUPPORTED_CHAINS`
  instead of hardcoding radio buttons, so adding a network is a one-line change.
- **Moralis no longer gates NFT imports**: `/api/contract-holders` previously returned 503
  when `MORALIS_API_KEY` was unset, blocking NFT lookups that only need Alchemy.
- **Clearer errors**: New `UNSUPPORTED_CHAIN`, `CHAIN_NO_NFT_SUPPORT`, and
  `CHAIN_NO_ERC20_SUPPORT` codes replace a raw TypeError on unknown networks.

### 2025-01-21

**Admin analytics dashboard + IP rate limiting**

- **Admin analytics dashboard**: New "Dashboard" tab in admin panel with comprehensive usage metrics
  - Period selector: Today / Last 7 days / Last 30 days with comparison to previous period
  - Usage metrics: Lookups, wallets processed, match rate, avg processing time (with % change)
  - Match analytics: Twitter/Farcaster/any rates with progress bars and 7-day sparkline trends
  - Performance monitoring: Queue status (pending/running), success rate, stage distribution
  - Recent activity table: Last 5 completed jobs with match stats
  - New endpoint: `GET /api/admin/dashboard?period=today|week|month`
- **IP-based rate limiting**: Prevents abuse from unauthenticated users
  - 3 requests per hour on `/api/lookup` and `/api/jobs` per IP address
  - Atomic UPSERT prevents race conditions under concurrent load
  - Supports proxy headers: `x-forwarded-for`, `x-vercel-forwarded-for`, `cf-connecting-ip`
  - Returns standard rate limit headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, etc.)
  - Fails open if database unavailable (allows requests but logs warning)
  - New table: `ip_rate_limit_buckets` with hourly bucket granularity

**Database migration required**:

```sql
CREATE TABLE IF NOT EXISTS ip_rate_limit_buckets (
  ip_address TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  bucket_key TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (ip_address, endpoint, bucket_key)
);
```

---

### 2025-01-18

**New Starter tier + API optimization**

- **Starter tier ($49)**: New entry-level paid tier with 10,000 wallets cumulative (total across all lookups)
  - All Pro features (ENS, follower counts, priority scoring, history)
  - Quota-based instead of per-lookup limits
  - `wallets_used` column tracks cumulative usage
- **API pipeline optimization**: Neynar runs first (fast batch API), then Web3Bio only for wallets without Twitter
  - Expected 30-60% reduction in Web3Bio API calls
  - Separate stage indicators: `neynar` then `web3bio` instead of `web3bio+neynar`
- **PROJECT_OVERVIEW.md**: New comprehensive context document for LLMs

**Database migration required**:

```sql
ALTER TABLE users ADD COLUMN wallets_used INTEGER NOT NULL DEFAULT 0;
```

---

**Scalability audit: fixes for high-load scenarios**

Critical fixes (P0):

- **Inngest concurrency**: Increased from 10 to 100 concurrent jobs - 50 jobs now start in ~5s vs ~250s
- **API timeouts**: Added 15-second timeouts to all external API calls (Web3.bio, Neynar, ENS) - prevents jobs from hanging indefinitely
- **Rate limit race condition**: Fixed with atomic UPSERT - accurate counting under high concurrency
- **Connection pooling**: Added optional Neon pooler support (`USE_CONNECTION_POOLING=true`) - reduces p95 latency from 200-500ms to 50-100ms
- **Cache state loss bug**: Fixed Inngest step serialization issue that was discarding cache hits - 2-3x faster processing

High priority fixes (P1):

- **Debounced search**: 300ms debounce on ResultsTable search - eliminates 1-2s lag with 10K+ results
- **Parallel cron processing**: Process 5 jobs simultaneously instead of 1 - 5x faster queue clearing
- **Adaptive polling**: Starts at 2s, increases to 5s when idle - ~60% reduction in server requests
- **Composite indexes**: Added `(status, created_at)` and `(user_id, created_at)` indexes for faster queries
- **COUNT aggregates**: Replaced full table scans with `COUNT(*) FILTER` - ~99% faster stats queries

Additional fix:

- **Neynar 404 handling**: Gracefully handles batches where no addresses have Farcaster accounts

**Database migrations required**:

```sql
CREATE INDEX IF NOT EXISTS lookup_jobs_status_created_idx ON lookup_jobs (status, created_at);
CREATE INDEX IF NOT EXISTS lookup_history_user_created_idx ON lookup_history (user_id, created_at);
```

### 2025-01-17 (Evening)

**Admin Wallet Enrichment feature**

- **Manual wallet enrichment**: New "Enrichment" tab in admin panel for adding/editing social data
  - Search any wallet address to view existing social_graph data
  - Add Twitter, Farcaster, or ENS manually with 'manual' source tag
  - Recent manual edits list for quick reference
- **New API endpoint**: `POST /api/admin/social-graph` for admin wallet enrichment

**New matches notifications**

- **Enrichment badges**: "X new matches" badge appears on lookups when wallets have been enriched since last view
- **Row highlighting**: Enriched wallets highlighted with green background + "NEW" badge in results table
- **View tracking**: `lastViewedAt` timestamp tracks when users load lookups for accurate "new" detection
- **Automatic clearing**: Badges clear after user views the lookup (read-receipt pattern)

**Input source tracking**

- **Source column in admin history**: Shows whether lookup came from "File" (upload) or "Paste" (text input)
- **Color-coded badges**: Blue for file uploads, purple for text input
- **New database column**: `input_source` on `lookup_history` table

**Database migrations required**:

```sql
ALTER TABLE lookup_history ADD COLUMN IF NOT EXISTS last_viewed_at TIMESTAMP;
ALTER TABLE lookup_history ADD COLUMN IF NOT EXISTS input_source TEXT;
```

### 2025-01-17

**Public API infrastructure**

- **Subscription API product**: New `/api/v1/` endpoints for external developers to access social_graph data
- **API key management**: Generate, validate, revoke, and rotate API keys with SHA-256 hashing
- **Three pricing tiers**: Developer ($49/mo), Startup ($199/mo), Enterprise ($799/mo)
- **Rate limiting**: Multi-tier sliding window limits (per-minute, daily, monthly) with `X-RateLimit-*` headers
- **Usage tracking**: Per-request analytics for billing and monitoring
- **Core endpoints**:
  - `GET /api/v1/wallet/[address]` - Single wallet lookup (1 credit)
  - `POST /api/v1/batch` - Batch lookup up to plan limit (1 credit/wallet)
  - `GET /api/v1/reverse/twitter/[handle]` - Find wallets by Twitter (2 credits)
  - `GET /api/v1/reverse/farcaster/[username]` - Find wallets by Farcaster (2 credits)
  - `GET /api/v1/stats` - Dataset statistics (free)
  - `GET /api/v1/usage` - API key usage stats (free)
- **Developer endpoints**: `/api/developer/keys`, `/api/developer/plans`, `/api/developer/usage`
- **New database tables**: `api_plans`, `api_keys`, `api_usage`, `rate_limit_buckets`

**Processing modal redesign**

- **Animated activity indicators**: Spinning ring + pulse effect shows processing even at 0%
- **Pipeline visualization**: 4-stage progress (Cache → Web3.bio → Farcaster → ENS) with active stage highlighting
- **Shimmer effects**: Progress bar has animated shimmer and sliding gradient when idle
- **Color-coded stats**: Twitter (sky) and Farcaster (violet) badges pulse when finding new matches
- **Job restoration fix**: Returning to page now properly restores stage info and animations

**New comparison pages**

- **`/vs/blaze`**: Compare against Blaze Web3 CRM ($79/month) - highlights Farcaster support and one-time pricing
- **`/vs/holder`**: Compare against Holder.xyz wallet messaging platform - emphasizes lookup focus vs CRM
- **SEO improvements**: Shortened titles, added keywords, Twitter cards, enhanced JSON-LD, internal linking between all /vs/ pages

**My lookups: Tiered history + Add addresses feature**

- **Renamed "Recent Lookups" to "My lookups"**: Better reflects user ownership
- **Tiered history visibility**: Free users see 1 lookup, Pro/Unlimited see full history with pagination
- **Add addresses to lookups (Pro+)**: Click "+" on any lookup to add more addresses
  - New AddAddressesModal with file upload and paste support
  - Deduplicates addresses already in the lookup
  - Merges new results with existing, preserving source tracking
  - Choose to add to existing lookup or create new one
- **Updated Upgrade modal**: Now lists history and add-to-lookups as Pro+ features
- **Updated vs/addressable page**: New comparison rows for Lookup History and Add to Lookups

**Admin dashboard enhancements**

- **Tabbed admin UI**: New tabs for Activity, Jobs, History, and Users management
- **Activity tab**: View/hide/delete completed jobs from public Live Activity feed
- **Jobs tab**: Monitor all jobs, filter by status, retry failed jobs, cancel stuck ones
- **History tab**: View/search/delete lookup history by user ID
- **Users tab**: View users by tier, change tiers via dropdown for manual upgrades
- **Hidden jobs**: New `hidden` column to hide spam/test lookups from public feed
- **New admin endpoints**: `/api/admin/activity`, `/api/admin/jobs`, `/api/admin/history`, `/api/admin/users`
- **Fixed match rate calculation**: Now uses `anySocialFound` instead of double-counting Twitter + Farcaster

**UX improvements**

- **Wallet limit warning**: Shows banner when uploaded file exceeds tier limit (before clicking Start)
- **Updated time estimates**: Processing now shows ~10s per 1K wallets (was incorrectly showing ~2min)
- **Live Activity filter**: Now hides lookups with fewer than 25 wallets
- **Copy refinements**: "Farcaster" instead of "FC", curly apostrophes, sentence case headings
- **Fixed Live Activity rate**: Now shows deduplicated "any social" rate (14.5%) instead of inflated sum (22%)
- **New `any_social_found` column**: Tracks unique wallets with Twitter OR Farcaster (not double-counting)

### 2025-01-16

**SEO & positioning**

- **Addressable alternative positioning**: New `/vs/addressable` comparison page
- **SEO meta tags**: Optimized title, description, and Open Graph tags for search visibility
- **Comparison content**: Feature comparison showing advantages over Addressable

**Live Activity improvements**

- **Industry average comparison**: Shows "9x industry avg" badge (vs ~2.5% baseline)
- **Cleaner copy**: Simplified homepage messaging and AccessBanner text

### 2025-01-15

**Tiered pricing with Stripe integration**

- **Three tiers**: Free (500 wallets), Pro (5,000 wallets, $99), Unlimited ($249)
- **Stripe Checkout**: One-time payment flow with automatic tier upgrade
- **Admin whitelist**: Manual unlimited access grants via `/admin` dashboard
- **Access control**: Tier-based limits enforced on frontend and backend
- **User database**: New `users` and `whitelist` tables for access management

**UI overhaul - Stripe-inspired design**

- **New color scheme**: Indigo accent color (`#635bff`) replacing green
- **Card-based layout**: Clean cards with subtle shadows and borders
- **Improved typography**: Better hierarchy and spacing throughout
- **Dark mode polish**: Refined dark theme with proper contrast
- **Consistent styling**: Buttons, inputs, and badges unified

**Rebrand to walletlink.social**

- **New domain**: Rebranded from previous name to walletlink.social
- **App icon**: Custom wallet emoji icon as favicon and header logo
- **Header clickable**: Logo/title returns to homepage from any state

**Performance optimizations**

- **Table virtualization**: ResultsTable uses `@tanstack/react-virtual` for 13K+ rows
- **Component memoization**: React.memo, useMemo, useCallback throughout
- **Reduced re-renders**: Optimized polling to avoid unnecessary state updates

**Live Activity redesign**

- **Card-based tiles**: Horizontal scrolling cards showing recent lookups
- **Pulsing indicator**: Green dot animation for "live" feel
- **Social proof**: Shows wallet count, Twitter/FC found, and match rate %

### 2025-01-14

**User-specific history + public wins showcase**

- **Private "Recent lookups"**: Each user only sees their own lookup history (localStorage ID until profiles)
- **"Recently processed" showcase**: Public tiles showing successful lookups (>10% social rate) as social proof
  - Updates every 3 minutes via polling
  - Shows wallet count, Twitter/Farcaster counts, and social hit rate %
- **Removed data source references**: Cleaner UI without Web3.bio/Neynar attribution in footer and results table
- **New database columns**: `user_id` on `lookup_history` and `lookup_jobs` tables

**Major performance optimizations + Inngest integration**

- **Parallel API calls**: Web3.bio and Neynar now run concurrently (saves 2-3s per batch)
- **Parallel Neynar batches**: Process 5 batches simultaneously instead of sequentially (5x faster)
- **Increased ENS batch size**: 50 wallets per batch instead of 20 (2.5x faster)
- **Larger chunk size**: 3000 wallets per cron invocation instead of 2000 (50% more throughput)
- **Inngest integration**: Optional workflow orchestration for 10-50x faster processing
  - Install: `npm install inngest` and add `INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY` env vars
  - Processes wallets in 500-wallet micro-batches with durable checkpoints
  - Falls back to cron worker if Inngest not configured
- **Estimated speedup**: 13k wallets now ~2-3 minutes (was ~17 minutes)

**Persist job ID across page refresh**

- Saves active job ID to localStorage so progress survives page refresh
- Automatically restores in-progress job state on page load
- Fixes issue where refreshing the page would lose connection to running job

**Add estimated processing time**

- Shows estimated time when file is uploaded (based on wallet count)
- Shows time remaining during processing (based on actual rate)

**Smooth progress bar animation**

- Progress counter animates smoothly instead of jumping in chunks
- Creates responsive feel during batch processing

**Add background job queue for large wallet lookups**

- New job queue system handles batches of any size without timeout
- Vercel Cron worker processes jobs in chunks (2000 wallets per invocation)
- Jobs persist in database and resume automatically if interrupted
- Frontend polls for progress instead of SSE streaming
- Users can close browser tab and retrieve results from History later
- New `lookup_jobs` table tracks job status, progress, and partial results
- New API endpoints: `POST /api/jobs`, `GET /api/jobs/[id]`, `POST /api/jobs/worker`

**Add browser notification on lookup complete**

- Opt-in checkbox to receive browser notification when long lookups finish
- Uses native Web Notifications API (no dependencies)
- Shows count of Twitter/Farcaster accounts found
- Click notification to focus the app tab

**Add Excel (.xlsx) file upload support**

- New file format support: upload .xlsx files in addition to CSV
- Unified file parser abstraction (`lib/file-parser.ts`) for extensibility
- Uses `read-excel-file` library (~50KB) for efficient Excel parsing
- Auto-detects wallet/address column in Excel files (same logic as CSV)
- Preserves extra columns from Excel files
- 10MB file size limit with clear error messaging

### 2025-01-14

**Add permanent social graph database** (`868e2bd`)

- New `social_graph` table stores all wallets with discovered social accounts permanently
- Merge & update strategy: new data fills gaps, follower counts update, existing data preserved
- Enrichment: backfills results from social graph after API calls complete
- Indexed on twitter_handle, farcaster, ens_name, fc_followers for future query capabilities
- Tracks firstSeenAt, lastUpdatedAt, and lookupCount per wallet

**Add dark mode with system preference toggle** (`9c414c0`)

- Dark mode support with automatic system preference detection
- Toggle cycles through System/Light/Dark modes
- Preference saved to localStorage

### 2025-01-13

**Add holdings, priority score, and enhanced export features** (`c1c77e2`)

- Holdings/Value column: auto-detects value columns from CSV (Peak index DTF value, balance, holdings, etc.), displays with $X,XXX.XX formatting
- Priority Score column: calculates `holdings × log₁₀(fcFollowers + 1)` with 5-bar visual indicator
- Top Influencers filter: quick filter button for accounts with 1K+ Farcaster followers
- Click-to-copy wallet: truncated `0x1234...abcd` display with clipboard copy and "Copied!" toast
- Twitter List export: new button to generate `.txt` file with @handles (one per line) for Twitter list import
- Enhanced CSV export: includes all columns (wallet, ens, holdings, twitter, farcaster, fc_followers, priority_score, source), sorted by priority score descending

**Format codebase with Prettier** (`2bd28ff`)

- Added Prettier configuration and formatted all source files

### Previous Updates

**Add Web3.bio API key support** (`f75c0fd`)

- Support for Web3.bio API key to increase rate limits

**Add warning for ENS with large wallet batches** (`2fc0aa4`)

- Show warning when using ENS lookup with >1000 wallets (may timeout)

**Speed up lookups to avoid Vercel timeout** (`b7e6899`)

- Optimized batch processing to complete within Vercel's function timeout limits

**Add ENS text record lookups for onchain Twitter handles** (`b38f945`)

- Query ENS text records directly onchain for the most accurate Twitter handle data
- Optional toggle (slower but more reliable than API sources)

**Add Neon database integration for caching and history** (`96f3780`)

- 24-hour result caching to speed up repeated lookups
- Lookup history feature to save and reload previous searches

**Initial commit: Wallet Social Lookup app** (`0ecff9d`)

- Core wallet-to-social lookup functionality
- Web3.bio and Neynar API integration
- CSV upload and export

---
