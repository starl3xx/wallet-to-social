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

/**
 * How long a claim holds a job.
 *
 * Longer than a tick can take (20 adds at a 10s ceiling each, in practice far
 * less) and shorter than the minute between ticks is NOT possible, so it is
 * deliberately longer than both: a lease that expires mid-tick reintroduces
 * exactly the double-processing it exists to prevent. The cost of it being too
 * long is a killed invocation leaving a job idle for one lease; the cost of it
 * being too short is members silently skipped, so it errs long.
 */
const LEASE_SECONDS = 300;

/**
 * Consecutive transient failures before a job gives up.
 *
 * A timeout or a 5xx on a member add must not advance the cursor, or one blip
 * drops that person from the list for good. But retrying for ever is its own
 * failure mode, so the job stops and says so after this many in a row. Reset
 * to zero by any successful add.
 *
 * Deliberately NOT reset by a step-over. That is what keeps this counter
 * meaning "nothing is working": if X were down, every position would fail and
 * the job would step over member after member, marking real people
 * unaddable. Letting this counter run across step-overs bounds that at
 * MAX_TRANSIENT_FAILURES / MAX_MEMBER_ATTEMPTS members before the job stops
 * and says so.
 */
const MAX_TRANSIENT_FAILURES = 20;

/**
 * Attempts at ONE cursor position before that member is stepped over.
 *
 * Measured on a live job on 2026-09-20: a list of 290 stopped at 103 and sat
 * there. Member 103 was an account X refused every time, and because a
 * transient failure deliberately leaves the cursor in place, every tick
 * retried the same account and achieved nothing. The job was fifteen minutes
 * from being marked `failed` with 187 members never attempted.
 *
 * Three, not one, because the reason 403 is treated as transient at all is
 * that X uses it for an app-level refusal as well as a member-level one, and
 * a single refusal is not enough to tell those apart. Three consecutive
 * failures at the SAME position, while the service is otherwise answering, is
 * evidence about that member. The member is then counted as `failed`, which
 * is the existing meaning of "attempted and could not be added", and the list
 * continues.
 */
const MAX_MEMBER_ATTEMPTS = 3;

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
 * Abandoned consent screens, and what they leave behind.
 *
 * A row is created `awaiting_auth` holding the member list, the PKCE verifier
 * and the state nonce, and only `finish()` clears any of that. A person who
 * opens the X consent screen and closes the tab never reaches `finish()`, so
 * a list of third-party handles and a live verifier sit in the table
 * indefinitely: the one thing this design was for was NOT keeping material
 * longer than the job needs it, and the abandoned case quietly did the
 * opposite.
 *
 * Thirty minutes matches `REQUEST_TTL_MS` on the inbound OAuth server, on the
 * same reasoning: long enough to read an email and answer a consent screen,
 * short enough that an abandoned one is abandoned. The row is cancelled rather
 * than deleted, because "you started a list and did not finish it" is a true
 * thing worth being able to see, and what makes the row harmless is that the
 * payload is gone rather than that the row is.
 *
 * This is the SWEEP, not the deadline, and the distinction is one this comment
 * previously got wrong. It runs from the daily cleanup cron, so on its own it
 * would have meant a row living up to a day while the comment claimed thirty
 * minutes, and a confirmation tab left open overnight authorizing successfully
 * and then failing at X after the 04:00 pass cancelled it underneath. The
 * deadline is enforced where the row is READ, in `app/api/x/callback`; this
 * empties the payload afterwards.
 */
export async function cleanupAbandonedListJobs(): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  const purged = (await db.execute(sql`
    UPDATE x_list_jobs
    SET status        = 'cancelled',
        error         = 'authorization never completed',
        members       = '[]'::jsonb,
        code_verifier = NULL,
        state_nonce   = NULL,
        completed_at  = now(),
        updated_at    = now()
    WHERE status = 'awaiting_auth'
      AND created_at < now() - interval '30 minutes'
    RETURNING id
  `)) as unknown as { rows: Array<{ id: string }> };
  return purged.rows.length;
}

/**
 * Hand the job back before the lease would have expired.
 *
 * Every path that ends a tick while leaving the job runnable has to do this.
 * The lease exists to cover a tick that is in flight, not to pace the work, so
 * a tick that gives up after four seconds must not hide the row for the rest
 * of five minutes: the next one-minute cron should pick it straight up.
 *
 * Missing it is invisible in the ordinary case and only shows as a list that
 * stalls for minutes at a time under exactly the conditions, a timeout or an
 * unreadable suppression list, where it should be retrying hardest.
 */
