# Operations

The repo’s current operational posture, in the repo. A pipeline’s pause, its
reason, and what unblocks it used to live only in the driving agent’s session
memory, which fails the moment a different session (or a person) picks up the
work. Update this file **in the same PR** as any posture change, the way
CHANGELOG.md is updated with any behavior change.

Apply the `docs/README.md` public/private test to every fact added here, not
to the file once: posture and verification stay; a fact that mainly tells
someone where to push (a credential location, an unbounded spend path, a
bypass) goes to walletlink-ops.

## Posture, by pipeline (as of 2026-09-02)

Only pipelines with a non-default posture get a row; the full cron roster
lives in `vercel.json` and the scheduled workflows, which stay the authority
on what runs when.

`npx tsx --env-file=.env.local scripts/ops-status.ts` prints the live values
(the `ingest_state` posture and counter rows, read-only); this file stays the
index of what each row means.

| Pipeline                         | State                              | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Farcaster sweep (monthly)        | **running, slice mode**            | `--slice` covers a sixth of the network per month; every FID re-checked twice a year; revocation cleanup is range-bounded (#223). A slice writes no checkpoint by design.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| X-handle recovery backfill       | **complete** (2026-09-01, #221)    | 912k FIDs, zero transport failures on the sweep; the X-resolution side left 165 handles on ordinary retry. Checkpoint cleared itself, which is the correct end state.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| X reachability cron (daily)      | running                            | Stamps `x_accounts.checked_at`; note its status flips never touch `social_graph.last_updated_at`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Right-to-removal suppression     | **stage 1 in review** (2026-09-02) | Ships as one wave, never the trigger alone: the suppression list and triggers, the pre-flight filter in `lib/job-processor.ts`, the quarantine, the operator endpoint and the privacy-page rewording. The trigger alone would block the negative record and move re-collection from monthly to per-lookup. Any change-feed endpoint honours it from v1. Runbook below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Homepage “Recent activity” strip | known artifact, deliberately kept  | The refresh-stale cron shows as activity because `hidden` defaults false; ruled on and left. Do not “fix” it in passing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Neynar budget counter            | running; trust with care           | The counter in `ingest_state` bounds background work; check `updated_at` before trusting it, since it is a self-tracked floor. What the counter does and does not bound is recorded in walletlink-ops.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Basenames harvest (Base L2)      | **new 2026-09-02; backfill first** | The one-time backfill is a CLI run, and the daily incremental (05:20 UTC, scheduled in `vercel.json` and listed on the dependency panel) refuses to run until it has left a checkpoint, the same shape as the ENS harvest. Until the backfill has run, a red cron is the design working: the route says which command to run. Two filters carry the correctness of every row and both fail silently if they regress. Expired names keep resolving on this registry, so a name past `nameExpires` must be dropped or the row is about whoever buys the name next (measured at 44.5% of a 500-name sample). Read `expired` and `expiryUnreadable` as different things: the first is the filter working, the second means the registrar answer could not be read at all, which is a broken run rather than a lapsed name. And the handle is re-read through the registry rather than taken from the log, because a name moved between the two resolvers still has an old write in the logs of the one it left (5.0% of sampled nodes). A run that suddenly gets much cheaper or much larger is the signal that one of the two stopped applying. |
| Creator-profile sweep (Zora)     | **new 2026-09-02; budgeted**       | A scheduled workflow with a request budget and a cursor in `ingest_state`, not a cron route: the upstream limit is about one request a second, so a meaningful pass is tens of minutes and would be cut off by the 300-second function ceiling. Nothing upstream reports the budget: there is no `Retry-After` and no rate-limit header on any response, so the pacing is self-imposed and a 429 is a hard back-off rather than a retry. Two failure signatures do not mean what they look like. A 504 on some list types is a gateway timeout, not a limit, so backing off does not help (those list types have since answered 200; they stay excluded because they are ranked leaderboards, not because of the status). And the edge blocks some default HTTP client user agents outright, which arrives as a 403 and reads exactly like an empty corpus, so smoke-test the client before trusting a zero.                                                                                                                                                                                                                                 |
| Coverage materializer (daily)    | **new 2026-09-01; no heartbeat**   | `/api/cron/refresh-coverage` (04:30 UTC) writes the `/v1/stats` counts into `ingest_state` (`v1_stats_coverage`, `lib/coverage-stats.ts`). It has no row in the admin health pane, so a silent death shows up only as an aging `meta.as_of` on `/v1/stats`. The read self-primes: the first call after a deploy with no row pays one full aggregate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

## Right to removal: the operator runbook (stage 1)

Stage 1 is email-only and operator-executed. The decided policy is recorded
under principle 8 in `docs/AGENT-SYSTEM.md`; this section is the doing half.

**The reply script.** One uniform reply to every removal email, whatever a
search of the index would show. It acknowledges the request, states the
30-day window, and never confirms or denies that any record existed: the
free removal channel must not become a membership oracle for the very facts
`/v1/reverse` charges credits to reveal.

> We received your removal request. Each identifier you named will be
> suppressed, and suppressed identifiers are not re-collected. This will be
> complete within 30 days. If you want other identifiers removed, name them
> in a reply; we deliberately keep nothing that would let us work out which
> identifiers belong together, so we can only act on the ones you name.

**Then delete the thread.** After the reply confirming execution, delete
the help@ correspondence. The decided policy (decision 4) rejects keeping
it: an inbox of removal emails is the requester-to-identifier join rebuilt
in a mailbox, outside every control the schema enforces by refusing to
store it. The suppression rows are the entire durable record.

**Executing a removal.** Run the operator removal endpoint (admin-gated, the
shared `ADMIN_PASSWORD` via `lib/admin-auth.ts`) for the named identifiers.
The endpoint owns the load-bearing order: insert and COMMIT the suppression
rows FIRST, then copy-and-delete (one atomic statement per table moves each
affected row into quarantine as it is deleted or blanked), then amend saved
results (non-fail-soft: a failed amend is an error, never a silent
success). Deleting before the suppression commits would leave a window in
which an in-flight sweep batch re-inserts the row; the other way round the
race is harmless, because the committed suppression rows feed the storage
triggers. A request naming several identifiers gets one independent row per
identifier, inserted with jittered timestamps so the rows cannot be joined
back into one request. Never insert a suppression row by hand in `psql`:
the quarantine copy and the commit-then-delete order are exactly what a
hand-run skips.

**Un-suppress.** Operator-only, within 30 days of the removal: it deletes
the suppression row, then restores the quarantined rows. A copy whose
restore is refused (a sibling suppression still covers it) is KEPT and
reported; lift the blocking suppression and re-run. After the cleanup
cron's 30-day purge the quarantine copy is gone and there is nothing to
restore; the endpoint still allows the block itself to be lifted
(`acknowledgePurged`), which restores nothing and only re-opens future
collection, so the identity returns only as the pipelines rediscover it.

**Migration order.** The suppression migration runs against production
BEFORE its PR merges: the tables it creates are empty, and empty tables
mean no behavior change, so the code that reads them can merge onto a
database that already has them. After running it, add
`suppressed_identifiers` to both `READ_ONLY_TABLES` and `BACKUP_TABLES` in
`scripts/migrate-grant-readonly.ts` and run that with the owner URL: a
restore without the table would un-remove people, and with it plus the
triggers, restored identity rows re-suppress on their next write. The
quarantine table goes in NEITHER list; backing it up would extend the
stated 30-day retention.

## The PR protocol

1. Branch from `main`; never commit to `main`.
2. Open the PR with an explicit docs decision (the template asks; CI checks).
3. **Wait for Bugbot.** Findings arrive as `cursor[bot]` review comments. A
   `neutral` or `skipping` conclusion is **not** a pass: comment `bugbot run`
   to retrigger. Fix findings immediately and push; Bugbot re-reviews on push.
4. Merge (squash, delete branch) when Bugbot has passed and every check is
   green. Do not merge over a red Vercel preview without diagnosing it: the
   once-known benign cause (two concurrent preview builds starving each
   other’s build-time DB reads) is structurally closed, since preview builds
   no longer touch Neon (see `docs/CI.md`); if it still appears, stagger the
   pushes and report it.
5. `CHANGELOG.md` gets a dated entry; `PROJECT_OVERVIEW.md` when architecture,
   schema, endpoints, env vars or pricing moved; this file when posture moved.

## Standing constraints

Short form only; `CLAUDE.md` is the authority on each.

- Schema changes: hand-written idempotent SQL in `scripts/migrate-*.ts` against
  the direct (non-pooler) endpoint; `npm run db:push` refuses on purpose.
- New tables need the `sweep_runner` read grant or scheduled CI fails later
  (`scripts/migrate-grant-readonly.ts`).
- Published numbers: never type one; add it to `lib/public-figures.ts` and the
  figures registry in the same change.
- The agent surface has its own design authority: `docs/AGENT-SYSTEM.md`.
