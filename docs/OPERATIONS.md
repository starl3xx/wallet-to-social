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

## Posture, by pipeline (as of 2026-09-01)

Only pipelines with a non-default posture get a row; the full cron roster
lives in `vercel.json` and the scheduled workflows, which stay the authority
on what runs when.

`npx tsx --env-file=.env.local scripts/ops-status.ts` prints the live values
(the `ingest_state` posture and counter rows, read-only); this file stays the
index of what each row means.

| Pipeline                         | State                                | Notes                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Farcaster sweep (monthly)        | **running, slice mode**              | `--slice` covers a sixth of the network per month; every FID re-checked twice a year; revocation cleanup is range-bounded (#223). A slice writes no checkpoint by design.                                                                                                                                                                            |
| X-handle recovery backfill       | **complete** (2026-09-01, #221)      | 912k FIDs, zero transport failures on the sweep; the X-resolution side left 165 handles on ordinary retry. Checkpoint cleared itself, which is the correct end state.                                                                                                                                                                                |
| X reachability cron (daily)      | running                              | Stamps `x_accounts.checked_at`; note its status flips never touch `social_graph.last_updated_at`.                                                                                                                                                                                                                                                    |
| Right-to-removal suppression     | **designed, deliberately unshipped** | Must not ship alone: it blocks the negative record and moves re-collection from monthly to per-lookup. Ship together with (or after) the machinery that honours it, and any change-feed endpoint must honour it from v1.                                                                                                                             |
| Homepage “Recent activity” strip | known artifact, deliberately kept    | The refresh-stale cron shows as activity because `hidden` defaults false; ruled on and left. Do not “fix” it in passing.                                                                                                                                                                                                                             |
| Neynar budget counter            | running; trust with care             | The counter in `ingest_state` bounds background work; check `updated_at` before trusting it, since it is a self-tracked floor. What the counter does and does not bound is recorded in walletlink-ops.                                                                                                                                               |
| Coverage materializer (daily)    | **new 2026-09-01; no heartbeat**     | `/api/cron/refresh-coverage` (04:30 UTC) writes the `/v1/stats` counts into `ingest_state` (`v1_stats_coverage`, `lib/coverage-stats.ts`). It has no row in the admin health pane, so a silent death shows up only as an aging `meta.as_of` on `/v1/stats`. The read self-primes: the first call after a deploy with no row pays one full aggregate. |

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
