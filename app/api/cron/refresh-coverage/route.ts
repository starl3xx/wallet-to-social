/**
 * Recomputes the materialized coverage counts behind `GET /v1/stats` and the
 * MCP coverage tool, once a day.
 *
 * The counts themselves are one aggregate pass over social_graph, which is
 * exactly the query the stats endpoint used to run on every call and must not
 * (see lib/coverage-stats.ts). Running it here prices it once a day instead
 * of once per caller, and stamps the row so every reader can quote `as_of`.
 *
 * GET is supported for a manual trigger and behaves identically, including
 * the secret check.
 */
import { NextRequest, NextResponse } from 'next/server';
import { refreshCoverageStats } from '@/lib/coverage-stats';

export const runtime = 'nodejs';
export const maxDuration = 60;

async function run(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const refreshed = await refreshCoverageStats();
  if (!refreshed) {
    return NextResponse.json({ error: 'No database' }, { status: 503 });
  }

  return NextResponse.json({
    ok: true,
    as_of: refreshed.asOf.toISOString(),
    total_wallets: refreshed.stats.total_wallets,
    wallets_checked: refreshed.stats.wallets_checked,
  });
}

export const POST = run;
export const GET = run;
