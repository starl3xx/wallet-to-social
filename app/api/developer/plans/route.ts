import { NextResponse } from 'next/server';
import { PACK_IDS, PACKS } from '@/lib/packs';

export const runtime = 'nodejs';

/**
 * GET /api/developer/plans
 *
 * What an API caller can buy, which is the same thing an app user can buy: a
 * credit pack. There is no separate API plan and there never was one for sale.
 *
 * This endpoint used to read `api_plans` and publish Developer, Startup and
 * Enterprise at $49, $199 and $799 a month, with a feature ladder (batch 50,
 * 200, 1,000; priority support; SLAs) that no purchase could reach, because
 * every pack maps to the one `developer` row (lib/api-plans.ts
 * `CREDIT_API_PLAN`). Those rows are rate-limit presets, seeded but never sold,
 * and an unauthenticated endpoint was advertising them as a price list.
 *
 * The plan's request limits are still reported to the key holder, on
 * `/v1/usage` under `plan_limits`, which is where a limit belongs: next to the
 * key it applies to, not on a menu.
 */
export async function GET() {
  const packs = PACK_IDS.map((id) => {
    const pack = PACKS[id];
    return {
      id: pack.id,
      name: pack.name,
      price_cents: pack.priceCents,
      price_formatted: `$${(pack.priceCents / 100).toFixed(0)}`,
      matches: pack.matches,
      fits: pack.fits,
    };
  });

  return NextResponse.json({
    packs,
    unit: 'match',
    note: 'API calls draw on the same match credits as the app.',
  });
}
