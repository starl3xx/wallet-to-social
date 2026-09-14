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
 * Ordering: debit, then the history mirror, then the job column, LAST.
 * The job column is what makes a retry possible: while it is set, a retry
 * runs the whole sequence again (the debit is swallowed by the unlock's
 * unique index), so a clear that dies is finished by the next attempt. Were
 * the job column cleared first, a failed history clear would be
 * unreachable: the retry would answer "nothing locked" over a saved lookup
 * still serving locked rows the customer has paid for.
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
    /**
     * Ownership: the session, or the anonymous proof the results GET
     * already accepts. A job run before signing in carries the browser's
     * local id as `userId`, so after signup the session id matches nothing;
     * the `?userId=` param is the same possession proof that already reads
     * the delivered rows, and here it can only spend the CALLER's own
     * credits, so the session both authenticates the payer and bounds the
     * damage of a leaked local id to a stranger paying your bill.
     */
    const anonProof = request.nextUrl.searchParams.get('userId');
    const owns =
      !!job?.userId &&
      (job.userId === session.user.id ||
        (!!anonProof && job.userId === anonProof));
    if (!job || !owns) {
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

    // The saved-lookup mirror first; the job column last, because it is
    // the retry ticket (see the route docblock).
    await clearLookupGate(job.id);

    await db
      .update(lookupJobs)
      .set({ matchesDelivered: null })
      .where(eq(lookupJobs.id, job.id));

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
