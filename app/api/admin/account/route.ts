import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getDb } from '@/db';
import { sql } from 'drizzle-orm';
import { listPayments, isStripeConfigured } from '@/lib/stripe';

export const runtime = 'nodejs';

/**
 * Everything about one account, in one request.
 *
 * The admin panel could already list accounts, list jobs and list payments, but
 * answering "who is this and what have they done" meant reading three tables
 * and joining them by eye. This is the join, done once.
 *
 * Money comes from Stripe rather than from the tier, for the reason the revenue
 * endpoint documents at length: a tier is an entitlement, not a receipt. An
 * account holding Unlimited with no matching payment is a comp, and saying so
 * is the difference between knowing a customer and guessing at one.
 *
 * Lookup up by email, since that is what a person has when they ask about an
 * account: it is what arrives in a support message, and it is what the tables
 * elsewhere in the panel display.
 */
export async function GET(request: NextRequest) {
  const authError = requireAdmin(request);
  if (authError) return authError;

  const email = request.nextUrl.searchParams.get('email')?.trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ error: 'email is required' }, { status: 400 });
  }

  const db = getDb();
  if (!db) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  const rows = async <T>(q: ReturnType<typeof sql>): Promise<T[]> => {
    const res = (await db.execute(q)) as unknown as { rows?: T[] };
    return res?.rows ?? [];
  };

  const [account] = await rows<{
    id: string;
    email: string;
    tier: string;
    stripe_customer_id: string | null;
    stripe_payment_id: string | null;
    paid_at: string | null;
    created_at: string;
    wallets_used: number;
  }>(sql`
    SELECT id::text, email, tier, stripe_customer_id, stripe_payment_id,
           to_char(paid_at,   'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS paid_at,
           to_char(created_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
           wallets_used
    FROM users WHERE email = ${email} LIMIT 1
  `);

  if (!account) {
    return NextResponse.json({ error: 'No account with that address' }, { status: 404 });
  }

  const [whitelisted] = await rows<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM whitelist WHERE email = ${email}`
  );

  // Volume by day, which is the series a daily allowance would be set against.
  const daily = await rows<{ day: string; jobs: number; wallets: number }>(sql`
    SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
           count(*)::int AS jobs,
           coalesce(sum(jsonb_array_length(to_jsonb(wallets))), 0)::int AS wallets
    FROM lookup_jobs
    WHERE user_id = ${account.id}
    GROUP BY 1 ORDER BY 1 DESC LIMIT 60
  `);

  const recentJobs = await rows<{
    created_at: string;
    status: string;
    wallets: number;
    source: string | null;
    chain: string | null;
    contract_name: string | null;
    contract_symbol: string | null;
    scan_depth: string | null;
  }>(sql`
    SELECT to_char(created_at, 'YYYY-MM-DD HH24:MI') AS created_at,
           status,
           jsonb_array_length(to_jsonb(wallets))::int AS wallets,
           options->>'inputSource'                    AS source,
           options->'sourceContract'->>'chain'        AS chain,
           -- tokenName / tokenSymbol, not 'name'. The shape is ImportedContract
           -- and the admin Jobs table already reads it correctly; this route
           -- guessed and silently returned null for every import.
           options->'sourceContract'->>'tokenName'    AS contract_name,
           options->'sourceContract'->>'tokenSymbol'  AS contract_symbol,
           CASE WHEN (options->>'fastMode')::boolean THEN 'fast' ELSE 'deep' END AS scan_depth
    FROM lookup_jobs
    WHERE user_id = ${account.id}
    ORDER BY created_at DESC LIMIT 25
  `);

  /**
   * Peak and active-day count over the whole history, deliberately not derived
   * from the series above.
   *
   * That series is capped at 60 rows because it is drawn as bars. Reusing it
   * for the peak would understate any account whose busiest day fell outside
   * the most recent sixty active days, and this page would then disagree with
   * the Usage pane it is a drill-down from. Two figures that must match should
   * not be computed two different ways.
   */
  const [lifetime] = await rows<{ peak: number; active_days: number }>(sql`
    SELECT coalesce(max(wallets), 0)::int AS peak, count(*)::int AS active_days
    FROM (
      SELECT sum(jsonb_array_length(to_jsonb(wallets)))::int AS wallets
      FROM lookup_jobs
      WHERE user_id = ${account.id}
      GROUP BY date_trunc('day', created_at)
    ) d
  `);

  const [saved] = await rows<{ n: number; wallets: number }>(sql`
    SELECT count(*)::int AS n, coalesce(sum(wallet_count), 0)::int AS wallets
    FROM lookup_history WHERE user_id = ${account.id}
  `);

  const [keys] = await rows<{ active: number; total: number }>(sql`
    SELECT count(*) FILTER (WHERE is_active AND revoked_at IS NULL)::int AS active,
           count(*)::int AS total
    -- api_keys.user_id is a uuid, while lookup_jobs.user_id and
    -- lookup_history.user_id are text. Cast rather than relying on the driver
    -- to coerce a text parameter into a uuid comparison.
    FROM api_keys WHERE user_id::text = ${account.id}
  `);

  /**
   * What they actually paid. `listPayments` walks Stripe, so it is the slowest
   * thing here and the only one that can be absent; a missing Stripe key gives
   * an empty list rather than an error, and the account still resolves.
   */
  let payments: Array<{
    id: string;
    amountCents: number;
    refundedCents: number;
    netCents: number;
    created: string;
    fullyRefunded: boolean;
  }> = [];
  if (isStripeConfigured()) {
    try {
      const all = await listPayments();
      payments = all.payments
        .filter((p) => p.email?.toLowerCase() === email)
        .map(({ id, amountCents, refundedCents, netCents, created, fullyRefunded }) => ({
          id,
          amountCents,
          refundedCents,
          netCents,
          created,
          fullyRefunded,
        }));
    } catch (error) {
      console.error('Account payments lookup failed:', error);
    }
  }

  const netCents = payments.reduce((s, p) => s + p.netCents, 0);

  return NextResponse.json({
    account: {
      ...account,
      isWhitelisted: (whitelisted?.n ?? 0) > 0,
    },
    // A paid tier with no settled payment behind it is a comp. Saying so keeps
    // the panel from reading an entitlement as revenue.
    gifted: account.tier !== 'free' && netCents === 0,
    netCents,
    payments,
    volume: {
      lifetimeWallets: account.wallets_used,
      peakDayWallets: lifetime?.peak ?? 0,
      activeDays: lifetime?.active_days ?? 0,
      daily,
    },
    savedLookups: saved ?? { n: 0, wallets: 0 },
    apiKeys: keys ?? { active: 0, total: 0 },
    recentJobs,
  });
}
