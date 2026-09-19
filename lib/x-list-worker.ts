/**
 * Building one X list, a rate-limit window at a time.
 *
 * ## The shape, and where it comes from
 *
 * X allows 300 member additions per fifteen minutes on user auth and takes one
 * member per request. A 319-handle list is therefore 319 requests across two
 * windows, which is why this is a resumable worker and not a request handler.
 *
 * `added_count` is the resume cursor and it is the reason the design works: the
 * members already added are real, and re-adding them would spend again and
 * produce nothing. A run that stops for any reason picks up from the same
 * offset, so the only cost of an interruption is the time to the next tick.
 *
 * ## Suppression is re-read every batch, not once
 *
 * The suppression guard on `x_list_jobs` protects the column holding the
 * authorizing person's handle. It cannot see `members`, which is a jsonb
 * payload, so the people the list is being built FROM are covered here instead:
 * the list is re-read before each batch and a suppressed handle is skipped and
 * counted rather than added.
 *
 * Doing it per batch rather than once at the start is the whole point. A list
 * takes sixteen minutes and a removal that lands at minute three must stop the
 * addition at minute four. The alternative discovers it after the list is
 * public, at which point the remedy is a public list with a visible removal.
 *
 * ## What ends a job
 *
 * Completion, an expired token, or a failure X will not retry past. Every one
 * of them clears `access_token` and empties `members` in the same statement
 * that sets the status, so a finished row holds a name, three counts and a
 * status and nothing else worth having.
 */
import { sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { open } from './secret-box';
import { loadSuppressionList } from './suppression';
import {
  X_API_BASE,
  X_MEMBER_ADDS_PER_WINDOW,
  X_RATE_WINDOW_MS,
} from './x-oauth';

/**
 * How many additions one tick attempts.
 *
 * Below the window allowance on purpose. The cron runs every minute, so a
 * smaller batch spreads the same 300 across the window instead of spending it
 * in the first twenty seconds and then sitting rate-limited for fourteen
 * minutes. It also bounds the tick inside a serverless maxDuration: 20 requests
 * at roughly 300ms each is comfortably inside any of them.
 */
const BATCH = 20;

/** Bounded for the reason lib/x-accounts.ts gives about undici's default. */
const REQUEST_TIMEOUT_MS = 10_000;

export interface Member {
  id: string;
  handle: string;
}

export interface TickResult {
  jobId: string | null;
  added: number;
  skipped: number;
  failed: number;
  status: string;
  note?: string;
}

const IDLE: TickResult = {
  jobId: null,
  added: 0,
  skipped: 0,
  failed: 0,
  status: 'idle',
};

/**
 * End a job and take its credentials with it.
 *
 * One function because there are five ways to finish and every one of them has
 * to clear the same two columns. A separate "clear the token" step is the kind
 * that gets added to four of the five paths and forgotten on the fifth, and
 * the fifth is then a row holding a live token for ever.
 *
 * Every value is a bound parameter. The first version of this returned a
 * fragment for the caller to append an id to, which meant building the id into
 * raw SQL at four call sites: a helper that makes the unsafe thing the
 * convenient thing is worse than no helper.
 */
async function finish(
  jobId: string,
  status: string,
  error: string | null
): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db.execute(sql`
    UPDATE x_list_jobs
    SET status        = ${status},
        error         = ${error},
        access_token  = NULL,
        members       = '[]'::jsonb,
        completed_at  = now(),
        updated_at    = now()
    WHERE id = ${jobId}::uuid
  `);
}

/**
 * Claim and advance one job.
 *
 * One per tick, deliberately. Two jobs in flight would share one account's
 * rate-limit window at X and make both of them slower and harder to reason
 * about, and at present volumes there is never a queue.
 */
