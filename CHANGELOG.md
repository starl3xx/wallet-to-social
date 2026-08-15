# Changelog

All notable changes to walletlink.social. Newest first.


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
- `docs-site/` is the *only* publishable folder. `docs/` stays internal, since
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
point at it *before* this ships, or the site advertises $99 and charges $149.

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