async function releaseLease(jobId: string): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db.execute(sql`
    UPDATE x_list_jobs
    SET leased_until = NULL, updated_at = now()
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

  /**
   * Claim by UPDATE, never by SELECT.
   *
   * The first version read a candidate row and then advanced its cursor at the
   * end of the tick. Vercel can start the next minute's invocation while this
   * one is still in flight, so two ticks read the same offset, each added its
   * batch to `added_count`, and the members between the two offsets were never
   * attempted: a list that comes back short with nothing in the log to say why.
   *
   * One statement does the selecting and the claiming, so there is no window
   * between them. `FOR UPDATE SKIP LOCKED` on the inner select means a second
   * tick arriving mid-statement takes the next eligible row or none, rather
   * than blocking on this one. The lease is what covers the rest of the tick:
   * the row is invisible to another claim until it expires, and it expires on
   * its own so a killed invocation cannot strand a job.
   *
   * `leased_until` rather than reusing `retry_after`, because a job waiting on
   * X and a job currently being worked need to be distinguishable in the ops
   * report. Both mean "not yet", for opposite reasons.
   */
  const claimed = (await db.execute(sql`
    UPDATE x_list_jobs
    SET status       = 'running',
        started_at   = coalesce(started_at, now()),
        leased_until = now() + make_interval(secs => ${LEASE_SECONDS}),
        updated_at   = now()
    WHERE id = (
      SELECT id FROM x_list_jobs
      WHERE status IN ('pending', 'running')
        AND (retry_after IS NULL OR retry_after <= now())
        AND (leased_until IS NULL OR leased_until <= now())
      ORDER BY created_at
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, user_id, x_user_id, access_token, access_expires_at, list_name,
              list_description, is_private, members, x_list_id, added_count,
              skipped_count, failed_count, status, create_attempted_at,
              transient_failures, stuck_cursor, member_attempts
  `)) as unknown as {
    rows: Array<{
      id: string;
      x_user_id: string | null;
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
      create_attempted_at: string | null;
      transient_failures: number;
      stuck_cursor: number | null;
      member_attempts: number;
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
    /**
     * A create whose response we lost must not become a second list.
     *
     * X has no idempotency key on this endpoint. If it accepts the POST and
     * the reply times out, or the follow-up write of `x_list_id` fails, the
     * row still says null and the naive retry makes another list: the customer
     * ends up with duplicate empty lists in their account and the members
     * attached to whichever id was stored last.
     *
     * `create_attempted_at` is written BEFORE the call, so the next tick can
     * tell "never tried" from "tried, outcome unknown". On the second shape we
     * ask X what lists this account owns and adopt one with our exact name
     * rather than creating again. Adoption is by name because that is all we
     * have; it is scoped to lists this account owns and to a name the customer
     * typed for this job, which makes a false match a list they deliberately
     * named identically, and adopting that is better than silently making a
     * third.
     */
    if (job.create_attempted_at) {
      const adopted = await findOwnedListByName(
        headers,
        job.x_user_id,
        job.list_name
      );
      if (adopted) {
        listId = adopted;
        await db.execute(sql`
          UPDATE x_list_jobs
          SET x_list_id = ${listId}, updated_at = now()
          WHERE id = ${job.id}::uuid
        `);
      }
    }
  }

  if (!listId) {
    try {
      await db.execute(sql`
        UPDATE x_list_jobs
        SET create_attempted_at = now(), updated_at = now()
        WHERE id = ${job.id}::uuid
      `);
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
            UPDATE x_list_jobs
            SET retry_after  = ${retry.toISOString()},
                leased_until = NULL,
                updated_at   = now()
            WHERE id = ${job.id}::uuid
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
        UPDATE x_list_jobs
        SET leased_until = NULL, updated_at = now()
        WHERE id = ${job.id}::uuid
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
    await releaseLease(job.id);
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
  /**
   * A transient failure stops the batch instead of counting the member.
   *
   * The cursor is `added + skipped + failed`, so counting a timeout as
   * `failed` advances past that person permanently: one network blip and they
   * are silently not in the list, with nothing to distinguish them from
   * somebody whose account genuinely could not be added. Breaking leaves the
   * cursor where it is, and the next tick retries the same member.
   *
   * The distinction is what X said, not whether an exception was thrown. A
   * 4xx is about this member (protected, deleted, blocked) and is final; a
   * 5xx, a timeout and a 401 are about the request or the credential and are
   * not.
   */
  let transient = false;

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
      if (res.status >= 500 || res.status === 401 || res.status === 403) {
        // Not about this member: the service, or our authorization. 403 is
        // included because X uses it for an app-level refusal as well as a
        // member-level one, and guessing wrong here drops somebody for good.
        console.error(`X member add transient failure: ${res.status}`);
        transient = true;
        break;
      }
      // A 4xx that is not any of the above IS about this one member. Counted
      // and stepped over: one unaddable member must not end a list of three
      // hundred.
      failed++;
    } catch (error) {
      // A thrown error is a timeout or a socket failure, never a verdict.
      console.error('X member add error:', error);
      transient = true;
      break;
    }
  }

  /**
   * The lease is released here, not left to expire.
   *
   * A tick that finishes in four seconds should not hold the job for the rest
   * of the lease; the next minute's tick ought to pick it straight up. The
   * lease exists to cover a tick in flight, not to pace the work.
   */
  /**
   * Progress resets the counter, which is what the constant's own comment
   * claims and what the first version did not do.
   *
   * It incremented whenever a tick ENDED on a transient failure, even one that
   * had just added nineteen members. A long list that adds steadily and meets
   * the occasional timeout would climb to the limit and stop while it was
   * working perfectly well, and the stated reason would be "too many transient
   * failures" on a job whose every tick made progress.
   *
   * The counter means consecutive ticks that achieved NOTHING, so anything
   * added clears it.
   */
  const nextTransient =
    transient && added === 0 ? job.transient_failures + 1 : 0;

  /**
   * Where this tick stopped, which is the position the next one will retry.
   *
   * Computed from the counters as they will be AFTER this tick's own
   * increments, because that is the cursor `slice` will use next time. Read
   * from the job row rather than recomputed from the members array: the
   * cursor is defined by the three counters, so anything else would be a
   * second definition free to drift from the first.
   */
  const cursorAfter =
    job.added_count +
    added +
    job.skipped_count +
    skipped +
    job.failed_count +
    failed;

  /**
   * Attempts at THIS position, which is the question the job-level counter
   * cannot answer.
   *
   * Only a tick that both failed transiently and added nothing is evidence
   * about a member: a tick that added nineteen and then met a timeout says
   * nothing about the twentieth. `stuck_cursor` is what makes the count
   * positional, so three failures spread across three different members do
   * not accumulate into a step-over of the third.
   */
  const stalled = transient && added === 0;
  const sameSpot = stalled && job.stuck_cursor === cursorAfter;
  const attempts = stalled ? (sameSpot ? job.member_attempts + 1 : 1) : 0;

  /**
   * The step-over. One member counted as `failed`, which already means
   * "attempted and could not be added", and the position released.
   *
   * `nextTransient` is deliberately NOT reset here. A step-over is not
   * progress, and letting the job-level counter keep running is what stops a
   * genuine outage from walking the whole list marking everybody unaddable:
   * it can burn at most MAX_TRANSIENT_FAILURES / MAX_MEMBER_ATTEMPTS members
   * before the job stops. Only a real add clears it.
   */
  const stepOver = attempts >= MAX_MEMBER_ATTEMPTS;
  if (stepOver) {
    console.error(
      `X list ${job.id}: stepping over member at ${cursorAfter} after ${attempts} attempts`
    );
  }

  if (nextTransient >= MAX_TRANSIENT_FAILURES) {
    await finish(
      job.id,
      'failed',
      `gave up after ${MAX_TRANSIENT_FAILURES} consecutive transient failures`
    );
    return {
      jobId: job.id,
      added,
      skipped,
      failed,
      status: 'failed',
      note: 'too many transient failures',
    };
  }

  await db.execute(sql`
    UPDATE x_list_jobs
    SET added_count        = added_count + ${added},
        skipped_count      = skipped_count + ${skipped},
        failed_count       = failed_count + ${failed} + ${stepOver ? 1 : 0},
        transient_failures = ${nextTransient},
        stuck_cursor       = ${stepOver || !stalled ? null : cursorAfter},
        member_attempts    = ${stepOver ? 0 : attempts},
        retry_after        = ${retryAt ? retryAt.toISOString() : null},
        leased_until       = NULL,
        updated_at         = now()
    WHERE id = ${job.id}::uuid
  `);

  return {
    jobId: job.id,
    added,
    skipped,
    // The stepped-over member is reported here as well as persisted, so the
    // tick's own result and the row agree about how many could not be added.
    failed: failed + (stepOver ? 1 : 0),
    status: 'running',
    note: retryAt
      ? 'rate limited'
      : stepOver
        ? 'stepped over an unaddable member'
        : undefined,
  };
}

/**
 * A list this account already owns with exactly this name, or null.
 *
 * Only ever called when `create_attempted_at` is set and `x_list_id` is not,
 * which is the narrow "we asked X to make a list and never heard back" case.
 * One page is enough: a list made seconds ago is the most recent one, and
 * paging further would turn a recovery path into a crawl of somebody's
 * account.
 */
async function findOwnedListByName(
  headers: Record<string, string>,
  xUserId: string | null,
  name: string
): Promise<string | null> {
  if (!xUserId) return null;
  try {
    const res = await fetch(
      `${X_API_BASE}/users/${xUserId}/owned_lists?max_results=100`,
      { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      data?: Array<{ id?: string; name?: string }>;
    };
    const hit = (json.data ?? []).find((l) => l.name === name && l.id);
    return hit?.id ?? null;
  } catch (error) {
    console.error('X owned-lists lookup failed:', error);
    return null;
  }
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

/**
 * How long a full list should take, in minutes.
 *
 * `ceil(members / BATCH)`, because the cron ticks once a minute and each tick
 * adds at most `BATCH`. That is the real constraint and it is not a
 * coincidence that it matches X's: 300 additions per 15 minutes IS 20 a
 * minute, so spreading at 20 a minute is exactly the sustainable rate rather
 * than a self-imposed slowdown.
 *
 * The first version counted rate-limit WINDOWS instead, as
 * `(ceil(n / 300) - 1) * 15 + 1`. That assumes the worker bursts 300 and then
 * waits, which it deliberately does not, and the error is not small: it said
 * one minute for a 300-member list that takes fifteen. It happened to be right
 * at 319, which is the size it was checked against.
 */
export function estimatedMinutes(memberCount: number): number {
  return Math.max(1, Math.ceil(memberCount / BATCH));
}
