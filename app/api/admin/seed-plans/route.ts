import { NextResponse } from 'next/server';
import { seedApiPlans, getApiPlans } from '@/lib/api-keys';

export const runtime = 'nodejs';

/**
 * POST /api/admin/seed-plans
 * Seeds the default API plans into the database
 */
export async function POST() {
  try {
    await seedApiPlans();
    const plans = await getApiPlans();

    return NextResponse.json({
      message: 'API plans seeded successfully',
      plans: plans.map((p) => ({
        id: p.id,
        name: p.name,
        price_monthly: `$${(p.priceMonthly / 100).toFixed(0)}`,
        requests_per_minute: p.requestsPerMinute,
        requests_per_day: p.requestsPerDay === -1 ? 'unlimited' : p.requestsPerDay,
        requests_per_month: p.requestsPerMonth === -1 ? 'unlimited' : p.requestsPerMonth,
        max_batch_size: p.maxBatchSize,
      })),
    });
  } catch (error) {
    console.error('Failed to seed API plans:', error);
    return NextResponse.json(
      { error: 'Failed to seed API plans' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/admin/seed-plans
 * Check current API plans
 */
export async function GET() {
  const plans = await getApiPlans();

  if (plans.length === 0) {
    return NextResponse.json({
      message: 'No API plans found. POST to this endpoint to seed them.',
      plans: [],
    });
  }

  return NextResponse.json({
    plans: plans.map((p) => ({
      id: p.id,
      name: p.name,
      price_monthly: `$${(p.priceMonthly / 100).toFixed(0)}`,
      requests_per_minute: p.requestsPerMinute,
      requests_per_day: p.requestsPerDay === -1 ? 'unlimited' : p.requestsPerDay,
      requests_per_month: p.requestsPerMonth === -1 ? 'unlimited' : p.requestsPerMonth,
      max_batch_size: p.maxBatchSize,
    })),
  });
}
