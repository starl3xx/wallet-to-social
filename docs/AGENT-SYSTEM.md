# The agent system

**What this document is.** walletlink now serves two customers: people using a
browser, and agents driving the API, the MCP server, and the Grok plugin. This
document is the design authority for the second customer. It names the layers
the system is made of, the principles that hold them together, the places where
the current build breaks its own rules, and the order in which to fix them. It
was produced by driving the system end to end as five different agents (a
conversational bot, an autonomous x402 buyer, a weekly bulk CRM agent, an
answer engine, and the maintainer agent that works this repo) and grounding
every claim in a file and line.

**How to read it.** The tower says what belongs where. The physics says what
every change must preserve. The gap register is the work, in order. When a new
feature is proposed for the agent surface, it must name its layer, and it must
not restate a fact whose authority lives in another layer.

---

## The tower

Five layers. Each one is a projection of the layer below it, never a second
copy. The build already enforces this in places (the MCP server prices
identically to REST _by construction_, because `lib/mcp-call.ts` forwards the
caller into the same handlers); the goal is that every layer boundary works
that way.

### L0. The index

The facts: `social_graph`, `x_accounts`, `wallet_holdings`, `known_agents`,
and the negative knowledge that is as valuable as the positive
(`last_checked_at` with every social column NULL means “checked, nothing
there”, trusted for `NEGATIVE_RECHECK_DAYS`). Provenance and freshness are
part of the fact, not metadata about it: `sources[]`, `data_quality_score`,
`stale_at`, and the partial-knowledge rule that keeps bulk-swept rows below
the trust line. `social_graph_history` records every field change. Nothing
above this layer may invent a fact. Facts enter L0 only through the ingest
pipelines: an upper layer may **commission** collection (a job, a deep scan)
but never writes directly; the pipeline writes, and the row carries provenance
like any other. Commissioning a fact is not inventing one.

### L1. The semantic contract

The meaning of the facts: what a **match** is (billable: an X handle or a
Farcaster account; ENS, Lens and GitHub identities are free), what
**attested** means (the owner published the link: a Farcaster verification, an
onchain ENS record, or an attested-social sign-in), what **reachability**
means (live, suspended, unclaimed, reassigned; absent means unchecked, never
false), what **stale** and **previously checked** mean, and the evidence-class
allowlist (`lib/api-sources.ts`) that lets provenance be quoted without ever
naming a provider.

This layer is currently the weakest part of the build, not because the
semantics are wrong but because they are **restated by hand in at least seven
places** (llms.txt, two concept pages, the OpenAPI descriptions, the MCP
instructions and tool text, the plugin SKILL.md, the plugin README), and the
restatements have diverged in load-bearing spots. The fix is the same one the
repo already applied to numbers: one authority, everything else imports or
links. See gap register, tier A.

### L2. Metered primitives

The verbs: resolve (one address or a batch), reverse (paged), stats, usage.
One authentication gate (`authenticateApiRequest`), one meter (matches, billed
on outcome, misses free), one rate limiter (three windows, units weighed per
wallet, summed account-wide across keys). Every price and limit lives in
`lib/packs.ts` and `lib/api-plans.ts` and nowhere else. The acquisition verbs
live here too: buy (checkout or the x402 rail) and the key lifecycle, because
the meter they feed is this layer’s.

### L3. Agent affordances

What turns primitives into a system an agent can _drive_: knowing state
without asking, recovering without a human, planning spend before spending,
and building on yesterday’s work instead of repeating it. This is the layer
2026-09-01 started building (quota in every metered result and every metered
refusal: the 402 and 429 carry the meters, a 401 by design carries none) and
the layer with the largest gaps:

- **Self-remedying refusals**, partial: the 402 names no purchase path, and
  the x402 rail is invisible from inside MCP.
- **Spend planning**, shipped 2026-09-01 (gap 19): `/v1/estimate` is the dry
  run (free, counts only, weighed like the batch it previews) and `/v1/stats`
  carries the measured per-chain rates. The record of the gap: no total-cost
  surface, no dry run, no per-chain rates on the free tools.
