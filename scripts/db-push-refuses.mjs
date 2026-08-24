#!/usr/bin/env node
/**
 * `npm run db:push` refuses, and says why.
 *
 * ## What it would have done
 *
 * Measured against the live database on 2026-08-24, `drizzle-kit push` produced
 * a 118-statement plan. None of them touched a column. 58 were destructive, and
 * eight of those were `DROP TABLE ... CASCADE`:
 *
 *   x_accounts                          448,069 rows   130 MB
 *   wallet_holdings                     121,826 rows    37 MB
 *   farcaster_sweep_seen_1786631580832  3,676,509 rows 580 MB
 *   seeded_contracts                    86 rows
 *   ingest_state                        5 rows
 *   x_handle_attempts                   3 rows
 *   clanker_unresolved_ids              1 row
 *   farcaster_sweep_seen                0 rows
 *
 * 4.25 million rows, none of which are in the nightly backup: `backup_reader`
 * holds SELECT on six tables and these are not among them. `ingest_state` is the
 * smallest and the worst to lose, because its five jsonb rows are every sweep
 * checkpoint and budget counter, so losing it restarts the Farcaster sweep, the
 * ENS harvest, the Clanker resolver and the Neynar budget from zero.
 *
 * The plan also dropped `social_graph_twitter_lower_idx` and
 * `social_graph_twitter_user_id_idx` with no matching CREATE, which puts a live
 * endpoint onto a sequential scan of 5.1 million rows.
 *
 * ## Why it wanted to
 *
 * `push` diffs `db/schema.ts` against the database and treats anything it cannot
 * see as garbage to be removed. Those eight tables were created by hand, by the
 * `scripts/migrate-*.ts` scripts, and `db/schema.ts` had never heard of them.
 * They are declared now, so the current plan is smaller. **That is not a reason
 * to run it.** The index and constraint half of the plan is still there, and a
 * tool whose failure mode is dropping unbacked-up production tables does not
 * belong on a documented command.
 *
 * ## Why a whole file rather than an inline `node -e`
 *
 * Because the reason has to survive. An inline one-liner in `package.json` is a
 * string nobody can annotate, and the next person to find `db:push` broken would
 * have deleted it. This is the explanation, kept next to the refusal.
 *
 * The real command is still there as `db:push:unsafe`, for a scratch database or
 * a Neon branch. It is deliberately not something anybody types by accident.
 */
const RED = '\x1b[31m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';

console.error(`
${RED}${BOLD}Refusing to run drizzle-kit push against this database.${RESET}

Measured 2026-08-24, its plan was 118 statements, 58 of them destructive,
including ${BOLD}DROP TABLE ... CASCADE on eight tables holding 4.25M rows${RESET}
(x_accounts, wallet_holdings, farcaster_sweep_seen_1786631580832,
seeded_contracts, ingest_state, x_handle_attempts, clanker_unresolved_ids,
farcaster_sweep_seen) and two social_graph indexes with no re-create.

${BOLD}None of those eight tables is in the nightly backup.${RESET}

Schema changes here are hand-written SQL in scripts/migrate-*.ts, run with the
owner DATABASE_URL. See CLAUDE.md, "Schema changes".

${DIM}Against a scratch database or a Neon branch, the real command is:
  npm run db:push:unsafe
Run it against production and you will be restoring from a backup that does
not contain the tables it drops.${RESET}
`);
process.exit(1);