export async function runXListTick(): Promise<TickResult> {
  const db = getDb();
  if (!db) return IDLE;

  const claimed = (await db.execute(sql`
    SELECT id, user_id, access_token, access_expires_at, list_name,
           list_description, is_private, members, x_list_id, added_count,
           skipped_count, failed_count, status
    FROM x_list_jobs
    WHERE status IN ('pending', 'running')
      AND (retry_after IS NULL OR retry_after <= now())
    ORDER BY created_at
    LIMIT 1
  `)) as unknown as {
    rows: Array<{
      id: string;
      access_token: string | null;
      access_expires_at: string | null;
      list_name: string;
      list_description: string | null;
      is_private: boolean;
      members: Member[];
      x_list_id: string | null;
      added_count: number;
      skipped_count: number;
      failed_count: number;
      status: string;
    }>;
  };

  const job = claimed.rows[0];
  if (!job) return IDLE;

  /**
   * The token is opened here and never logged, never returned, and never put
   * on the result object. `open` returns null for a tampered or unopenable
   * value, which is also what a key rotation looks like, and both mean the
   * same thing operationally: this job cannot continue and saying so is better
   * than retrying it for ever.
   */
  const token = open(job.access_token);
  if (!token) {
    await finish(job.id, 'failed', 'token unavailable');
    return {
      jobId: job.id,
      added: 0,
      skipped: 0,
      failed: 0,
      status: 'failed',
      note: 'token unavailable',
    };
  }

  if (job.access_expires_at && new Date(job.access_expires_at) <= new Date()) {
    await finish(job.id, 'failed', 'authorization expired');
    return {
      jobId: job.id,
      added: 0,
      skipped: 0,
      failed: 0,
      status: 'failed',
      note: 'authorization expired',
    };
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  // --- create the list, once ------------------------------------------------

  let listId = job.x_list_id;
  if (!listId) {
    try {
      const res = await fetch(`${X_API_BASE}/lists`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: job.list_name,
          ...(job.list_description
            ? { description: job.list_description }
            : {}),
          private: job.is_private,
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        const retry = rateLimited(res);
        if (retry) {
          await db.execute(sql`
            UPDATE x_list_jobs SET retry_after = ${retry.toISOString()},
              updated_at = now() WHERE id = ${job.id}::uuid
          `);
          return {
            jobId: job.id,
            added: 0,
            skipped: 0,
            failed: 0,
            status: 'running',
            note: 'rate limited before creation',
          };
        }
        await finish(job.id, 'failed', `list creation refused (${res.status})`);
        return {
          jobId: job.id,
          added: 0,
          skipped: 0,
          failed: 0,
          status: 'failed',
          note: `list creation refused (${res.status})`,
        };
      }
      const json = (await res.json()) as { data?: { id?: string } };
      if (!json.data?.id) throw new Error('no list id in response');
      listId = json.data.id;
      await db.execute(sql`
        UPDATE x_list_jobs
        SET x_list_id = ${listId}, status = 'running',
            started_at = coalesce(started_at, now()), updated_at = now()
        WHERE id = ${job.id}::uuid
      `);
    } catch (error) {
      console.error('X list creation error:', error);
      // Transient by assumption: left running so the next tick retries, rather
      // than failed, because a timeout is not a refusal.
      await db.execute(sql`
        UPDATE x_list_jobs SET updated_at = now() WHERE id = ${job.id}::uuid
      `);
      return {
        jobId: job.id,
        added: 0,
        skipped: 0,
        failed: 0,
        status: 'running',
        note: 'creation failed, will retry',
      };
    }
  }

  // --- add members ----------------------------------------------------------

  const members = Array.isArray(job.members) ? job.members : [];
  const slice = members.slice(
    job.added_count + job.skipped_count + job.failed_count,
    job.added_count + job.skipped_count + job.failed_count + BATCH
  );

  if (slice.length === 0) {
    await finish(job.id, 'completed', null);
    return {
      jobId: job.id,
      added: 0,
      skipped: 0,
      failed: 0,
      status: 'completed',
    };
  }

  /**
   * Re-read every batch. See the module comment: a removal landing mid-list
   * has to stop the next addition, not be noticed after the list is public.
   * A failure to read fails the batch closed rather than adding unchecked
   * people, on the same rule the job pipeline already follows.
   */
  let suppressed: ReadonlySet<string>;
  try {
    const sets = await loadSuppressionList();
    suppressed = sets.get('twitter') ?? new Set<string>();
  } catch (error) {
    console.error('Suppression read failed; skipping this batch:', error);
    return {
      jobId: job.id,
      added: 0,
      skipped: 0,
      failed: 0,
      status: 'running',
      note: 'suppression unreadable',
    };
  }

  let added = 0;
  let skipped = 0;
  let failed = 0;
  let retryAt: Date | null = null;

  for (const member of slice) {
    if (suppressed.has(member.handle.toLowerCase())) {
      skipped++;
      continue;
    }
    try {
      const res = await fetch(`${X_API_BASE}/lists/${listId}/members`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ user_id: member.id }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.ok) {
        added++;
        continue;
      }
      const retry = rateLimited(res);
      if (retry) {
        retryAt = retry;
        break;
      }
      // A 4xx that is not a rate limit is about this one member: a protected
      // account, a deleted one, a block. Counted and stepped over, because one
      // unaddable member must not end a list of three hundred.
      failed++;
    } catch (error) {
      console.error('X member add error:', error);
      failed++;
    }
  }

  await db.execute(sql`
    UPDATE x_list_jobs
    SET added_count   = added_count + ${added},
        skipped_count = skipped_count + ${skipped},
        failed_count  = failed_count + ${failed},
        retry_after   = ${retryAt ? retryAt.toISOString() : null},
        updated_at    = now()
    WHERE id = ${job.id}::uuid
  `);

  return {
    jobId: job.id,
    added,
    skipped,
    failed,
    status: 'running',
    note: retryAt ? 'rate limited' : undefined,
  };
}

/**
 * When the window reopens, or null if this was not a rate limit.
 *
 * X sends `x-rate-limit-reset` as epoch seconds. The fallback is the documented
 * window rather than a guess at a shorter one: asking again early spends a
 * request to be told the same thing, and this worker has nothing else to do
 * with the time.
 */
function rateLimited(res: Response): Date | null {
  if (res.status !== 429) return null;
  const reset = Number(res.headers.get('x-rate-limit-reset'));
  if (Number.isFinite(reset) && reset > 0) return new Date(reset * 1000);
  return new Date(Date.now() + X_RATE_WINDOW_MS);
}

/** Exported for the ops report: how long a full list should take. */
export function estimatedMinutes(memberCount: number): number {
  const windows = Math.ceil(memberCount / X_MEMBER_ADDS_PER_WINDOW);
  return Math.round(((windows - 1) * X_RATE_WINDOW_MS) / 60000) + 1;
}