- **Async work**, shipped 2026-09-01 (gap 15, `/v1/jobs`). The record of the
  gap: the resumable job pipeline was reachable only from the web surface (a
  session, or an anonymous browser bounded by IP rate limits); the
  key-authenticated surface was sync-only, so a 10,000-address job was 200
  paced calls across two UTC days. Now it is one submission and a free poll.
- **Deltas**, missing: the server holds three forms of “what changed since
  last week” (`getEnrichedWalletsSince`, `social_graph_history`, `x_accounts`
  transitions) and exposes none of them to a key, so a weekly agent re-buys
  ~2,370 matches (10,000 × the measured 23.7% rate) to learn that mostly
  nothing changed.
- **Purchase memory**, missing: re-resolving a wallet the account already paid
  for bills again, and the docs’ advice is client-side caching, which a
  stateless agent host cannot do.

### L4. Projections

The surfaces an agent actually touches: the REST API and its OpenAPI spec, the
MCP server and its registry row, the Grok plugin (and future per-ecosystem
plugins), docs-site, llms.txt, and the on-site assistant. The rule of this
layer: **a projection that executes carries the caller’s credential down to
L2; a projection that explains quotes L1; neither re-implements either
layer.** `lib/mcp-call.ts` is the exemplar. A
projection that needs a sentence about meaning takes the canonical sentence; a
projection that needs a number imports the constant.

---

## The physics

Eight principles. Each has an existing exemplar in this repo; a change to the
agent surface that violates one needs to say so and say why.

1. **One authority per fact.** Prices live in `lib/packs.ts`; published counts
   in `lib/public-figures.ts`; limits in `lib/api-plans.ts`. Extension this
   document orders: the six load-bearing _sentences_ of the semantic contract
   get the same treatment (see tier A).
2. **Identical by construction, not by agreement.** The MCP layer bills
   nothing and authenticates nothing; it hands the caller to the one place
   that does. Prefer this shape to any synchronized table.
3. **A refusal carries its remedy.** 429 carries Retry-After and the reset
   time; 402 carries the balance. Extension: the 402 must name the purchase
   paths, machine rail included, because for an autonomous agent a refusal
   without a remedy is a dead end, not a prompt.
4. **Absent is not false.** Enforced with the same words at every layer, from
   the column comment to the SKILL.md. Any new field follows it: omit what was
   not measured; never emit a false you cannot stand behind.
5. **Meter the outcome, not the attempt.** Matches, not requests; misses free;
   duplicates deduped before billing. New affordances price the same way: a
   delta that reports “nothing changed” should cost at or near nothing,
   because the outcome delivered is small.
6. **A guard must be able to fail.** The load-bearing checkers run fixtures
   of real past defects before reporting (palette, design-language, contrast,
   control-height, the invariants guard); the rest should converge on that
   discipline. New agent-contract checks (tier A) follow
   `check-invariants-guard.ts` discipline.
7. **Every interaction accretes.** Lookups bump `lookup_count`, which routes
   refresh priority; jobs leave history; the web product remembers. The agent
   surface must stop being the exception: a paying agent that returns should
   be richer for having come before. This is the principle the whole tier C
   roadmap serves.
