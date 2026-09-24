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

## Posture, by pipeline

Only pipelines with a non-default posture get a row; the full cron roster
lives in `vercel.json` and the scheduled workflows, which stay the authority
on what runs when.

Each row carries the date of its own last posture change, and there is no
table-wide "as of" date. There was one until 2026-09-17, and it was a claim
nothing could keep true: no single change re-verifies every row, so the date
only moves when somebody remembers to move it. #247 is the proof. It added a
row dated 2026-09-09 under a heading that still read 2026-09-02, and nothing
anywhere could notice, because `docs-freshness.yml` gates `docs-site/` and
never looks at `docs/`.

`npx tsx --env-file=.env.local scripts/ops-status.ts` prints the live values
(every `ingest_state` row with its age, read-only); this file stays the index
of what each row means.

A `posture:*` row is a pipeline stating its own last outcome rather than
leaving one inferred, which is the more trustworthy of the two. The Farcaster
sweep publishes one, and it is the only row in the readout that can say a run
failed. Read every other age as evidence rather than proof of health: those
rows are cursors a pipeline writes on success, so a fresh age tells you the
last write landed and nothing about whether the run that wrote it then failed.
The Farcaster sweep is the worked example, and the reason that sentence is
here.

| Pipeline                         | State                                                     | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UD harvests (Mac, not GitHub)    | **running from Jake's Mac since 2026-09-23**              | GitHub's runner IPs have got 406 from the keyless UD profile endpoint since the evening of 2026-09-20, while the same names answer 200 from a home network in the same minute (checked 2026-09-21 and 2026-09-23), so waiting does not clear it. The domain harvest (twice daily) and the profile walk (weekly) run from launchd agents on the Mac (`scripts/ops/ud-harvest-local.sh`, installed by `scripts/ops/install-ud-harvest-agents.sh`) in a detached worktree at `~/.walletlink-harvest`, as `ud_harvester` from `~/.config/walletlink/ud-harvest.env`. The workflows keep dispatch only. Log: `~/Library/Logs/walletlink-ud-harvest.log`; a failed run posts a macOS notification. Progress is the `ud_domain_enum_*` checkpoints in `ingest_state`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| KYC-attested resync (weekly)     | running; no checkpoint by design                          | `cb-verified-sweep` fully resyncs `cb_verified_wallets` each Sunday, so it keeps no `ingest_state` row and never appears in `ops-status`; its health is the Actions run and the admin composition tile. Rows a complete walk did not see are deleted; a walk that dies mid-run deletes nothing (#340).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Farcaster sweep (monthly)        | **running; cleanup fixed and slice 3 settled 2026-09-17** | `--slice` covers a sixth of the network per month; every FID re-checked twice a year; revocation cleanup is range-bounded (#223). The 2026-09-02 run (slice 3 of 6) swept its whole span cleanly, 558k FIDs requested and 806k wallets upserted with zero failed calls, then exited 1 in cleanup (run 33621049583, 32 minutes). **The headers timeout was the symptom; the predicate was the cause.** As `wallet NOT IN (SELECT wallet FROM <seen table>)` the planner builds a correlated SubPlan and rescans a Materialize of all ~805k seen wallets per candidate row, over a sequential scan of `social_graph`, because no index covers `sources`, `fc_fid` or `last_updated_at`: measured estimated cost 74,563,713,792, or about 5.1M x 805k comparisons. No timeout would have saved it. The same predicate as `NOT EXISTS` with a correlated equality plans as a Parallel Hash Right Anti Join: cost 337,774, measured 2.8 seconds on the identical data. Fixed in `lib/farcaster-sweep.ts` and asserted, so 2026-10-02 onward cleans up normally. **Cleanup now also refuses an implausible clear count before writing anything**, because making the statement finish is what turns its latent modes live and it had never once finished (the only `--slice` run died in it; the runs that succeeded were `--incremental`, which never cleans up). Every older guard compares the sweep with itself, so none catch a deficient seen set: `expectedSeenCount` is the same run's `walletsUpserted`, `coveredRange` counts FIDs requested rather than found, and `fetchUserBatch` turns a 404 or a missing `users` key into an empty array without touching `failedCalls`. The ceiling is 1% of the seen set, against a measured revocation rate of 0.048%, so it sits twenty times above normal and still refuses the ~3% a batch-level outage would clear. It is checked before the UPDATE and keeps the seen table on refusal. **Slice 3 has been settled.** Cleanup is bounded to the slice's own FID span, so the 2026-10-02 run cleans slice 4 and slice 3's next turn would have been about 2027-03. Rather than leave it serving revoked accounts until then, the pass was run by hand on 2026-09-17 through the fixed code path, with that run's recorded `sweepStartedAt`, seen table, `walletsUpserted` and FID span, so every guard applied: **383 cleared, 372 husk rows deleted**, and the 127 MB seen table dropped, which is what cleanup does on success. Running it fifteen days late was safe by construction rather than by luck: cleanup only touches rows with `last_updated_at < sweepStartedAt`, and every writer sets `last_updated_at = now()`, so any row another pipeline had refreshed in the meantime excluded itself. If a slice dies in cleanup again, that is the recipe, and `countRevocationCandidates` gives the number before anything is written; the seen table survives a throw on purpose, so keep it until the corrective pass has run. Use a cutoff no later than the true `sweepStartedAt`: too early only skips rows, while too late can clear one that has since been refreshed. Two reasons nobody was told at the time: the workflow has no notification step, and **a slice writes no checkpoint by design**, so `farcaster_sweep_resume` is inert here and neither its age nor its cleared state says anything about whether the monthly run worked. That second half is now fixed: the sweep publishes `posture:farcaster_sweep` on every ending, so `ops-status.ts` shows what the last run actually did rather than leaving it inferred from a cursor's age. A failed cleanup reads as `CLEANUP FAILED` and names the seen table a corrective pass needs. The workflow still has no notification step, so a run conclusion is still worth reading, but the readout can no longer say nothing while a run is broken. |
| X-handle recovery backfill       | **complete** (2026-09-01, #221)                           | 912k FIDs, zero transport failures on the sweep; the X-resolution side left 165 handles on ordinary retry. Checkpoint cleared itself, which is the correct end state.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| X reachability cron (daily)      | **running; transitions recorded from 2026-09-18**         | Stamps `x_accounts.checked_at` on every check, changed or not, and the recheck scheduler reads that to decide what is stale. Its status flips still never touch `social_graph.last_updated_at`, so a watermark over that column alone cannot see them. **What changed on 2026-09-18:** until then nothing recorded that a status had moved at all. `status` was overwritten in place and `social_graph_history` does not cover this table, so the answer to "when did this handle stop being reachable" did not exist. `status_changed_at` and `previous_status` now advance only on a real transition (`IS DISTINCT FROM`, so a nullable state added later cannot drop one silently), while `checked_at` stays unconditional. Deliberately not backfilled: every existing row was written by the first pass, which observed no transition, and stamping a date there would have invented 474,140 transitions that never happened. NULL reads correctly as "no transition seen yet". This landed against a deadline: **rechecks begin 2026-10-01** and only 409 of 474,140 rows had been rechecked, so the first wave would have rewritten every flip since the first pass with nothing recording it. Same shape and same deadline as the `last_live_user_id` fix already recorded in that upsert's comments.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Right-to-removal suppression     | **stage 1 live** (2026-09-02, #237)                       | Shipped as one wave, never the trigger alone: the suppression list and triggers, the pre-flight filter in `lib/job-processor.ts`, the quarantine, the operator endpoint and the privacy-page rewording. The trigger alone would have blocked the negative record and moved re-collection from monthly to per-lookup. Any change-feed endpoint honors it from v1. Stage 2 (verified self-serve intake) is deliberately not built: stage 1 is email-only and operator-executed. The Inngest pipeline, which then ran every job over ten addresses, had none of the three job guards until 2026-09-24 (STA-43), and was retired the same day (STA-44): every job now runs in the worker, which carries all three. This is the blocker that cleared for tier C item 16, the change feed, which has not started. Runbook below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Lookup jobs: one pipeline        | **worker only since 2026-09-24** (STA-44)                 | Every lookup job runs in `processJobChunk` (`lib/job-processor.ts`): inline for ten addresses or fewer, otherwise kicked by the submit route through `after()`, then the `/api/jobs/worker` cron each minute; every pass takes slices of 3,000 while its budget lasts (next row). A job is claimed by one conditional UPDATE that sets `lookup_jobs.leased_until` to 330 seconds ahead, longer than any route that calls it can live (300), and mints `lease_token`; every later write matches that token, so a holder resumed after its lease ran out writes nothing, and every exit hands the lease back. A `processing` row with no lease was started before leases existed and is waited out for 330 seconds from its last write. `slice_attempts` counts claims since the last handback: each slice the platform kills halves the next one (3,000 down to 375), and the claim after the fifth fails the job, unbilled, with "Submit the list again." "Saved" means every row is there to finalize from: a restart the resume check decides (a full count with no rows, as an Inngest run in flight at the deploy leaves) is written to the row before the cap reads it. A job whose rows are all saved is never failed that way or by an error: finalize saves the finished rows before `chargeForJob`, and the cap and the catch hand such a job back to be finished from them. A job that was charged but never saved (an admin rerun of a billed job under a persistent error, or one charged by pre-lease code) is handed back until the cap, then failed with "Processing stopped after this lookup was charged. Contact help@walletlink.social for a rerun or a refund." and an error line in the logs (`stopped after its charge landed`): that job needs a rerun or a refund by hand. "Billed" means a `credit_ledger` row with this `job_id` and `paid_from <> 'unlock'`, bound as a parameter. History is saved once per job (`lookup_history.job_id` is unique); a later pass that gates differently corrects the stored gate (ON CONFLICT DO UPDATE of `matches_delivered` only). The job's history save is fenced on the claim in the same statement (`INSERT ... SELECT ... WHERE EXISTS` the job under this token, still processing, `FOR SHARE`); a save that writes nothing re-reads the lease and raises `LeaseLostError` when it is gone. Admin retry and rerun detach the previous saved lookup (`job_id` set to NULL) after resetting the job, so the rerun saves a fresh copy: the fence's row lock makes the reset wait for any save the old attempt has in flight, and the detach then sees it; an unlock of the job then clears the gate on the rerun's copy only, and a gated earlier copy stays locked. A finalize that runs twice still adds one to `social_graph.lookup_count` twice (known, not fixed here). The admin's retry, rerun and cancel reset `slice_attempts` and clear the lease and token. The ENS pass stops starting batches 120 seconds into a slice, or at the pass budget if sooner (next row). Needs `scripts/migrate-job-lease.ts` (three columns and the history index) before the deploy; the code fails every job path without them. `app/api/inngest/route.ts` stays, registering no functions, so runs started before the deploy end cleanly. Once the Inngest dashboard shows no active runs, that route, `inngest/client.ts`, the `inngest` package and the `INNGEST_*` variables can go. Verify: no row is `processing` with a free lease and an `updated_at` more than ten minutes old, no running job has `slice_attempts` above 2 for long (a run of kills: look at the upstreams), and a job over ten addresses shows progress within seconds of submission.                                                                                                                                                  |
| Lookup jobs: slices per pass     | **one pass, many slices** (2026-09-25, STA-44)            | `processJobChunk` takes slice after slice of one job (`processJobSlice`, 3,000 wallets each) while `INVOCATION_BUDGET_MS` (240 s) lasts, in the submit route's `after()` kick and in each cron tick, so a fast scan of 10,000 finishes in the pass that started it (about four minutes before, at one slice a tick). The budget sits a minute inside the 300-second routes, and so under the 330-second lease, for a request a live source already has in flight, the save or finalize, and the route's own work before the loop. A pass stops before a slice that, at the last slice's length, would end past the budget, and stops on a finished job, a busy or lost claim, an error (even one handed back unfailed) or a slice that saved nothing; the cron continues what is left. Each slice claims the job afresh (a new token, one attempt) and hands it back, so the fence, the attempt cap, save-before-charge, the once-per-job history save and the suppression read all hold per slice. The live sources stop starting work at the pass deadline: ENS at the earlier of 120 seconds from its slice's claim and the deadline (`ensDeadlineFor`), Web3Bio at the earlier of its batch ceiling and the deadline (`waveDeadline`). A wallet they left because the pass deadline came first is never saved as done: the slice saves only up to the first such wallet (`reachedPrefix`) and the next claim asks the rest; one left at a source's own ceiling is recorded as failed as before, never cached or stored as a negative. A pass can hold a large deep job for up to four minutes, so overlapping ticks can have more large deep jobs in flight at once than before: if Web3Bio or Neynar failures rise in `api_metrics` after the deploy, look there first. No migration. Verify: a fast scan of 10,000 addresses has `completed_at` within a minute of `created_at`, and a large deep job moves more than 3,000 addresses a tick with `slice_attempts` at 0 or 1.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Homepage “Recent activity” strip | known artifact, deliberately kept                         | The refresh-stale cron shows as activity because `hidden` defaults false; ruled on and left. Do not “fix” it in passing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Neynar budget counter            | running; trust with care                                  | The counter in `ingest_state` bounds background work; check `updated_at` before trusting it, since it is a self-tracked floor. What the counter does and does not bound is recorded in walletlink-ops.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Basenames harvest (Base L2)      | **running since 2026-09-02; backfilled**                  | The one-time backfill is a CLI run, and the daily incremental (05:20 UTC, scheduled in `vercel.json` and listed on the dependency panel) refuses to run until it has left a checkpoint, the same shape as the ENS harvest. **The backfill has run**, so a red cron here is no longer the design working: it is a real failure. The route returns its "run the backfill first" message only when the checkpoint row is missing (`app/api/cron/basenames-harvest/route.ts:46`), a 502 means a run scanned blocks and left the checkpoint where it was (`:105`), and a day with nothing to scan answers 200 with "Already at the chain head" (`:71`). The checkpoint trails the head by a 300-block reorg buffer, so read `basename_record_harvest.lastBlock` against the chain head rather than reading the link count: this corpus takes a couple of hundred records a month and a quiet day is ordinary. Two filters carry the correctness of every row, and only one of them is anchored: the expiry filter has four assertions in `scripts/check-invariants.ts`, so deleting it fails CI, while the registry re-read has none and is the one that fails silently. Expired names keep resolving on this registry, so a name past `nameExpires` must be dropped or the row is about whoever buys the name next (measured at 44.5% of a 500-name sample). Read `expired` and `expiryUnreadable` as different things: the first is the filter working, the second means the registrar answer could not be read at all, which is a broken run rather than a lapsed name. And the handle is re-read through the registry rather than taken from the log, because a name moved between the two resolvers still has an old write in the logs of the one it left (5.0% of sampled nodes). A run that suddenly gets much cheaper or much larger is the signal that one of the two stopped applying.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Creator-profile sweep (Zora)     | **new 2026-09-02; budgeted**                              | A scheduled workflow with a request budget and a cursor in `ingest_state`, not a cron route: the upstream limit is about one request a second, so a meaningful pass is tens of minutes and would be cut off by the 300-second function ceiling. Nothing upstream reports the budget: there is no `Retry-After` and no rate-limit header on any response, so the pacing is self-imposed and a 429 is a hard back-off rather than a retry. Two failure signatures do not mean what they look like. A 504 on some list types is a gateway timeout, not a limit, so backing off does not help (those list types have since answered 200; they stay excluded because they are ranked leaderboards, not because of the status). And the edge blocks some default HTTP client user agents outright, which arrives as a 403 and reads exactly like an empty corpus, so smoke-test the client before trusting a zero.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Coverage materializer (daily)    | **new 2026-09-01; no heartbeat**                          | `/api/cron/refresh-coverage` (04:30 UTC) writes the `/v1/stats` counts into `ingest_state` (`v1_stats_coverage`, `lib/coverage-stats.ts`). It has no row in the admin health pane, so a silent death shows up only as an aging `meta.as_of` on `/v1/stats`. The read self-primes: the first call after a deploy with no row pays one full aggregate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Daily social pipeline            | **new 2026-09-09**                                        | One standalone post per platform per day, media on every post. X: scheduled in Typefully (17:00 UTC) with card PNGs downloaded from `/social-card/[slug]` at scheduling time. Farcaster: the `daily-cast` workflow (17:35 UTC) casts from `content/social/queue.json` with the live card URL embedded; idempotent via `ingest_state` (`daily_cast_state`), budget-guarded like every Neynar cron, and loud from three days out when the queue runs low. The queue changes only by PR, and `check:social` (in preflight) enforces lengths, CTAs, house style and the figures allowlist. Cards render figures at request time; a hand-typed figure in `lib/social-cards.tsx` fails the checker. Refill by extending the queue and registry in one PR.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| OAuth access-token cleanup       | **new 2026-09-24; deletes nothing before 2027-09-29**     | A branch of the daily `/api/cron/cleanup` (04:00 UTC) deletes an OAuth access token's `api_keys` row `OAUTH_TOKEN_RETENTION_DAYS` (400) after it stopped working, fenced by `oauth_grant_id` and the `wts_mcp_` prefix, up to 2,000 rows a run. The delete cascades to `api_usage`, `rate_limit_buckets` and `idempotency_keys`. The run's JSON reports `oauthAccessTokens`: `0` means it ran and nothing was due, `null` means the branch failed and the reason is in the function log. Every foreign key on `api_keys` was `ON DELETE CASCADE` on 2026-09-24 (3 of 3); a `NO ACTION` key added later would turn every run into a silent `null`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Retention cleanup (STA-45)       | **new 2026-09-25; lot and Stripe-id purge OFF**           | Five branches of the daily `/api/cron/cleanup` (04:00 UTC), each in its own try and sharing one 30-second budget (`RETENTION_BUDGET_MS`), before the housekeeping tail. The cache had 498,075 expired rows of 616,026 on 2026-09-25, so the first runs drain it 5,000 rows a statement until the budget is spent; `walletCacheRows` in the run's JSON should fall to a steady daily figure within a few runs. The other dry-run counts that day: 51 of 64 API rate-limit buckets, and nothing in `api_usage` (72 rows), `credit_ledger` (35), `credit_lots` (101) or the Stripe ids on `users` (1). `purchaseRecords` counts lots and Stripe ids past seven years and deletes nothing while `PURCHASE_RECORD_PURGE_ENABLED` is false (pinned by an invariant): `purged: false` with a non-zero count, no earlier than August 2033, is the day that decision is due. Every field is `null` when its branch failed; the reason is in the function log. **After deploy, run** `scripts/migrate-clear-session-user-agents.ts --commit` once (10 sessions held a user agent on 2026-09-25).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Sanctions screening (STA-41)     | **new 2026-09-25; migrations before merge**               | `/api/cron/sanctions-refresh` (every 6 hours, at :15 UTC) rebuilds `sanctioned_addresses` from OFAC’s SDN.XML and then re-checks every past x402 payer; the buy route screens each payer before verify. Measured on 2026-09-25: the file is 29,089,607 bytes, downloaded in about 4 s and parsed in under 0.1 s, and the 2026-09-23 publication holds 124 EVM addresses. The list’s publish date and last successful refresh are the `sanctions_list` row of `ingest_state`, so `ops-status` prints them. A freeze (read from the database, once per account and listed payer), a guard refusal, and 36 hours without a successful refresh each email help@ at most once a day per condition (claims are `alert:sanctions:*` rows of `ingest_state`; a download or parse failure is emailed only through the 36-hour alert); the admin health panel shows the same: the “Sanctions list refresh” row goes `late` after 36 hours without a success and `failing` when the latest run was refused or could not download, and a freeze in the last 30 days turns the panel red. USDC sales answer 503 once the last success is 7 days old. Runbook below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

## The daily cleanup: what it deletes

`/api/cron/cleanup` (04:00 UTC, `vercel.json`) owns every period the privacy
page states. The periods are constants in `app/api/cron/cleanup/route.ts`
unless noted, exported so the page can import them rather than restate them;
`scripts/check-invariants.ts` checks that the page does, for each period it
states.

| What                               | Kept for                                                                | Constant or function                                 |
| ---------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------- |
| Removal quarantine copies          | Until `purge_after` (30 days), then deleted first                       | per row, `lib/removal-admin.ts`                      |
| Job payloads                       | 30 days; the job row and its counts stay                                | `JOB_PAYLOAD_RETENTION_DAYS`                         |
| OAuth access-token rows            | 400 days after they stop working, with their usage rows                 | `OAUTH_TOKEN_RETENTION_DAYS`                         |
| API request records (`api_usage`)  | 13 months                                                               | `API_USAGE_RETENTION_MONTHS`                         |
| API rate-limit buckets             | 2 days after the minute, day or month they count has ended              | `API_BUCKET_RETENTION_DAYS`                          |
| Credit ledger rows                 | 7 years, and longer while a live lot or a running or gated job reads it | `PAYMENT_RECORD_RETENTION_YEARS`, `lib/retention.ts` |
| Credit lots, Stripe ids on `users` | 7 years; the purge is written, counted and switched off                 | `PURCHASE_RECORD_PURGE_ENABLED`                      |
| Sanctions screening records        | 5 years                                                                 | `SANCTIONS_SCREENING_RETENTION_YEARS`                |
| Wallet cache rows                  | 7 days                                                                  | `CACHE_TTL_HOURS`, `lib/cache-constants.ts`          |
| Sessions                           | Until they expire                                                       | `cleanupExpiredAuth`, `lib/auth.ts`                  |
| Magic-link tokens                  | 24 hours                                                                | `MAGIC_LINK_RETENTION_HOURS`, `lib/auth.ts`          |
| IP rate-limit buckets              | 24 hours                                                                | `IP_BUCKET_RETENTION_HOURS`                          |
| OAuth authorization requests       | Until they expire                                                       | `cleanupAuthorizationRequests`                       |
| Abandoned X list jobs and claims   | Their member list, verifier or signature goes; the row stays            | `cleanupAbandonedListJobs`, `cleanupAbandonedClaims` |
| Batch replay rows                  | 24 hours                                                                | `IDEMPOTENCY_TTL_HOURS`, `lib/idempotency.ts`        |
| Analytics events                   | 400 days                                                                | `ANALYTICS_RETENTION_DAYS`                           |
| Lifecycle email records            | While the account exists (they stop a second send)                      | none, `ON DELETE CASCADE`                            |
| Saved lookups                      | Until the owner deletes them                                            | none                                                 |

**Why the lot purge is off.** A `credit_lots` row is more than a record: its
payment id is the key that keeps a repeated grant for the same payment a
no-op, the x402 loyalty count counts every settled lot a wallet bought, and
the lifecycle mail reads a paid lot as "has bought". `users.stripe_payment_id`
is the same kind of key for the legacy tier. Each needs a home that outlives
the lot before `PURCHASE_RECORD_PURGE_ENABLED` can be true; the first row is
not seven years old until August 2033.

**Log lines.** Every line the Node runtime prints goes through `redact`
(`lib/redact.ts`, installed by `instrumentation.ts`): an email keeps its first
letters and its domain, a wallet its first 6 and last 4 characters. A
transaction hash or an EIP-3009 nonce (64 hex digits) is left whole. So the
`[x402] SETTLED BUT NOT GRANTED` line shows the payer masked; rebuild the full
settlement id (`eip155:8453:<payer>:<nonce>`) from the transaction it names,
or from the reference the buyer was given in the 500.

## Revenue outreach runner

As of September 21, 2026, the owner approved all three reviewed pilot sequences
and enabled the local worker. One initial prospect message is verified sent;
the remaining two wait behind the 15-minute spacing rule. Follow-ups stop on
replies and are capped at two. The operator runbook is [OUTREACH.md](OUTREACH.md).
Gmail authorization, restricted account exclusions and lost-response recovery
are verified. Delivery and reply checks passed against the operator's mailbox;
live bounce behavior remains unverified, with automated coverage in place.
The worker runs under local macOS supervision and depends on the Mac being
awake, logged in and online. Runtime prospects and credentials stay private.
Existing Resend lifecycle campaigns are unchanged.

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
results and the API retry copies, then withdraw the claim record
(non-fail-soft throughout: a failed step is an error, never a silent
success). Deleting before the suppression commits would leave a window in
which an in-flight sweep batch re-inserts the row; the other way round the
race is harmless, because the committed suppression rows feed the storage
triggers. A request naming several identifiers gets one independent row per
identifier, inserted with jittered timestamps so the rows cannot be joined
back into one request. Never insert a suppression row by hand in `psql`:
the quarantine copy and the commit-then-delete order are exactly what a
hand-run skips.

**What the erase reaches beyond the index** (STA-46, 2026-09-25). Two
copies of a mapping sat outside it until then:

- **API retry copies.** A `POST /v1/batch` sent with an `Idempotency-Key`
  stores its response for 24 hours, and a resend replays it. The removal
  rewrites every stored response that names the identifier
  (`idempotency_keys` in the step list), and every replay is also filtered
  against the live suppression list before it is served, which covers a
  request that was in flight across the erase. The copies are rewritten,
  never deleted: a deleted key turns the customer's retry into a fresh
  request, and a fresh request bills again. Never "clean up" by deleting
  rows from that table.
- **The claim record.** An X account and wallet paired on `/claim` live in
  `identity_attestations`. A removal of the wallet or of the X handle marks
  every claim row naming it `withdrawn` and clears the handle, account id,
  signature and any pending authorization, the same statement a signed
  withdrawal on the claim page runs (both lanes call `eraseIdentifier`).
  It is the erase's LAST step, so a failed run leaves the claim intact for
  the re-run. Completed claims are quarantined and come back on
  un-suppress, unless a sibling suppression still covers the wallet or the
  handle, in which case the copy is kept and reported like any other. A
  claim that was mid-authorization when the handle was removed is refused
  at the callback.

**After a backup restore, keep today's suppression list.** The nightly dump
carries `suppressed_identifiers`, so a restore can bring back an older list
and, with it, rows for people who asked to be removed after the backup was
taken. Export today's list BEFORE restoring, put it back over the
backup's afterwards, then re-run the erase for every identifier on it (the
endpoint is idempotent). The exact commands are in the restore section of
the private ops runbook (starl3xx/walletlink-ops, `docs/SECURITY.md`),
beside the restore they belong to.

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

## Sanctions screening: the operator runbook (STA-41)

What runs, decided 2026-09-25:

- **The screen.** `/api/x402/buy` checks the paying wallet the moment it is
  decoded, before the lot read, verify and settle (`lib/sanctions.ts`). The
  payer that is screened is the payer that pays: a payload that is not a
  plain EIP-3009 authorization from an EVM address gets 400 `INVALID_PAYMENT`
  first, and after verify the verified payer must equal the screened one or
  the sale gets 402 before settle. A listed payer gets 403
  `SANCTIONED_PAYER`; a missing list, a list whose last successful refresh is
  7 days old (`SANCTIONS_REFUSE_AFTER_DAYS`), or a screen that cannot run
  gets 503 `SCREENING_UNAVAILABLE`. No money moves on any of them.
- **The record.** `sanctions_screenings`, kept 5 years. A refusal is written
  before verify, one row per payer, verdict and UTC hour, with `attempts`
  counting the tries and `verify_reached` false: the payer was named by the
  request, never proven. A `clear` row is written after verify passes and
  before settle, `verify_reached` true, and a sale whose row cannot be
  written is refused with 503.
- **The refresh.** Every 6 hours. It refuses an empty parse, an older
  publication, and a list more than 20% smaller than the one in force
  (`SANCTIONS_MAX_DROP`), and keeps the old list. Then it re-checks every past
  x402 payer against the list in force, refused run or not.
- **The freeze.** An account a listed wallet paid for (its own wallet account,
  or the account a top-up from that wallet credited) gets `users.frozen_at`
  and a `frozen_reason` naming every listed payer and the list date, and
  every active key is deactivated. From then on (`lib/account-freeze.ts` has
  the full list): its keys are refused even if one is minted later; it has no
  paid entitlement (`hasPaidAccess`), and reverse lookups, X lists, Farcaster
  DMs, contract import and saved-lookup merges answer 403 `ACCOUNT_SUSPENDED`
  with no offer to buy; it can start no lookup or unlock, again with no offer
  to buy; a job or call in flight when the freeze lands draws nothing, and
  the job fails with its results cleared (one charged on an earlier pass is
  emailed for a refund decision); key recovery, a top-up with its key, a
  USDC buy into it and a signed-in card checkout all answer the buy route’s
  403, the USDC buy only after verify has proven the payer. Nothing is
  refunded by code.
- **The alerts.** Email to help@ (`sendOpsAlert` in `lib/email.ts`, which
  gives up after 10 seconds), at most once per condition per 24 hours. Each
  condition is an `alert:sanctions:<condition>` row of `ingest_state`; all the
  conditions of one email are claimed in one statement (`claimedAt`), and a
  send that works turns the claim into a sent marker (`sentAt`). A claim with
  no sent marker that is older than 5 minutes belongs to a run that died, and
  counts as unclaimed. What is emailed:
  - **a freeze**, read from the database: every frozen account’s listed
    payer that no email has reported yet (condition
    `freeze:<account>:<payer>`), with the account id, the matched address,
    the SDN entry uid and the date of the list in force. The sent marker is
    permanent, so each pair is reported once, including a second payer
    listed months later and a freeze whose first email failed;
  - **a guard refusal** (`refused`: empty, older or sharply smaller), at
    once;
  - **no successful refresh for 36 hours, or no list** (`stale`). A download
    or parse failure is not emailed by itself: it shows at once as `failing`
    on the health panel and reaches the inbox only through this 36-hour
    alert;
  - **a payment that settled from a wallet other than the one screened**
    (`settled-payer:<settlement>`), as soon as the credits are granted (the
    log line comes at once, and the email never holds up the grant);
  - **a card payment that landed on a frozen account** (`frozen-payment:<id>`),
    at once;
  - **a job charged before its account was frozen** (`frozen-job:<job>`),
    when finalize fails it.
    The last three carry their content in the row, written before the first
    send, so they are durable records: the refresh and the daily cleanup
    resend any that has no sent marker (`sendUnsentAlertRecords`).
    The refresh sends them after its own writes, and the daily cleanup runs
    every check too, after its housekeeping, in case the refresh stops
    running. A failed or timed-out send is logged (`[sanctions] alert email
failed`) and its claim released, so the next run sends it again; it never
    blocks or undoes a freeze, a refusal or a payment.
- **The geoblock.** Both checkouts refuse a request whose Vercel IP headers
  place it in `RESTRICTED_CHECKOUT_LOCATIONS` (`lib/geoblock.ts`) with 403
  `REGION_RESTRICTED`. The lawyer may change that list (Linear STA-49); it is
  the only place it lives. The location is the one Vercel reports for the
  request’s IP.

**Before merge.** Run `scripts/migrate-sanctions-screening.ts` with the owner
`DATABASE_URL` on the direct endpoint. It adds the two tables and the two
`users` columns, then seeds the list with one download, so the rail sells from
the moment the code deploys. The seed freezes nobody: the first scheduled
refresh after deploy does, with the enforcement live and the email sent. Then run `scripts/migrate-grant-readonly.ts`, so
the nightly dump can read `sanctions_screenings`. Merging first is an outage:
every API key check reads `users.frozen_at`.

**After deploy.** The first scheduled refresh is at the next :15 of a
six-hour mark. Its run shows on the health panel; an unpaid `POST
/api/x402/buy` still answers 402.

**The refresh alert.** A guard refusal is emailed at once, with its reason. A
download or parse failure is not: it shows as `failing` on the health panel
at once and is emailed only as the 36-hour stale alert, which does not carry
the reason. For either, the function log carries a `[sanctions]` line for
every run that did not update the list:

- a download error: OFAC or the network. The next run retries; nothing to do
  unless it persists toward the 7 days.
- `download or parse failed` with a parse message: the file changed shape or
  arrived cut short. Look at the file before anything else.
- `sharp_drop`: the parse is more than 20% smaller. Check OFAC’s recent
  actions for a delisting of that size. If it is real, accept it by calling
  the route with the cron secret and `?acceptCount=<the parsed count>`; any
  other count is still refused.
- `older_publication`: the download is older than the list in force. Wait
  for the next run.

USDC sales stop 7 days after the last success. That is the deadline for a fix,
and the 36-hour alert is there to leave most of it.

**A payer refused with 403.** No money moved and the screening row records
it. Whether a refused attempt must be reported, and to whom, is a question
for the lawyer (Linear STA-49).

**A freeze (a buyer listed after they paid).** An email to help@ names each
account id, matched address and SDN entry uid; the log line reads
`[sanctions] ALERT: froze N account(s)`, and the health panel turns red.

1. Do not refund, and do not move the USDC those purchases paid: it may be
   property that must be held. Do not lift the freeze.
2. Read the accounts, read-only:
   `SELECT id, frozen_at, frozen_reason FROM users WHERE frozen_at IS NOT NULL`.
   The reason names every listed payer and the list date; a payer listed
   later is in its own email. The purchases are the `credit_lots` rows whose
   `settlement_id` names one of those payers.
3. Tell the lawyer the same day (Linear STA-49). The reporting duty, its
   deadline and who files are theirs to confirm, and the clock may be short.
4. Leave the account frozen until the lawyer says otherwise. To lift it
   on their advice, run
   `scripts/sanctions-lift-freeze.ts --account <id> --note "<who advised it, and why>"`
   (owner `DATABASE_URL`) to see it, then again with `--commit`. It records
   every listed payer the account has now in `sanctions_freeze_releases` and
   clears `frozen_at`, in one statement, so the next refresh does not freeze
   the account again for those payers. A payer listed after the lift still
   freezes the account and is emailed. Keys stay off; the account makes a new
   one. Never lift a freeze by editing `frozen_at` by hand: the next refresh
   would freeze it again, without an email.

**A card payment for a frozen account.** The email names the account and the
Stripe payment. The payment was granted as usual, so its record is kept and
the credits are held. Decide on a refund with the lawyer (Linear STA-49); do
not lift the freeze.

**A payment settled from a wallet other than the one screened.** The email
names the settlement, the transaction and both wallets. The money has moved.
Check the settled payer against `sanctioned_addresses` at once; if it is
listed, follow the freeze steps above.

**A job charged before its account was frozen.** The email names the account
and the job. The job was failed and its results cleared; the charge stands.
Decide on a refund of that charge with the lawyer (Linear STA-49); do not
lift the freeze.

## The PR protocol

1. Branch from `main`; never commit to `main`.
2. Open the PR with an explicit docs decision (the template asks; CI checks).
3. **Run `npm run pr:status <n>` instead of reading the checkmarks.** It
   exits non-zero and says why, and it asks the two questions the PR page
   answers wrongly. Do not merge on a green row you have only looked at.
4. **Wait for Bugbot.** Findings arrive as `cursor[bot]` review comments. A
   `neutral` or `skipping` conclusion is **not** a pass: comment `bugbot run`
   to retrigger. Fix findings immediately and push; Bugbot re-reviews on push.

   `skipping` is what the UI renders for `neutral`, and Bugbot emits it both
   when it found nothing and when it found plenty. The count lives only in the
   check run's own summary. On 2026-09-19 eleven real defects arrived behind
   that label across four PRs, among them a follower count left on the row of
   somebody who had asked to be removed, and a suppression trigger that would
   have preserved a live third-party token for exactly that person.
   `pr:status` reads the summary; by hand it is
   `gh api repos/{owner}/{repo}/commits/<sha>/check-runs`.

   **Dependabot PRs: review and merge the copy, not the original.** Bugbot
   answers a PR it did not see starl3xx open with "GitHub account mismatch",
   and a PR Dependabot opens gets no repository secrets. The
   `dependabot-copy` workflow opens each one again from branch
   `deps/copy/<dependabot branch>` with starl3xx's token, and moves that branch
   on every Dependabot push, so the copy is never rebased by hand. Run this
   protocol on the copy; Dependabot closes its own PR once the update is on
   `main`. The token expires a year after 2026-09-24 (Linear STA-42).

5. **Checks MISSING is a merge conflict until proven otherwise.** GitHub runs
   `pull_request` workflows against the computed merge commit, so a
   `CONFLICTING` PR triggers nothing at all: no queued run, no failed run, and
   the checks still shown are whatever ran on an older head, all green and all
   describing code that is no longer there.

   This presents as an Actions outage, convincingly. These workflows are
   `pull_request`-triggered, so merges to `main` correctly produce no runs
   either, and with one open conflicting PR the whole repository looks dead
   including its schedules. On 2026-09-19 that cost an hour and a confident
   wrong report that Actions was down. The first call is
   `gh pr view <n> --json mergeable`, not Actions permissions or billing.

   Resolve it by merging the base branch **in**. A rebase needs a force-push.

   **The usual cause is `CHANGELOG.md`.** Every PR adds an entry at the top of
   it, so any two open PRs edit the same region and the second to merge
   conflicts, on the one file whose resolution is never in doubt. That
   guaranteed conflict is what switches the gates above off, on every second
   PR.

   **`merge=union` was tried for this on 2026-09-21 and removed the same day.**
   Do not re-add it; `.gitattributes` holds the full account. Measured on the
   three PRs that followed it:
   - **It did not stop GitHub marking a PR CONFLICTING.** #342 and #347 both
     went conflicting with the driver on `main`. Mergeability is computed on
     GitHub's servers and does not read `.gitattributes`, so the dangerous half
     was untouched.
   - **Locally it applied only from the second merge onward**, because git
     reads attributes from the branch being merged INTO and the first merge is
     the one delivering the file.
   - **And it broke `format`, unfixably.** Union concatenates both sides'
     lines, so two entries meet with no blank line before the next heading and
     Prettier fails. Running `npm run format` does not help: GitHub recomputes
     the merge for `refs/pull/<n>/merge`, which is what CI checks out, and
     union re-applies there and drops the blank line again. A branch can pass
     `prettier --check` locally and fail CI on the same commit, with no edit
     available that survives.

   So resolve `CHANGELOG.md` by hand, once per branch. It takes seconds and an
   unfixable red does not. What protects against merging a stale-green PR is
   branch protection and `pr:status`, not a merge driver.

   The real fix is not putting every PR's entry at the top of one file: a
   `changelog.d/` directory, one file per change, assembled on release, has no
   shared region to conflict over. That is a change to a documented workflow
   rather than a line in a config, so it is written down rather than done.

6. **A merged PR is not a checked commit, and nothing checks `main`.** Every
   gate here is `pull_request`-only, so what CI tested was the computed merge
   commit, never the squash that actually landed, and `main` has no branch
   protection, so it is exactly as verified as whoever merged chose to be.

   `main-guard.yml` runs `npm run preflight` on every push to `main` for that
   reason. It cannot block a bad landing, it announces one: a red there means
   something reached `main` unchecked, and **every open PR is now failing a
   gate for a reason that is not theirs.** Fix it on `main` first, before
   telling an author their red is their diff.

   That is not hypothetical. On 2026-09-21 `docs/OPERATIONS.md` reached `main`
   unformatted, and `format.yml` runs `prettier --check .` over the whole
   repository, so it failed on PRs that had touched no markdown at all.

7. Merge (squash, delete branch) when Bugbot has passed and every check is
   green. Do not merge over a red Vercel preview without diagnosing it: the
   once-known benign cause (two concurrent preview builds starving each
   other’s build-time DB reads) is structurally closed, since preview builds
   no longer touch Neon (see `docs/CI.md`); if it still appears, stagger the
   pushes and report it.

   **`gh pr merge` from a worktree fails after the merge, not before it.** It
   tries to check the base branch out locally on the way to deleting the
   branch, and `main` is already checked out in the root working copy, so it
   exits on `fatal: 'main' is already used by worktree`. The merge itself has
   already happened at that point. Confirm with
   `gh pr view <n> --json state,mergedAt` rather than re-running it, and note
   the remote branch is left behind: `git push origin --delete <branch>`.

   **Merge siblings one at a time and re-check the second.** Merging the first
   moves `main`, which leaves the second behind it. A PR that is behind is
   still shown with the checks it passed against the older base, so bring
   `main` in, let CI and Bugbot run again, and read `pr:status` on the new head
   before merging it.

8. `CHANGELOG.md` gets a dated entry; `PROJECT_OVERVIEW.md` when architecture,
   schema, endpoints, env vars or pricing moved; this file when posture moved.

## Branch protection on `main`

Enabled 2026-09-21. Until then every rule above was a habit: nothing required a
check to pass, nothing required a branch to be current, and nothing stopped a
direct push. It is a repository setting rather than a file, so it cannot be
read out of the repo; this section is the record of what is set and why.

- **Required checks: `format`, `invariants`, `guard`.** Only three, and the
  reason is a footgun rather than modesty. A required check that does not run
  leaves a PR pending forever, and most gates here are path-filtered:
  `design-tokens` (`palette`, `og-palette`, `design-language`, `contrast`,
  `control-height`), `house-style`, `figures` and the social-queue check all
  trigger on paths, and `docs-freshness` skips its jobs outright. Requiring any
  of those would deadlock the first PR that legitimately did not touch their
  paths. These three run on every pull request and never skip.
- **Require branches to be up to date (`strict`).** This is the one that closes
  the hole steps 5 and 6 describe: a branch behind `main` can no longer be
  merged on checks that passed against an older base.
- **Force pushes and deletions are refused**, which makes the never-force-push
  rule structural rather than remembered.
- **Admins are not enforced**, deliberately. This is a solo repository and
  locking the owner out of their own emergency is a worse failure than the one
  being prevented. It means protection is a guard rail, not a wall: a red
  `figures` still needs a human to decline to merge, because it cannot be
  required without the deadlock above.
- **Reviews are not required**, for the same reason: there is no second
  reviewer, and requiring one would stop all work.

Two settings deliberately left off, both defensible to turn on later:
`required_conversation_resolution`, which would force Bugbot's review comments
to be resolved rather than merely read, and `required_linear_history`, which
the squash-merge habit already produces.

## The security contact

`/.well-known/security.txt` (RFC 9116) and the root `SECURITY.md` publish where a
vulnerability report goes. Both read from `lib/security-contact.ts`, and
`scripts/check-invariants.ts` checks one against the other. Two Contacts, in
order, because RFC 9116 makes the first one preferred:

1. GitHub private vulnerability reporting (PVR),
   `https://github.com/starl3xx/wallet-to-social/security/advisories/new`;
2. `security@walletlink.social`, an alias on the Workspace user who reads help@.

Two of the facts behind them are settings, not files, so this is their record:

- **Private vulnerability reporting: NOT enabled as of 2026-09-24.** Enabling it
  is Jake's step, and it comes before security.txt ships, because the report
  form opens for nobody but admins while PVR is off. The command is
  `gh api -X PUT repos/starl3xx/wallet-to-social/private-vulnerability-reporting`
  (expect 204), and `gh api repos/starl3xx/wallet-to-social/private-vulnerability-reporting --jq .enabled`
  confirms it. When it is on, replace this line with the date it was enabled.
- **The security@ alias** exists only in Google Workspace. No file shows it.

`.github/workflows/security-contact.yml` checks both every Monday against
production, plus the one thing the invariants deliberately do not read: the
clock. It fails when Expires is 30 days away or less, when PVR is off, or when
the policy page says "No security policy detected". Local repro:
`GITHUB_TOKEN=$(gh auth token) node scripts/check-security-contact.mjs`.

**Renewal**, when that workflow goes red on Expires, or at any time before:

1. From a mailbox outside walletlink.social, send a test to security@ and to
   help@. Confirm both arrive and neither lands in spam. Reply from Workspace
   and confirm the reply passes DMARC. Also send to a nonsense local part: if
   that arrives too, a catch-all exists and the test proves less than it looks.
2. Confirm PVR is still enabled (the `--jq .enabled` command above).
3. In `lib/security-contact.ts`, set `SECURITY_CONTACT_VERIFIED` to the day the
   test passed, then `SECURITY_TXT_EXPIRES` to about six months later. The
   invariants require Expires to fall after the verified day and less than 365
   days after it; they never compare it with today.
4. Ship it through a normal PR. The route is static, so the new date is live
   with the deploy that carries it.

Never move the date without the test. An expired file is ignored silently, and
RFC 9116 prefers no file to one whose contacts no longer work.

## Standing constraints

Short form only; `CLAUDE.md` is the authority on each.

- Schema changes: hand-written idempotent SQL in `scripts/migrate-*.ts` against
  the direct (non-pooler) endpoint; `npm run db:push` refuses on purpose.
- New tables need the `sweep_runner` read grant or scheduled CI fails later
  (`scripts/migrate-grant-readonly.ts`).
- Published numbers: never type one; add it to `lib/public-figures.ts` and the
  figures registry in the same change.
- The agent surface has its own design authority: `docs/AGENT-SYSTEM.md`.
- security.txt expires. Renew it only after re-testing both channels; see "The
  security contact" above.

## Landing graph hero (2026-09-20)

Implemented locally; deployment is still pending. The production landing component
uses `/api/hero`, with a materialized `ingest_state` row named
`landing_identity_hero_v1`. The local configured database has been bootstrapped.
For another database, run `npx tsx --env-file=.env.local scripts/refresh-landing-hero.ts`
once before launch. This only replaces that snapshot; it does not mutate graph
records or run paid wallet lookups.

The Vercel schedule refreshes daily at 09:20 UTC after deployment. Configure the
existing `CRON_SECRET` in the deployment environment; missing or wrong credentials
return 401 (local `.env.local` currently has no cron secret). Portrait refresh uses
the existing X resolver configuration. A failed graph refresh returns 503 and
preserves the previous dated snapshot. Seven days without a successful refresh
makes the read endpoint unavailable; the upload flow remains usable. Public reads
check current suppression entries and fail closed on suppression-read failures.

Manual checks: `npx tsx scripts/check-identity-hero.ts`, `npm run typecheck`,
`VERCEL_ENV=preview npm run build`. Inspect `/api/hero` for `checkedAt`, account
counts and sample eligibility. Avoid adding static public identity JSON fallbacks;
they bypass removal checks. Historical mockups are local research artifacts and are not shipped.
