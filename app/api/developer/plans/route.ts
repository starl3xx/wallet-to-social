import { NextResponse } from 'next/server';
import { getApiPlans } from '@/lib/api-keys';

export const runtime = 'nodejs';

/**
 * GET /api/developer/plans
 * Get available API plans and pricing
 */
export async function GET() {
  const plans = await getApiPlans();

  if (plans.length === 0) {
    return NextResponse.json(
      { error: 'No plans available. Run plan seeding first.' },
      { status: 503 }
    );
  }

  const formattedPlans = plans.map((plan) => ({
    id: plan.id,
    name: plan.name,
    price_monthly: plan.priceMonthly / 100, // Convert cents to dollars
    price_monthly_formatted: `$${(plan.priceMonthly / 100).toFixed(0)}`,
    limits: {
      requests_per_minute: plan.requestsPerMinute,
      requests_per_day: plan.requestsPerDay === -1 ? 'unlimited' : plan.requestsPerDay,
      requests_per_month: plan.requestsPerMonth === -1 ? 'unlimited' : plan.requestsPerMonth,
      max_batch_size: plan.maxBatchSize,
    },
    features: getFeatures(plan.id),
  }));

  return NextResponse.json({ plans: formattedPlans });
}

function getFeatures(planId: string): string[] {
  switch (planId) {
    case 'developer':
      return [
        'Single wallet lookups',
        'Batch lookups (up to 50)',
        'Reverse lookups',
        'Usage analytics',
        'Email support',
      ];
    case 'startup':
      return [
        'Everything in Developer',
        'Batch lookups (up to 200)',
        'Higher rate limits',
        'Priority support',
        'Webhook notifications',
      ];
    case 'enterprise':
      return [
        'Everything in Startup',
        'Batch lookups (up to 1000)',
        'Unlimited daily/monthly requests',
        'Dedicated support',
        'Custom integrations',
        'SLA guarantee',
      ];
    default:
      return [];
  }
}