8. **A removal is honoured at every layer, from v1.** The right-to-removal
   suppression design binds L0 (the record), L3 (any delta or watch
   affordance) and L4 (every projection) the day each ships, never as a
   retrofit. A feature that cannot honour it yet is a feature that waits.
   _Decided (2026-09-02), the stage 1 policy, in six parts._ **Intake** is
   staged: stage 1 is email to the support address only, operator-executed,
   no proof demanded; verified self-serve lanes are a later stage and are
   not built. **Scope** is requester-named identifiers only: one
   independent `(kind, identifier)` suppression row per identifier, no
   stored association between rows, insert timestamps jittered so rows
   from one request cannot be joined back together; the dedupe and
   negative tables (`x_handle_attempts`, the ephemeral sweep seen tables,
   `clanker_unresolved_ids`) stay outside the boundary, documented,
   because deleting do-not-reprocess markers increases processing of the
   person who asked to be left alone. **Disclosure** is calibrated: the
   email-lane reply never confirms whether a record existed, no removed
   event type appears on any surface, and there are no automatic refunds.
   **Reversal** is a 30-day quarantine: before deletion the affected rows
   are copied to an operator-only quarantine table (in neither
   `READ_ONLY_TABLES` nor the backup list), purged at 30 days by the
   cleanup cron; a `lane` column on the suppression table records the
   verification method (values like `email`, `wallet_sig`, `handle_proof`,
   `legal`), never anything about the requester; un-suppress restores from
   quarantine and is operator-only in stage 1. **Saved copies** are erased
   in stages: lookup job payloads expire at 30 days, saved lookups carry a
   user-facing delete, a serve-time filter strips suppressed identifiers
   from history and jobs reads, and each removal amends saved results in
   place, non-fail-soft, REMOVING the mapping keys (removal rather than
   JSON nulls, a deliberate refinement: absent keys are the ordinary-miss
   shape, so an amended row cannot be fingerprinted as a removal, which
   serves the calibrated-disclosure decision) while keeping the wallet
   entry so row counts align. A saved lookup whose SUBJECT is the removed
   identifier (a reverse lookup saved as "Wallets for @handle") is
   quarantined and deleted whole, because its name plus row membership is
   the mapping and no per-element amend can make it honest. **The
   promise** is laddered: the
   privacy page states exactly what each stage ships, and keeps the
   no-proof sentence, the jurisdiction-blind stance and the 30-day SLA.

---

## Gap register

Grounded findings from the five-persona drive, 2026-09-01. Each item names
its subject files and functions; re-verify against the code before acting,
since lines and behavior drift.

### Tier A: truth bugs on public surfaces (shipped 2026-09-01; kept as the record of what was wrong)

1. **The `attested` field contradicts the docs’ own definition.** MCP
   `shapeRecord` maps `attested` to the narrow `verified` flag, which
   `data-quality.mdx` says is true only for onchain and manual routes, so the
   majority Farcaster-attested handles report `attested: false` and SKILL.md
   then teaches agents to treat them as weak evidence. Fix: derive `attested`
   from the evidence classes (onchain, farcaster, attested-social, manual any
   present), and align tool text, SKILL.md and the OpenAPI description.
2. **Impossible arithmetic on the concept pages.** 460,889 resolved presented
   as “99.5% of the 460,798 held” (resolved is a superset, not a subset).
   Rewrite to the llms.txt framing, add the coverage percentage as a
   registered constant.
3. **“Free” tools that refuse at zero balance, undisclosed.** llms.txt and
   the coverage tool description omit the zero-balance 402 (the balance tool
   already states it). The documentation fix lives here; removing the refusal
   itself is a behavior change and sits in tier B.
4. **The owner-attested route enumeration exists in two versions** (two routes
   vs three). One canonical sentence, reused verbatim.
5. **agent-pack.mdx contradicts itself on key recovery** (“does not exist
   yet” vs the documented, working flow eight lines later).
6. **Small copy divergences:** quickstart vs lookups on the free CSV export;
   README’s orphan “16-47%” any-identity row; llms.txt using “reachable” for
   the has-an-account number its own assistant prompt reserves for liveness.
7. **The batch pacing rule is stated nowhere an agent decides.** A 50-address
   call spends 50 of the 60 per-minute units; the REST rate-limits page states
   it, but the resolve tool text says
   “send every address in one call” and never says a second batch in the same
   minute refuses. One sentence in the tool description, SKILL.md and
   agent-pack.mdx.
8. **The x402 rail is invisible at the moment of need.** The no-key error and
   the 401 challenge point at a browser flow; neither the MCP route nor
   mcp-server.mdx mentions x402 at all. The refusal texts gain the machine
   path (mind `check-design-language.mjs`, which greps inside strings).

**Mechanism for A1/A4 and the rest of the sentence drift:** a
`lib/canonical-sentences.ts` exporting the six load-bearing sentences (what a
match is; the owner-attested routes; the verified-flag caveat; absent is not
false; the reachability states; the zero-balance rule). llms.txt and the MCP
INSTRUCTIONS import them; docs pages quote them under stable anchors; the
plugin repo’s CI compares its SKILL.md against a pinned copy. Extend
`check-published-figures.ts` (or a sibling `check-canonical-sentences.ts`,
fixture-first) to refuse drift the way figures drift is refused today.

