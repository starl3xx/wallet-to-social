import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { listPayments, isStripeConfigured } from '@/lib/stripe';

export const runtime = 'nodejs';

/** Ladder order, so a tier held can be compared against a tier purchased. */
const TIER_RANK: Record<string, number> = {
  free: 0,
  pro: 1,
  unlimited: 2,
};

/**
 * Net revenue, read from Stripe rather than inferred from our own users table.
 *
 * The dashboard previously computed revenue by mapping each paid user's tier to
 * a list price: `pro` meant $99, `unlimited` meant $249. That is not revenue, it
 * is entitlement, and the two diverge the moment anything interesting happens.
 * A complimentary or whitelisted account invents money that was never charged; a
 * refund is completely invisible because the tier does not change.
 *
 * On 2026-08-15 both happened at once. One $99 sale, a duplicate $99 charge
 * refunded, and a goodwill upgrade to Unlimited, and the dashboard confidently
 * reported $249 against an actual net of $99.
 *
 * So the figures come from settled payments, refunds subtracted, and "gifted"
 * is derived rather than guessed: an account holding a paid tier with no
 * matching payment is a comp, and is reported as such instead of as income.
 */
export async function GET(request: NextRequest) {
  const authError = requireAdmin(request);
  if (authError) return authError;

  if (!isStripeConfigured()) {
    return NextResponse.json({
      configured: false,
      allTime: { grossCents: 0, refundedCents: 0, netCents: 0, count: 0 },
      thisMonth: { grossCents: 0, refundedCents: 0, netCents: 0, count: 0 },
      byTier: {},
      payments: [],
      truncated: false,
    });
  }

  try {
    const { payments, truncated } = await listPayments();

    // Calendar month to date, in UTC, matching how Stripe timestamps arrive.
    const now = new Date();
    const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);

    const sum = (rows: typeof payments) =>
      rows.reduce(
        (acc, p) => ({
          grossCents: acc.grossCents + p.amountCents,
          refundedCents: acc.refundedCents + p.refundedCents,
          netCents: acc.netCents + p.netCents,
          // A fully refunded payment is not a sale. It still shows in the list,
          // struck through, because "one sale, one refund" and "no activity"
          // are very different months.
          count: acc.count + (p.fullyRefunded ? 0 : 1),
        }),
        { grossCents: 0, refundedCents: 0, netCents: 0, count: 0 }
      );

    const thisMonthRows = payments.filter(
      (p) => new Date(p.created).getTime() >= monthStart
    );

    // Paid conversions by tier, refunds excluded.
    const byTier: Record<string, number> = {};
    for (const p of payments) {
      if (p.fullyRefunded || !p.tier) continue;
      byTier[p.tier] = (byTier[p.tier] ?? 0) + 1;
    }

    // Highest tier each address actually paid for, computed over EVERY payment.
    //
    // This is sent to the client rather than derived there, because the client
    // only receives the 25 most recent payments for the table. Deriving comp
    // status from that truncated list would label any customer whose purchase
    // has scrolled past the cut-off as complimentary, which is precisely the
    // "revenue that was never earned" error this endpoint exists to prevent,
    // wearing the opposite sign.
    const paidTierByEmail: Record<string, string> = {};
    for (const p of payments) {
      if (p.fullyRefunded || !p.email || !p.tier) continue;
      const key = p.email.toLowerCase();
      const held = paidTierByEmail[key];
      if (!held || TIER_RANK[p.tier] > TIER_RANK[held]) {
        paidTierByEmail[key] = p.tier;
      }
    }

    return NextResponse.json({
      configured: true,
      allTime: sum(payments),
      thisMonth: sum(thisMonthRows),
      byTier,
      paidTierByEmail,
      payments: payments.slice(0, 25),
      truncated,
    });
  } catch (error) {
    console.error('Revenue API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load revenue' },
      { status: 500 }
    );
  }
}
