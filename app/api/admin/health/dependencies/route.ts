import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getDb } from '@/db';
import { sql } from 'drizzle-orm';

export const runtime = 'nodejs';

/**
 * Is every external dependency configured, and did every scheduled job run?
 *
 * ## Why this exists
 *
 * On 2026-08-18 four claims in this repository turned out not to survive
 * inspection, and three of them share one cause: nothing anywhere reported
 * whether the machinery behind a claim was actually running.
 *
 * - The docs told customers X handles were resolved "on a daily cycle". No such
 *   cron existed, in `vercel.json` or anywhere else, and had never existed.
 * - `sweep_runner` lacked SELECT on two tables added after the role split, and
 *   the first sign was CI failing on a run that passed locally.
 * - Renaming the resolver's env vars silently unconfigured it everywhere until
 *   somebody remembered to set them again.
 *
 * Each was invisible for the same reason: **absence produces no error.** A cron
 * that does not exist emits nothing, and a key that is not set makes a degrading
 * code path degrade quietly, exactly as designed. The only way to see any of it
 * is to ask, on purpose, and that is what this endpoint does.
 *
 * ## What it deliberately does not do
 *
 * It makes **no external requests**. Every answer is a local read: an
 * environment variable's presence, and a timestamp already in the database.
 * That keeps it free, instant, and safe to poll, and it means a provider being
 * down cannot make this page fail to load at the moment somebody needs it most.
 *
 * It reports presence, never values. No key, no fragment of a key, no length.
 *
 * It names **capabilities, not suppliers**. CLAUDE.md's rule applies to source
 * as much as to copy, since this repository is public.
 */

interface Dependency {
  /** What it does for the product, not who provides it. */
  capability: string;
  /** Env var names. Names only; values are never read into the response. */
  vars: string[];
  /** What stops working when it is missing. */
  impact: string;
  /** True only when every var is set and non-empty. */
  configured: boolean;
  /** Whether the product still functions without it. */
  severity: 'critical' | 'degrades';
}

function dependency(
  capability: string,
  vars: string[],
  impact: string,
  severity: 'critical' | 'degrades'
): Dependency {
  return {
    capability,
    vars,
    impact,
    severity,
    configured: vars.every((v) => Boolean(process.env[v]?.trim())),
  };
}

/**
 * Scheduled jobs, and where each records that it finished.
 *
 * `schedule` is copied from `vercel.json` rather than read from it, so a job
 * removed there but left here shows as never running instead of disappearing
 * from the list. A missing job is the thing this panel exists to reveal, and a
 * list that edits itself to match reality cannot reveal anything.
 *
 * `maxAgeHours` is roughly two intervals: enough that one skipped run is not an
 * alarm, tight enough that a stopped job is obvious within a day.
 */
const JOBS: Array<{
  name: string;
  schedule: string;
  /** `metadata->>'eventSubtype'` written on success. */
  subtype: string;
  maxAgeHours: number;
}> = [
  { name: 'Farcaster sweep', schedule: '05:30 daily', subtype: 'farcaster_sweep_incremental', maxAgeHours: 48 },
  { name: 'ENS harvest', schedule: '05:00 daily', subtype: 'ens_harvest_incremental', maxAgeHours: 48 },
  { name: 'Attestation sweep', schedule: '06:00 daily', subtype: 'ethos_sweep', maxAgeHours: 48 },
  { name: 'Onchain attestation sweep', schedule: '06:20 daily', subtype: 'eas_sweep', maxAgeHours: 48 },
  { name: 'Token deploy scan', schedule: '06:40 daily', subtype: 'clanker_sweep', maxAgeHours: 48 },
  { name: 'Collection seeding', schedule: '07:00 daily', subtype: 'seed_contract', maxAgeHours: 48 },
];

/**
 * Work that runs on no schedule at all, stated rather than omitted.
 *
 * The handle-liveness sweep is the reason this section exists. It is a manual
 * script, it has never had a cron, and the public docs claimed a daily cadence
 * for it for a week. Listing it as unscheduled is the honest shape: the job is
 * real, the cadence is not, and a panel that simply left it out would reproduce
 * exactly the blindness that let the wrong claim ship.
 */
