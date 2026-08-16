import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getDb } from '@/db';
import { sql } from 'drizzle-orm';
import { getPeriodSpend, MONTHLY_CREDIT_LIMIT, BACKGROUND_CEILING } from '@/lib/neynar-budget';
import {
  getRollingSpend,
  DAILY_REQUEST_LIMIT,
  BACKGROUND_CEILING as HOLDER_BACKGROUND_CEILING,
} from '@/lib/holder-index-budget';

export const runtime = 'nodejs';

/**
 * Daily volume per account, and what it costs us.
 *
 * **This measures. It does not enforce.** No tier carries a daily allowance,
 * and nothing here creates one. It exists so the decision about whether to add
 * a cap, and where to put it, is made from observed behaviour rather than from
 * a guess — the same reason `walletsUsed` is kept after ceasing to gate
 * anything.
 *
 * The question it answers is narrow and worth stating: a lookup's cost is
 * roughly linear in wallets and the price is one-time, so a single account can
 * run up unbounded provider spend against a fixed payment. On 2026-08-15 one
 * account processed 82,024 wallets in four hours, three times the previous
 * busiest day in the product's history, and took a provider's daily allowance
 * to 75% on its own. Provider limits are account-wide, so that is everyone's
 * outage, not just theirs.
 *
 * ## Read it in wallets, never in lookups
 *
 * Eleven 200-wallet lookups and eleven 10,000-wallet lookups are both "eleven",
 * and only one is a problem. The worker learned this the expensive way when it
 * budgeted by job count; a cap denominated in lookups would repeat it.
 *
 * ## Why it computes rather than rolls up
 *
 * There is no aggregate table behind this. `lookup_jobs` holds a few hundred
 * rows and the query is trivial, so a rollup would buy speed nobody needs and
 * introduce a second copy of the truth that can drift from the first. Revisit
 * when the table is large enough for the scan to matter, not before.
 */
export async function GET(request: NextRequest) {
  const authError = requireAdmin(request);
  if (authError) return authError;

  const db = getDb();
  if (!db) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  const rows = async <T>(q: ReturnType<typeof sql>): Promise<T[]> => {
    const res = (await db.execute(q)) as unknown as { rows?: T[] };
    return res?.rows ?? [];
  };

  // Wallet volume by day. `to_jsonb` because the column is jsonb, so
  // array_length does not apply to it.
  const daily = await rows<{
    day: string;
    jobs: number;
    wallets: number;
    accounts: number;
  }>(sql`
    SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
           count(*)::int                                        AS jobs,
           coalesce(sum(jsonb_array_length(to_jsonb(wallets))), 0)::int AS wallets,
           count(DISTINCT user_id)::int                         AS accounts
    FROM lookup_jobs
    WHERE created_at > now() - interval '30 days'
    GROUP BY 1
    ORDER BY 1 DESC
  `);

  /**
   * The busiest single day each account has ever had.
   *
   * This is the number a ceiling has to clear. An average says nothing useful:
   * a cap is only ever met on a peak day, and a cap below somebody's observed
   * peak is a cap that has already refused a real customer once.
   */
  const peaks = await rows<{
    email: string | null;
    tier: string | null;
    busiest_day: string | null;
    peak_wallets: number;
    total_wallets: number;
    active_days: number;
  }>(sql`
    WITH per_day AS (
      SELECT j.user_id,
             date_trunc('day', j.created_at) AS day,
             sum(jsonb_array_length(to_jsonb(j.wallets)))::int AS wallets
      FROM lookup_jobs j
      WHERE j.user_id IS NOT NULL
      GROUP BY 1, 2
    ),
    ranked AS (
      SELECT user_id, day, wallets,
             row_number() OVER (PARTITION BY user_id ORDER BY wallets DESC) AS rn,
             sum(wallets)  OVER (PARTITION BY user_id) AS total_wallets,
             count(*)      OVER (PARTITION BY user_id) AS active_days
      FROM per_day
    )
    SELECT u.email,
           u.tier,
           to_char(r.day, 'YYYY-MM-DD') AS busiest_day,
           r.wallets::int      AS peak_wallets,
           r.total_wallets::int AS total_wallets,
           r.active_days::int   AS active_days
    FROM ranked r
    LEFT JOIN users u ON u.id::text = r.user_id
    WHERE r.rn = 1
    ORDER BY r.wallets DESC
    LIMIT 25
  `);

  const [allTime] = await rows<{ peak_day: string | null; peak_wallets: number }>(sql`
    SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS peak_day,
           coalesce(sum(jsonb_array_length(to_jsonb(wallets))), 0)::int AS peak_wallets
    FROM lookup_jobs
    GROUP BY 1 ORDER BY 2 DESC LIMIT 1
  `);

  // What that volume actually spends. Read from the same counters the guards
  // read, so the dashboard cannot disagree with the throttles.
  const [neynarSpend, holderSpend] = await Promise.all([
    getPeriodSpend().catch(() => 0),
    getRollingSpend().catch(() => 0),
  ]);

  return NextResponse.json({
    enforcing: false,
    daily,
    peaks,
    allTimePeak: allTime ?? { peak_day: null, peak_wallets: 0 },
    providers: {
      // Monthly, and currently over: the sweep that filled the index spent past
      // the plan limit, which is why background Farcaster work is stopped.
      social: {
        label: 'Social credits, this month',
        spent: neynarSpend,
        limit: MONTHLY_CREDIT_LIMIT,
        backgroundCeiling: BACKGROUND_CEILING,
      },
      // Daily, and the one a heavy afternoon can exhaust on its own.
      holderIndex: {
        // "Last 24 hours", not "today". The counter is a trailing window rather
        // than a calendar day, because the provider's own reset is not aligned
        // to UTC midnight. A label saying "today" would read as a figure that
        // zeroes at midnight, and this one does not.
        label: 'Holder index requests, last 24h',
        spent: holderSpend,
        limit: DAILY_REQUEST_LIMIT,
        backgroundCeiling: HOLDER_BACKGROUND_CEILING,
      },
    },
  });
}
