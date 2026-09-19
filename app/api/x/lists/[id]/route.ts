/**
 * How far along one X list job is.
 *
 * Polled by the button that started it. Returns counts and a status and
 * nothing else: never the token, never the member list, never the X ids. The
 * row holds all three while the job runs, and a status endpoint that returned
 * them would undo the reason they are sealed and emptied.
 *
 * Scoped to the owner. A job id is a uuid in a URL that the person who started
 * it has in their address bar after the callback, so "not yours" and "no such
 * job" answer identically, the same rule the callback follows.
 */
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { validateSession, SESSION_COOKIE_NAME } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await validateSession(token) : null;
  if (!session?.user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const db = getDb();
  if (!db) return NextResponse.json({ error: 'unavailable' }, { status: 503 });

  /**
   * `total` is computed in SQL, because the member array is the thing this
   * endpoint exists not to return.
   *
   * GREATEST of the two, not their sum. `members` holds the whole list for as
   * long as the job runs and the three counters index INTO it, so adding them
   * together counted every processed member twice and produced a total that
   * grew as work completed: a progress bar that goes backwards. After
   * `finish()` the array is empty by design, and then the counters are the
   * only record of how big the job was, which is why neither alone is right.
   */
  const found = (await db.execute(sql`
    SELECT id, status, handle, x_list_id, list_name, is_private,
           added_count, skipped_count, failed_count, error,
           GREATEST(
             jsonb_array_length(members),
             added_count + skipped_count + failed_count
           ) AS total,
           retry_after
    FROM x_list_jobs
    WHERE id = ${id}::uuid AND user_id = ${session.user.id}
  `)) as unknown as {
    rows: Array<{
      id: string;
      status: string;
      handle: string | null;
      x_list_id: string | null;
      list_name: string;
      is_private: boolean;
      added_count: number;
      skipped_count: number;
      failed_count: number;
      error: string | null;
      total: number;
      retry_after: string | null;
    }>;
  };

  const job = found.rows[0];
  if (!job) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  return NextResponse.json({
    id: job.id,
    status: job.status,
    list_name: job.list_name,
    is_private: job.is_private,
    // Present only once X has made the list, which is what the button links to.
    url:
      job.x_list_id && job.handle
        ? `https://x.com/i/lists/${job.x_list_id}`
        : null,
    added: job.added_count,
    skipped: job.skipped_count,
    failed: job.failed_count,
    total: job.total,
    error: job.error,
    // So the UI can say "waiting for X" rather than looking stalled.
    rate_limited_until: job.retry_after,
  });
}