const UNSCHEDULED: Array<{ name: string; how: string; why: string }> = [
  {
    name: 'X handle liveness sweep',
    how: 'manual: scripts/sweep-x-accounts.ts',
    why: 'No cron. Coverage decays as new handles arrive, so any published reachability figure ages from the day it was measured.',
  },
];

export async function GET(request: NextRequest) {
  const authError = requireAdmin(request);
  if (authError) return authError;

  const dependencies: Dependency[] = [
    dependency('Database', ['DATABASE_URL'], 'Everything. Lookups, history, the index.', 'critical'),
    dependency(
      'X account resolver',
      ['X_RESOLVER_API_BASE', 'X_RESOLVER_API_KEY'],
      'Handle liveness cannot be swept, and token deploys resolve no account ids.',
      'degrades'
    ),
    dependency('Farcaster index', ['NEYNAR_API_KEY'], 'Farcaster lookups and the daily sweep stop.', 'critical'),
    dependency('NFT ownership', ['ALCHEMY_KEY'], 'NFT contract import stops on every chain.', 'critical'),
    dependency(
      'ERC-20 holder index',
      ['MORALIS_API_KEY'],
      'Token import falls back to public explorers on five of six chains; BNB Chain stops.',
      'degrades'
    ),
    dependency('Collection metadata', ['OPENSEA_API_KEY'], 'Seed discovery loses a candidate source.', 'degrades'),
    dependency('Email delivery', ['RESEND_API_KEY'], 'Sign-in links and receipts are not sent.', 'critical'),
    dependency(
      'Payments',
      ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_PRO', 'STRIPE_PRICE_UNLIMITED'],
      'Nobody can buy, or a purchase completes without granting the tier.',
      'critical'
    ),
    dependency('Cron authentication', ['CRON_SECRET'], 'Scheduled routes are callable by anyone.', 'critical'),
  ];

  const db = getDb();
  let jobs: Array<{
    name: string;
    schedule: string;
    lastSuccess: string | null;
    hoursAgo: number | null;
    status: 'ok' | 'late' | 'never';
  }> = JOBS.map((j) => ({ name: j.name, schedule: j.schedule, lastSuccess: null, hoursAgo: null, status: 'never' }));

  if (db) {
    try {
      const rows = (await db.execute(sql`
        SELECT metadata->>'eventSubtype' AS subtype, max(created_at) AS last_success
        FROM analytics_events
        WHERE metadata->>'eventSubtype' = ANY(${sql.param(JOBS.map((j) => j.subtype))}::text[])
        GROUP BY 1
      `)) as unknown as { rows: Array<{ subtype: string; last_success: string }> };

      const seen = new Map(rows.rows.map((r) => [r.subtype, r.last_success]));

      jobs = JOBS.map((j) => {
        const last = seen.get(j.subtype);
        if (!last) {
          return { name: j.name, schedule: j.schedule, lastSuccess: null, hoursAgo: null, status: 'never' as const };
        }
        const hoursAgo = (Date.now() - new Date(last).getTime()) / 3_600_000;
        return {
          name: j.name,
          schedule: j.schedule,
          lastSuccess: new Date(last).toISOString(),
          hoursAgo: Math.round(hoursAgo * 10) / 10,
          status: hoursAgo > j.maxAgeHours ? ('late' as const) : ('ok' as const),
        };
      });
    } catch (error) {
      console.error('Dependency health: job query failed', error);
    }
  }

  const missingCritical = dependencies.filter((d) => !d.configured && d.severity === 'critical').length;
  const missingDegraded = dependencies.filter((d) => !d.configured && d.severity === 'degrades').length;
  const jobsLate = jobs.filter((j) => j.status !== 'ok').length;

  return NextResponse.json({
    dependencies,
    jobs,
    unscheduled: UNSCHEDULED,
    summary: { missingCritical, missingDegraded, jobsLate, databaseReachable: Boolean(db) },
  });
}
