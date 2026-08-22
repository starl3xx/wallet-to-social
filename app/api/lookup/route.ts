import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * Retired. Lookups run through `/api/jobs`.
 *
 * This was the original streaming path, and it had been kept as a fallback
 * after the UI moved to jobs in January 2026. By August it had become the one
 * way to run a lookup that the credit model did not reach: no balance check, no
 * debit, priority scores for everyone, and a 5,000-wallet ceiling for any
 * signed-in account with no IP limit on top. Nothing has called it since the
 * move (no rate-limit bucket has ever been opened for it, and the last history
 * row it wrote is from 2026-01-18), so the honest fix is to stop answering
 * rather than to duplicate the jobs path's gates in a second place where they
 * would drift again.
 *
 * 410 rather than 404: the route existed, and a caller should learn where it
 * went rather than assume a typo.
 */
export async function POST() {
  return NextResponse.json(
    {
      error:
        'This endpoint is retired. Submit lookups to POST /api/jobs, or use the public API at /api/v1. See https://docs.walletlink.social.',
      replacement: '/api/jobs',
    },
    { status: 410 }
  );
}