### Tier B: ergonomics (shipped 2026-09-01; kept as the record; still open: the CDP facilitator half of 14, and batch rows deliberately keep omitting the quality object from 10)

9. **Free tools honour their declared zero cost.** Skip the balance gate when
   the declared cost is 0 (`authenticateApiRequest` already receives the
   credits argument). An agent at zero balance must be able to read its own
   meter; that reading is the argument for buying again.
10. **Batch parity.** Batch rows omit `previously_checked`, `stale`,
    `quality_score`, and the MCP trim drops `fid`, which dead-ends the
    Farcaster DM handoff (the DM rail is addressed by fid). Return them.
11. **Retry honesty.** Requests re-billed on retry, no `Idempotency-Key`, yet
    the MCP tools declare `idempotentHint: true`, inviting frameworks to
    retry freely. Accept an idempotency key on batch with a short dedup
    window, and state the retry-billing rule where agents read.
12. **The free coverage signal is too slow to use.** The coverage tool warns
    it runs a live count “slow enough not to poll”. Serve materialized
    numbers with an as-of stamp.
13. **Key-cap deadlock for x402 accounts.** Recovery at three active keys
    demands a revocation only an email session can perform, and an x402
    account’s synthetic address can never receive email. Let the signed
    recovery challenge take `revoke_others_and_reissue`; wallet control is
    exactly the proof revocation needs.
14. **Stale x402 comment and indexing.** `lib/x402.ts` says the route sends no
    bazaar block; the route now does. Verify the rail is actually indexed
    where paying agents browse, or finish the CDP facilitator switch.

### Tier C: capabilities (decisions recorded 2026-09-01)

15. **`/v1/jobs`: the async surface.** Wrap the existing pipeline
    (`createJob`, chunked, resumable, Inngest plus cron) behind
    `authenticateApiRequest`, bounded by the existing `SUBMISSION_MULTIPLIER`
    rule, billed by the existing idempotent `chargeForJob`. This is the
    single biggest capability gap: the paid surface is sync-only while the
    free web product is not. _Decided (2026-09-01):_ ship; runs the standard
    pipeline (live resolve on miss, exactly like web jobs) so it also closes
    gap 20; billed on matches by `chargeForJob`; bounded by
    `SUBMISSION_MULTIPLIER` and one active job per account. _Shipped
    (2026-09-01):_ `POST /v1/jobs` and `GET /v1/jobs/{id}` (poll free on both
    meters, ownership mismatch answering the missing-job 404, asserted in
    `check-invariants.ts`), the `walletlink_submit_job` and
    `walletlink_job_status` MCP tools, and the docs (openapi.yaml, the jobs
    reference page, llms.txt) in the same wave. Gap 20 closed with it. No
    `Idempotency-Key` on the POST yet: the 409 covers the in-flight window,
    and a resend after completion re-runs and re-bills, stated where agents
    read.
16. **`/v1/changes` and watchlists: the accretive core.** A key registers a
    wallet set once (or references a `lookup_history` row it owns); a call
    priced by principle 5 (the outcome “nothing changed” is small) answers “N
    of your wallets changed since your watermark”; expanding the N bills
    normally. Backed by `getEnrichedWalletsSince` plus
    `x_accounts` status transitions (which today never touch
    `last_updated_at`, so include them explicitly). Scope strictly to wallets
    the account was previously billed for. **Constraint: principle 8 applies
    from v1.** _Decided (2026-09-01):_ the watch call (counts of changed
    wallets since the watermark) is free and rate-limited normally; expanding
    bills one credit per changed wallet that is a match; an unchanged wallet
    is never re-billed through the watch. “You pay when a watched wallet
    changes, never to learn that nothing did.” _Update (2026-09-02):_ the
    principle 8 blocker is in build: removal stage 1 (the suppression list
    and triggers, the pre-flight filter, the quarantine and the operator
    endpoint) is in review, and 16 can start once it ships.
