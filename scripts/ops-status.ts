/**
 * The operational posture, read out of the database instead of remembered.
 *
 * Usage: npx tsx --env-file=.env.local scripts/ops-status.ts
 *
 * ## What this is
 *
 * `docs/OPERATIONS.md` is the index: it says what each posture means, why it
 * is what it is, and what unblocks it. This script is the live-values reader
 * beside that index: the `ingest_state` rows that carry operational state,
 * printed with their ages, so a fresh session (or a person) can see the
 * current position without opening a database console. Tier D, item 25 in
 * `docs/AGENT-SYSTEM.md`: posture as data, not as session memory.
 *
 * ## What it reads
 *
 * **Every `ingest_state` row.** Not a list of names. It used to select
 * `posture:%` plus three literal names, and on 2026-09-17 that list had gone
 * three rows out of date: `basename_record_harvest`, `zora_profile_explore`
 * and `daily_cast_state` all carried posture the table in
 * `docs/OPERATIONS.md` describes, and this script could not see any of them.
 * A fresh session told to run this for live values got a clean report over
 * three unchecked cursors, which is worse than no report. A hand-maintained
 * allowlist in a staleness tool goes stale; the table has twelve rows, so
 * printing all of them costs nothing and a new pipeline's row now appears
 * here the day it first writes.
 *
 * Rows with a known shape get a sentence; anything else prints its JSON, so
 * an unrecognized row is visible rather than omitted. Two are worth knowing:
 *
 * - `neynar_credit_usage`: the self-tracked credit floor. Its `updated_at` is
 *   the thing to read first, because the counter is only as trustworthy as
 *   its last write: it once sat still while real credits were spent (the
 *   `lib/neynar-budget.ts` header records the incident), so a stale
 *   timestamp means the VALUE is the thing not to trust
 *   (docs/OPERATIONS.md, the Neynar row).
 * - `farcaster_sweep_resume`, when present: where a budget-stopped full sweep
 *   picks up. The row holds JSON null once a sweep completes (cleared by
 *   upsert, never DELETE, because the CI role has no DELETE), and that reads
 *   here as "cleared", which is the healthy end state. **A slice never writes
 *   it**, so under `--slice` neither its age nor its cleared state says
 *   anything about whether the monthly run worked. Read the workflow's run
 *   conclusion for that.
 *
 * ## Ages come from the database, never from parsing the timestamp here
 *
 * `ingest_state.updated_at` is `timestamp` with no time zone
 * (`scripts/migrate-ingest-state.ts`), written as `now()` under a UTC
 * session. `new Date('2026-09-17 10:00:00')` parses a zone-less string as
 * LOCAL time, so `Date.now() - new Date(updated_at)` under-reported every age
 * on this table by exactly the operator's UTC offset: five hours on a
 * UTC-5 machine, which printed a row written one hour ago as `-4h ago`. The
 * error runs in the dangerous direction for a staleness tool, making a cron
 * that died yesterday read as still inside tolerance, and it grows with the
 * offset while never showing up for an operator sitting at UTC.
 *
 * So the age is computed by `now() - updated_at` in SQL, in the database's own
 * frame, and arrives here as a number of seconds. Nothing in this file parses
 * `updated_at`. `scripts/check-invariants.ts` asserts that.
 *
 * ## READ-ONLY, load-bearing
 *
 * One SELECT, no writes, no DDL, safe against the pooler URL in `.env.local`.
 * A status reader that can change what it reports on is a footgun; if a
 * posture row ever needs writing, that write belongs to the pipeline that
 * owns the posture, in its own reviewed change.
 */
import { neon } from '@neondatabase/serverless';

interface StateRow {
  name: string;
  value: unknown;
  /** Seconds since the row was written, computed by the database. */
  age_seconds: number | string;
}

/**
 * Render a database-computed age. Takes seconds, never a timestamp: see
 * "Ages come from the database" above for what parsing one here cost.
 */
function age(ageSeconds: number | string): string {
  const seconds = Number(ageSeconds);
  if (!Number.isFinite(seconds)) return 'unknown age';
  const days = Math.floor(seconds / 86_400);
  if (days > 0) return `${days}d ago`;
  const hours = Math.floor(seconds / 3_600);
  if (hours > 0) return `${hours}h ago`;
  return `${Math.max(0, Math.floor(seconds / 60))}m ago`;
}

/** How much raw JSON an unrecognized row may print before it is truncated. */
const MAX_RAW_VALUE_CHARS = 120;

