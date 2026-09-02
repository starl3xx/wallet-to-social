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
 * - Every `ingest_state` row whose name starts with `posture:`. None exist
 *   yet; the prefix is reserved so a pipeline can publish its own posture row
 *   without this script needing a new case for it.
 * - `neynar_credit_usage`: the self-tracked credit floor. Its `updated_at` is
 *   printed first because the counter is only as trustworthy as its last
 *   write: it once sat still while real credits were spent (the
 *   `lib/neynar-budget.ts` header records the incident), so a stale
 *   timestamp means the VALUE is the thing not to trust
 *   (docs/OPERATIONS.md, the Neynar row).
 * - `farcaster_sweep_resume`, when present: where a budget-stopped full sweep
 *   picks up. The row holds JSON null once a sweep completes (cleared by
 *   upsert, never DELETE, because the CI role has no DELETE), and that reads
 *   here as "cleared", which is the healthy end state.
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
  updated_at: string;
}

function age(updatedAt: string): string {
  const ms = Date.now() - new Date(updatedAt).getTime();
  if (!Number.isFinite(ms)) return 'unknown age';
  const days = Math.floor(ms / 86_400_000);
  if (days > 0) return `${days}d ago`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours > 0) return `${hours}h ago`;
  return `${Math.max(0, Math.floor(ms / 60_000))}m ago`;
}

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
    const o = (v ?? {}) as { as_of?: string };
    return `coverage counts as of ${o.as_of ?? '?'} (stale past ~2 days means the refresh cron died)`;
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
  return JSON.stringify(v);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const sql = neon(process.env.DATABASE_URL);

  const rows = (await sql`
    SELECT name, value, updated_at
    FROM ingest_state
    WHERE name LIKE 'posture:%'
       OR name IN ('neynar_credit_usage', 'farcaster_sweep_resume', 'v1_stats_coverage')
    ORDER BY name
  `) as unknown as StateRow[];

  console.log('Operational posture (docs/OPERATIONS.md is the index):\n');

  const width = Math.max(24, ...rows.map((r) => r.name.length));
  for (const row of rows) {
    console.log(
      `  ${row.name.padEnd(width)}  ${age(row.updated_at).padEnd(8)}  ${describe(row)}`
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