17. **Plan laddering.** Every pack maps to the developer plan; “nothing a
    caller can buy raises it”. Map Scale and Index buyers to the seeded
    `startup` preset (200-address batches, 300/min). _Decided (2026-09-01):_
    Trial and Campaign stay on developer; Scale maps to the startup preset;
    Index maps to the enterprise preset. Credits keep bounding totals, so the
    export-licence hole stays closed. _Shipped (2026-09-01):_ the account’s
    highest-tier UNEXPIRED pack decides, spent down or not (what $299 buys is
    twelve months of the preset, the same twelve months the credits live),
    decided per request in `authenticateApiRequest` from `credit_lots` via
    `PACK_API_PLAN`/`ladderedPlanId` (lib/api-plans.ts), never from anything a
    caller sends, and never demoting a hand-raised plan. Keys stay stored on
    developer; legacy pro/unlimited keep their TIER_API_PLAN mapping
    untouched. The MCP zod cap moved to the largest plan batch so the schema
    cannot refuse a list the caller’s real plan accepts; the v1 handler
    enforces the served plan’s ceiling. Asserted in `check-invariants.ts`
    (a plan name smuggled as a pack id ladders nowhere).
18. **x402 rail growth.** Quantity on the buy (one settlement, N packs,
    per-match price unchanged, capped); top-up bound to the presented key so
    a 402 is recoverable mid-session; spend-based accretion (every Nth
    settlement grants bonus matches). _Decided (2026-09-01):_ quantity 1-25
    per settlement at linear price; top-up credits the account behind a valid
    `wts_live_` key presented with the payment (OAuth stays excluded); every
    10th settlement from the same wallet grants one bonus pack of matches.
    _Shipped (2026-09-01):_ `{"quantity": N}` in the buy body scales the
    requirements, the verification and the grant from the one parsed number
    (`quantityFrom`, strict, no coercion); replay idempotency stays keyed on
    the authorization. A valid `wts_live_` key in the Authorization header
    redirects the grant to that key’s account with no key minted; the two
    header refusals (OAuth `403 OAUTH_CANNOT_BUY`, invalid key
    `401 INVALID_TOPUP_KEY`) both land before verify/settle, so money never
    moves down a refused path. Loyalty counts the wallet’s settlement ids in
    `credit_lots` (`countSettledPurchases`): bonus lots have no settlement id
    and never count, and the grant runs only when `grantPackBySettlement`
    actually wrote, so the bonus is unreachable by replay. All three carry
    assertions in `check-invariants.ts`.
19. **Dry-run estimate.** Counts-only pre-spend quote (how many of these
    addresses are in the index; how many would bill), per-chain rates on
    stats. Same disclosure class as the free reverse count. _Decided
    (2026-09-01):_ free; counts only; minimum list size 10; weighed against
    the rate window like a batch; per-chain match rates added to `/v1/stats`
    from the measured table. _Shipped (2026-09-01):_ `POST /v1/estimate`
    (credits 0, rate weight one unit per wallet via the new
    `authenticateApiRequest` rateWeight option, list capped at the plan’s
    `maxBatchSize`, minimum 10 DISTINCT wallets so duplicates cannot shrink
    the aggregate back into a membership oracle). Response is four counts
    plus a `{low, high}` band: low is exact for a batch of the list, high
    adds never-checked wallets at the measured overall rate. The 16-46%
    table left prose for `lib/public-figures.ts` (`CHAIN_MATCH_RATES`,
    registered as a dated measurement in `check-published-figures.ts`) and
    now rides `/v1/stats` as `match_rates`; llms.txt interpolates it. MCP
    gains `walletlink_estimate_list`, free, weighed like the batch.
    Asserted in `check-invariants.ts` (the response can carry no identity
    keys and no per-wallet rows; the declared cost is zero with per-wallet
    weight).
20. **The paid rail must not lose to the free demo.** Today `/v1` is strictly
    index-read-only while the anonymous web job runs the live pipeline, so
    for a one-off 500-address job the free path is better than the $6-10 the
    agent just paid. A keyed deep-scan (live resolve on miss, via the job
    pipeline, budget-guarded) closes the inversion. _Decided (2026-09-01):_
    subsumed by decision 15 (jobs run the live pipeline); no separate tier.
    _Closed (2026-09-01)_ by 15 shipping: a keyed job runs live resolve on
    miss, so the paid rail no longer loses to the free demo.