/** One line per row: what it says, when it last moved. */
function describe(row: StateRow): string {
  const v = row.value;
  if (row.name === 'neynar_credit_usage') {
    const o = (v ?? {}) as { period?: string; credits?: number | string };
    return `period ${o.period ?? '?'}, ${Number(o.credits ?? 0).toLocaleString()} credits recorded`;
  }
  if (row.name === 'v1_stats_coverage') {
    // The row OPERATIONS.md flags as heartbeat-less: its cron's silent death
    // shows up only as this age, so this is the place the age must show.
    //
    // The as-of moment is this row's `updated_at`, which the age column
    // already carries. It is NOT a key inside the value: `CoverageStats`
    // (lib/coverage-stats.ts) has no `as_of` field, and reading one here
    // printed a literal "?" in the one sentence written for the one pipeline
    // with no heartbeat.
    const o = (v ?? {}) as { total_wallets?: number };
    const wallets = o.total_wallets
      ? `${Number(o.total_wallets).toLocaleString()} wallets, `
      : '';
    return `${wallets}counts as of the age at left (stale past ~2 days means the refresh cron died)`;
  }
  if (row.name === 'posture:farcaster_sweep') {
    // The row written because this script could not see the 2026-09-02 failure:
    // a slice writes no checkpoint, so `farcaster_sweep_resume` read "cleared"
    // throughout a run that died in cleanup. An outcome that is not "cleaned"
    // is stated plainly, because the whole point is that it stops being
    // something an operator has to infer from an age.
    const o = (v ?? {}) as {
      outcome?: string;
      mode?: string;
      cleared?: number;
      deleted?: number;
      seenTable?: string;
      reason?: string;
    };
    const span = `${o.mode ?? '?'} `;
    if (o.outcome === 'cleaned') {
      return `${span}cleaned: ${(o.cleared ?? 0).toLocaleString()} revoked, ${(o.deleted ?? 0).toLocaleString()} husks deleted`;
    }
    if (o.outcome === 'cleanup-failed') {
      return `${span}CLEANUP FAILED, seen table ${o.seenTable ?? '?'} kept for a corrective pass: ${o.reason ?? 'no reason recorded'}`;
    }
    if (o.outcome === 'cleanup-skipped') {
      return `${span}cleanup skipped (a partial seen set would read as revocations): ${o.reason ?? '?'}`;
    }
    if (o.outcome === 'checkpointed') {
      return `${span}checkpointed, cleanup does not apply: ${o.reason ?? '?'}`;
    }
    if (o.outcome === 'range-complete') {
      return `${span}range complete, cleanup did not run: ${o.reason ?? '?'}`;
    }
    return `${span}unrecognized outcome ${JSON.stringify(o.outcome)}`;
  }
  if (row.name === 'basename_record_harvest') {
    const o = (v ?? {}) as { lastBlock?: number };
    return `Base checkpoint at block ${o.lastBlock?.toLocaleString() ?? '?'} (daily incremental; the checkpoint trails the head by a reorg buffer)`;
  }
  if (row.name === 'daily_cast_state') {
    const o = (v ?? {}) as { last?: string; slug?: string };
    return `last cast ${o.last ?? '?'}, slug ${o.slug ?? '?'}`;
  }
  if (row.name === 'zora_profile_explore') {
    return `creator-profile cursor set (weekly workflow, Sundays 07:30 UTC, so a multi-day age is normal here)`;
  }
  if (row.name === 'farcaster_sweep_resume') {
    if (v === null) return 'cleared (no resume pending)';
    const o = (v ?? {}) as {
      nextFid?: number;
      endFid?: number;
      segments?: number;
    };
    return `resume at FID ${o.nextFid?.toLocaleString() ?? '?'} of ${o.endFid?.toLocaleString() ?? '?'}, ${o.segments ?? '?'} segment(s) run`;
  }
  if (row.name === 'holder_index_usage') {
    const o = (v ?? {}) as { events?: unknown[] };
    const events = Array.isArray(o.events) ? o.events : [];
    return `${events.length.toLocaleString()} usage event(s) in the rolling window`;
  }
  // Unrecognized rows print their JSON so a new pipeline is visible here
  // before anyone writes a case for it, but bounded: this reader prints every
  // row now, and one row holding a rolling event list is enough to bury the
  // other eleven in a terminal.
  const json = JSON.stringify(v);
  if (json === undefined) return 'no value';
  return json.length > MAX_RAW_VALUE_CHARS
    ? `${json.slice(0, MAX_RAW_VALUE_CHARS)}… (${json.length.toLocaleString()} chars; no case written for this row yet)`
    : json;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const sql = neon(process.env.DATABASE_URL);

  const rows = (await sql`
    SELECT name,
           value,
           EXTRACT(EPOCH FROM (now() - updated_at)) AS age_seconds
    FROM ingest_state
    ORDER BY name
  `) as unknown as StateRow[];

  console.log('Operational posture (docs/OPERATIONS.md is the index):\n');

  const width = Math.max(24, ...rows.map((r) => r.name.length));
  for (const row of rows) {
    console.log(
      `  ${row.name.padEnd(width)}  ${age(row.age_seconds).padEnd(8)}  ${describe(row)}`
    );
  }

  // Absence is information too, and the two kinds differ. A missing counter
  // means nothing is bounding background spend, which is an alarm; a missing
  // resume row just means no full sweep has checkpointed, which is normal.
  const names = new Set(rows.map((r) => r.name));
  if (!names.has('neynar_credit_usage')) {
    console.log(
      `  ${'neynar_credit_usage'.padEnd(width)}  ${'absent'.padEnd(8)}  ` +
        'NO ROW: nothing is bounding background credit spend (see docs/OPERATIONS.md)'
    );
  }
  if (!names.has('farcaster_sweep_resume')) {
    console.log(
      `  ${'farcaster_sweep_resume'.padEnd(width)}  ${'absent'.padEnd(8)}  ` +
        'no row: no full sweep has checkpointed'
    );
  }
  if (![...names].some((n) => n.startsWith('posture:'))) {
    console.log(
      '\n  No posture:* rows yet. The prefix is reserved for pipelines that publish their own posture.'
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
