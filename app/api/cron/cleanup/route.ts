/**
 * Deletes what nothing else deletes.
 *
 * Three cleanup functions existed and nothing called any of them. Expired
 * sessions, spent magic-link tokens and hourly IP rate-limit buckets therefore
 * accumulated from the day each table was created, and `check-invariants.ts`
 * had nothing to say about it because none of them claimed a retention period.
 *
 * That was worth fixing on its own, and it became necessary when the privacy
 * policy was written: a policy that names a retention period no code enforces
 * is a claim with nothing able to contradict it, which is the exact shape of
 * defect this repository has now shipped four times. So the periods are here,
 * as constants, and `docs-site/privacy.mdx` states them.
 *
 * | What                       | Kept for                          |
 * | -------------------------- | --------------------------------- |
 * | Sessions                   | Until they expire, then deleted   |
 * | Magic-link tokens          | 24 hours after they were created  |
 * | IP rate-limit buckets      | 24 hours                          |
 * | Authorization requests     | Until they expire, then deleted   |
 * | Analytics events           | 400 days                          |
 *
 * Analytics is the one addition rather than a wiring-up. It had no expiry at
 * all, and an event carries a browser id and sometimes an email, so an
 * unbounded table is a growing pile of behavioural data nobody decided to keep.
 * 400 days is the longest a browser will hold a first-party cookie under the
 * Chrome cap, which makes it the longest window in which the id in a row could
 * still identify the same browser.
 *
 * GET is supported for a manual trigger and behaves identically, including the
 * secret check.
 */
import { NextRequest, NextResponse } from 'next/server';
import { lt } from 'drizzle-orm';
import { getDb } from '@/db';
import { analyticsEvents } from '@/db/schema';
import { cleanupExpiredAuth } from '@/lib/auth';
import { cleanupOldIpBuckets } from '@/lib/ip-rate-limiter';
import { cleanupAuthorizationRequests } from '@/lib/oauth/requests';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** See the table above. Named so the policy and the delete cannot disagree. */
export const ANALYTICS_RETENTION_DAYS = 400;
export const IP_BUCKET_RETENTION_HOURS = 24;

async function run(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getDb();
  if (!db) {
    return NextResponse.json({ error: 'No database' }, { status: 503 });
  }

  const auth = await cleanupExpiredAuth();
  const ipBuckets = await cleanupOldIpBuckets(IP_BUCKET_RETENTION_HOURS);
  const authorizationRequests = await cleanupAuthorizationRequests();

  const cutoff = new Date(
    Date.now() - ANALYTICS_RETENTION_DAYS * 24 * 60 * 60 * 1000
  );
  const analytics = await db
    .delete(analyticsEvents)
    .where(lt(analyticsEvents.createdAt, cutoff))
    .returning();

  return NextResponse.json({
    sessions: auth.sessionsDeleted,
    magicLinkTokens: auth.tokensDeleted,
    ipBuckets,
    authorizationRequests,
    analyticsEvents: analytics.length,
  });
}

export const POST = run;
export const GET = run;
