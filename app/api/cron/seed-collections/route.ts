import { NextRequest, NextResponse } from 'next/server';
import { runDailySeed } from '@/lib/seed-collections';
import { checkBackgroundBudget } from '@/lib/neynar-budget';

export const runtime = 'nodejs';
export const maxDuration = 300;

// Up to 3 contracts x ~2,000 holders per daily run, resolved through Neynar.
// Only needs to be the right order of magnitude — it gates whether the run
// starts, and every actual call reports its own exact spend.
const SEED_ESTIMATED_CREDITS = 6000;

/**
 * Daily dataset seeding: one top/trending NFT collection per chain
 * (Ethereum, Base, Robinhood Chain) plus one trending token on Ethereum and
 * Base. Holders are recorded as wallet_holdings edges and queued through the
 * normal lookup pipeline, growing social_graph and producing per-collection
 * match-rate stats. Jobs are visible in Recent Activity by design.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
  }

  // The seed imports whole holder lists and resolves them, so it is one of the
  // larger background consumers of Neynar credits. Yield to the live lookup
  // path when the background ceiling is reached rather than running the account
  // into overage — Neynar pauses ALL requests on continued overuse.
  const budget = await checkBackgroundBudget(SEED_ESTIMATED_CREDITS);
  if (!budget.allowed) {
    return NextResponse.json(
      { message: 'Skipped: Neynar background budget exhausted', reason: budget.reason, seeded: 0 },
      { status: 200 }
    );
  }

  try {
    const results = await runDailySeed();
    const failures = results.filter((r) => r.error);

    return NextResponse.json({
      message: `Seeded ${results.length - failures.length} contracts (${failures.length} failures)`,
      results: results.map((r) => ({
        chain: r.contract.chain,
        kind: r.contract.kind,
        label: r.contract.label,
        address: r.contract.address,
        holdersImported: r.holdersImported,
        totalHolders: r.totalHolders,
        jobId: r.jobId,
        error: r.error,
      })),
    });
  } catch (error) {
    console.error('Seed cron error:', error);
    return NextResponse.json({ error: 'Seed run failed' }, { status: 500 });
  }
}
