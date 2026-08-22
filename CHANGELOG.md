# Changelog

All notable changes to walletlink.social. Newest first.

### 2026-08-22 (the welcome sequence goes live for new signups)

- **The five-email welcome sequence sends, daily at 15:00 UTC.** Jake
  approved the copy (his edits in `docs/EMAIL-SEQUENCE.md` are canonical and
  are mirrored verbatim in `lib/welcome-sequence.ts`, with `**bold**` and
  `*italic*` markers now rendered by the lifecycle template).
  Enrollment starts at accounts created on or after 2026-08-23: the earlier
  ~100 signups stay reserved for the relaunch campaign, which has still not
  been sent. Exits: any credit lot, opt-out, legacy tier, whitelist. Every
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
  idempotent at both steps. Nothing has been sent.
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
  *successful* run, and a section for work that runs on no schedule, which is
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