21. **A metered holders tool.** The conversational journey (“top holders of
    X, who can I DM?”) currently exits to a competitor between two walletlink
    calls, while `lib/contract-holders.ts` sits cookie-gated. _Decided
    (2026-09-01):_ deferred; identity is the product, holder lists are a
    block explorer’s, and the SKILL.md pointer stands; revisit on demand
    signals.

### Tier D: the repo as an agent surface

The maintainer persona’s findings, so a fresh session is productive in one
read. Tracked in `docs/CI.md` (the gate map) and `docs/OPERATIONS.md`
(posture and PR protocol), created alongside this document:

22. Preflight scripts in `package.json` (`typecheck`, per-guard `check:*`, one
    `preflight` chaining every no-DB, no-Chrome gate). _Shipped
    (2026-09-02):_ `npm run preflight` chains the no-DB, no-Chrome, no-secret
    gates in CI order; `docs/CI.md` names it as the local repro shortcut.
23. Preview builds stop touching Neon (serve frozen constants when
    `VERCEL_ENV === 'preview'`), removing the concurrent-preview starvation
    structurally; until then the stagger rule is documented. _Shipped
    (2026-09-02):_ the preview branch lives in the three prerendered
    surfaces and at the `lib/holder-pages.ts` choke point every build-time
    reader flows through; production and local builds keep the live path,
    asserted in `check-invariants.ts` with its loosenings as guard mutations.
24. Guard messages learn to name their own flakes (control-height Chrome
    boot; figures STALE on unrelated PRs prints the sync-in-its-own-PR loop).
    _Shipped (2026-09-02):_ control-height relaunches Chrome once with a
    fresh profile before failing and says the fault is environmental; the
    figures check tallies DRIFT/STALE apart from tree problems and prints the
    index-moved epilogue on pull_request runs; design-language appends a
    rephrase hint for string-literal hits in non-component files.
25. Operational posture becomes data (`ingest_state` rows read by
    `scripts/ops-status.ts`), with `docs/OPERATIONS.md` as the index.
    _Shipped (2026-09-02):_ one read-only SELECT for the `posture:*` rows,
    the credit counter (age printed first, since a stale `updated_at` makes
    the value untrustworthy) and the sweep checkpoint, telling alarming
    absence from normal absence.

---

## Sequencing

Phase 1 (truth): tier A, one PR wave. The canonical-sentences module plus its
check lands first, then every surface converges on it. No decisions needed.

Phase 2 (ergonomics): tier B plus tier D. Small, independent PRs.

Phase 3 (capability): tier C in the order 15 → 16 → 17, then 18 and 19.
Phase 3 starts with 15, and 20 is closed by it: jobs run the live pipeline,
so no separate deep-scan tier ships. 15, 17, 18 and 19 shipped on
2026-09-01, their records inline above, so 16 is the phase’s remaining item.
It waits on the removal system (the right-to-removal suppression design,
principle 8) by constraint, not by preference: a watch surface must honour a
removal from its first day, so 16 does not start until that system exists.
Stage 1 of that system entered review on 2026-09-02; the decided policy is
recorded under principle 8.

The tier C decisions were taken on 2026-09-01 and are recorded inline above,
marked _Decided (2026-09-01):_. Nothing in phase 1 or 2 touches pricing or
access tiers.

---

## What must not regress

The strengths the personas independently named, kept here so a refactor
cannot silently spend them: cost stated at the decision point on every tool;
quota riding every metered result and every metered refusal; misses free by
construction;
billing identical across surfaces by construction; absent-is-not-false in the
same words everywhere; four-state wallet-keyed reachability (the field no
competitor publishes); the evidence-class allowlist that quotes provenance
without leaking suppliers; refusals that never kill the MCP session; the
x402 buy idempotent on the authorization, with credits landing on the
account, not the key; guards that run their own fixtures first; and
machine-facing copy interpolated from constants so it cannot lie.
