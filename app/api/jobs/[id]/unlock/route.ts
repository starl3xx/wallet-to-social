import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { lookupJobs } from '@/db/schema';
import { getJob } from '@/lib/job-processor';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth';
import { unlockJobMatches } from '@/lib/credits';
import { clearLookupGate } from '@/lib/history';
import { trackEvent } from '@/lib/analytics';

export const runtime = 'nodejs';

/**
 * Unlock the gated remainder of a job.
 *
 * A session is required even though job polling accepts a `userId` query
 * param: the param proves enough ownership to read what was already paid
 * for, but an unlock spends lot credits, and credits belong to accounts.
 *
 * Ordering: debit first, clear `matches_delivered` second. If the clear
 * dies, the retry's debit is swallowed by the unlock's unique index and the
 * clear runs again — the customer can never pay twice, and can never end up
 * paid-but-locked for longer than one retry.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const db = getDb();
    if (!db) {
      return NextResponse.json(
        { error: 'Database not configured' },
        { status: 500 }
      );
    }

    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    const session = sessionToken
      ? await validateSession(sessionToken)
      : { user: null };

    if (!session.user) {
      return NextResponse.json(
        { error: 'Sign in to unlock matches.' },
        { status: 401 }
      );
    }

    const job = await getJob(id);
    if (!job || !job.userId || job.userId !== session.user.id) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    if (job.status !== 'completed' || job.matchesDelivered === null) {
      return NextResponse.json(
        { error: 'This job has nothing locked.' },
        { status: 400 }
      );
    }

    const locked = Math.max(0, job.anySocialFound - job.matchesDelivered);
    const verdict = await unlockJobMatches(session.user.id, job.id, locked);
    if (!verdict.ok) {
      return NextResponse.json(
        { error: verdict.reason, upgradeRequired: true, locked },
        { status: 402 }
      );
    }

    await db
      .update(lookupJobs)
      .set({ matchesDelivered: null })
      .where(eq(lookupJobs.id, job.id));

    // The saved-lookup mirror of the same gate.
    await clearLookupGate(job.id);

    trackEvent('match_gate_unlocked', {
      userId: session.user.id,
      metadata: { jobId: job.id, matches: locked },
    });

    return NextResponse.json({ ok: true, unlocked: locked });
  } catch (error) {
    console.error('Job unlock error:', error);
    return NextResponse.json(
      { error: 'Unlock failed. Retry shortly.' },
      { status: 500 }
    );
  }
}
