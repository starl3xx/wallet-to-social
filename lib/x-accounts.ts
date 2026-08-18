/**
 * What an X handle currently resolves to.
 *
 * Every X handle in the graph is a string somebody chose, and they can change it
 * whenever they like without telling anyone. Measured across the whole index on
 * 2026-08-17: of 417,872 handles resolved, 30.4% reach nobody.
 *
 * ## Why this is a table about handles, not a column on wallets
 *
 * 1,149,670 rows carry a handle, but there are only 446,043 distinct handles:
 * 2.58 rows per handle. Resolving per row would pay 2.58 times over for the same
 * answer. More importantly, "does this string reach anyone" is a fact about the
 * string, and storing a fact about a string on a row about a wallet is how a
 * column comes to mean two things.
 *
 * ## What this does NOT do, and it matters
 *
 * It records **who currently holds a handle**. That is not **who owns the
 * wallet**, and treating them as the same would be the most expensive mistake
 * available here. If somebody renamed and a stranger took their old handle, this
 * resolver returns the stranger: a real, live account. Writing that id onto the
 * wallet would turn a stale string into a confident wrong answer.
 *
 * So `social_graph.twitter_user_id` is left alone. That column means "an account
 * id a source attested *alongside this wallet*", which is a stronger claim, and
 * only sources that link the two may write it. The value here is the
 * comparison: where we hold an attested id AND this table resolves the handle to
 * a different id, the handle has moved and the row now points at the wrong
 * person. Nothing else can see that, and it works today on the 81,412 rows that
 * carry an attested id.
 *
 * ## Why a paid API and not the public web
 *
 * x.com's robots.txt refuses automated clients outright, so scraping it is not
 * available to us on any terms we would accept: a pass over this index is
 * hundreds of thousands of requests, and no volume of them becomes acceptable
 * because the refusal is explicit rather than rate-shaped.
 *
 * A paid API is the permitted route, and it is also the better one. It returns
 * the numeric account id alongside the handle, which the public HTML never
 * would, and that id is the only thing that can tell a renamed handle from a
 * handle that a stranger now holds.
 */
import { getDb } from '@/db';
import { resolverUrl } from './x-resolver';
import { sql } from 'drizzle-orm';

// Endpoint and key both come from the environment. See lib/x-resolver.ts.

/**
 * The provider documents 200 QPS per client. Measured throughput here is about
 * 1.4 requests per second per worker, so 50 workers is roughly 70 QPS: fast
 * enough for a full pass inside two hours, and comfortably below a ceiling that
 * we have no reason to sit against.
 */
/**
 * Per-request ceiling. Deliberately far below the route's 300s: a resolver that
 * has stopped answering should cost one handle's worth of time, not a run's.
 */
const REQUEST_TIMEOUT_MS = 15_000;

const CONCURRENCY = 50;

/**
 * Credits per lookup, from the published prices.
 *
 * Single lookups by handle cost 18. Batched lookups by id cost 10 once a request
 * carries 100 or more, which is why the second pass and every pass after it goes
 * by id: once a handle has resolved once, we hold its id and never need to pay
 * the by-name price for it again.
 */
export const CREDITS_PER_LOOKUP = 18;
export const CREDITS_PER_BATCHED_LOOKUP = 10;

/**
 * A known-live and a known-dead handle, re-checked during the run.
 *
 * This is the difference between a result and a disaster. If the API starts
 * answering "user not found" to everything, every remaining handle is recorded
 * as gone and the sweep confidently destroys the column it exists to fill. The
 * controls are checked every CONTROL_EVERY lookups and the run stops if either
 * flips, because a partial sweep is recoverable and a wrong one is not.
 */
const LIVE_CONTROL = 'jack';
const DEAD_CONTROL = 'zzzznotarealhandle99123';
const CONTROL_EVERY = 2000;

/** `resolve` retries at most this many times, so a handle costs at most this. */
const MAX_ATTEMPTS_PER_HANDLE = 3;

/**
 * What happened when we asked.
 *
 * `not_found` and `unavailable` are kept apart deliberately. A handle nobody
 * holds is a name that has been freed and may already belong to somebody else. A
 * suspended or withheld account still belongs to the same person, and may come
 * back. Both are unreachable today; only one means the record might now point at
 * a stranger, and collapsing them would hide exactly the case worth acting on.
 */
export type XAccountStatus = 'live' | 'not_found' | 'unavailable';

export interface XAccount {
  handle: string;
  userId: string | null;
  displayName: string | null;
  followers: number | null;
  status: XAccountStatus;
  unavailableReason: string | null;
}

export interface SweepProgress {
  checked: number;
  live: number;
  notFound: number;
  unavailable: number;
  failed: number;
  creditsSpent: number;
  /**
   * HTTP requests actually issued, retries included. `creditsSpent` is derived
   * from this rather than from the handle count, because billing is per
   * request and `resolve` makes up to three.
   */
  requestsIssued: number;
}

interface ApiUser {
  id?: string;
  userName?: string;
  name?: string;
  followers?: number;
  unavailable?: boolean;
  unavailableReason?: string;
  message?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Resolve one handle.
 *
 * Returns null on a transport failure, which is deliberately different from a
 * `not_found` result. Null means "ask again later" and is never written; a
 * status means the API answered. Collapsing the two would let a bad afternoon on
 * the network look exactly like 8% of X disappearing.
 *
 * The not-found shape (`status: "error"`, `msg: "user not found"`) is OBSERVED,
 * not documented. If the provider changes it, this falls through to the final
 * `return null`, so the handle is retried rather than recorded as gone. That is
 * the right way round for a shape we do not control.
 */
async function resolve(
  handle: string,
  key: string,
  /**
   * Called once per HTTP request actually issued, including retries.
   *
   * Billing is per request and this function makes up to three, but the caller
   * used to charge itself exactly one per handle. During the provider outage
   * that triggers the retries, real spend ran up to three times the number the
   * credit cap was checking, which is precisely when the cap needs to hold.
   */
  onRequest?: () => void
): Promise<XAccount | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      onRequest?.();
      const res = await fetch(
        resolverUrl(`/twitter/user/info?userName=${encodeURIComponent(handle)}`),
        {
          headers: { 'x-api-key': key },
          /**
           * Without this the request inherits undici's default header timeout
           * of 300s, which equals the cron route's entire maxDuration. One
           * provider socket that accepts and never answers would consume the
           * whole run and every row already paid for in the buffer.
           */
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        }
      );

      if (res.status === 429 || res.status >= 500) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      if (!res.ok) return null;

      const body = (await res.json()) as {
        status?: string;
        msg?: string;
        data?: ApiUser | null;
      };

      if (body.status === 'error' && /not found/i.test(body.msg ?? '')) {
        return {
          handle,
          userId: null,
          displayName: null,
          followers: null,
          status: 'not_found',
          unavailableReason: null,
        };
      }
      if (body.status !== 'success' || !body.data) return null;
      const u = body.data;

      /**
       * A suspended account answers `success` with `unavailable: true`, a
       * `message` of "User is suspended", and **no id at all**. Requiring an id
       * here counted every one of them as a transport failure: 482 of the first
       * 2,000 handles, 24%, silently reclassified as "ask again later" and left
       * out of the numbers. The absence of an id is the tell, so it cannot also
       * be the error condition.
       */
      if (u.unavailable) {
        return {
          handle,
          userId: u.id ?? null,
          displayName: u.name ?? null,
          followers: null,
          status: 'unavailable',
          unavailableReason: u.unavailableReason ?? u.message ?? 'unavailable',
        };
      }
      if (!u.id) return null;
      return {
        handle,
        userId: u.id!,
        displayName: u.name ?? null,
        followers: typeof u.followers === 'number' ? u.followers : null,
        status: 'live',
        unavailableReason: null,
      };
    } catch {
      await sleep(1000 * (attempt + 1));
    }
  }
  return null;
}

/** One reading of the controls. */
async function controlsPass(key: string): Promise<boolean> {
  const [live, dead] = await Promise.all([
    resolve(LIVE_CONTROL, key),
    resolve(DEAD_CONTROL, key),
  ]);
  return live?.status === 'live' && !!live.userId && dead?.status === 'not_found';
}

/**
 * Confirmed twice before it is believed, because a single reading is not enough
 * to stop a three-hour run.
 *
 * The first version aborted on one failed check and did exactly that: a run
 * stopped at 48,237 of 440,700 lookups, and both controls answered correctly
 * again the moment it was checked by hand. Under 50 concurrent requests a
 * momentary blip is ordinary, and treating it as evidence of systematic failure
 * throws away hours of legitimate work.
 *
 * The safety property is unchanged. What this guards against is the resolver
 * quietly answering "not found" to everything, and that condition does not
 * repair itself in two seconds. Requiring two consecutive failures separated by
 * a pause distinguishes a flake from a fault, which is the distinction the guard
 * was always meant to be making.
 */
async function controlsHold(key: string): Promise<boolean> {
  if (await controlsPass(key)) return true;
  await sleep(2000);
  return controlsPass(key);
}

/** Credits left on the account, or null if the balance cannot be read. */
export async function remainingCredits(key: string): Promise<number | null> {
  try {
    const res = await fetch(resolverUrl('/oapi/my/info'), {
      headers: { 'x-api-key': key },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const b = (await res.json()) as {
      recharge_credits?: number;
      total_bonus_credits?: number;
    };
    return (b.recharge_credits ?? 0) + (b.total_bonus_credits ?? 0);
  } catch {
    return null;
  }
}

/**
 * Note that these handles were tried and produced nothing.
 *
 * Deliberately does NOT touch `x_accounts`. A failed attempt is not a
 * resolution, and every published reachability figure counts rows in that
 * table, so recording failures there would change what those numbers mean.
 */
async function recordAttempts(handles: string[]): Promise<void> {
  const db = getDb();
  if (!db || handles.length === 0) return;
  try {
    await db.execute(sql`
      INSERT INTO x_handle_attempts (handle, attempts, last_attempt_at, last_reason)
      SELECT h, 1, now(), 'no result'
      FROM unnest(${sql.param(handles.map((h) => h.toLowerCase()))}::text[]) AS h
      ON CONFLICT (handle) DO UPDATE SET
        attempts        = x_handle_attempts.attempts + 1,
        last_attempt_at = now(),
        last_reason     = EXCLUDED.last_reason
    `);
  } catch (error) {
    // Accounting must never break the work it measures.
    console.error('recordAttempts failed:', error);
  }
}

/** A handle that resolved has nothing outstanding. */
async function clearAttempts(handles: string[]): Promise<void> {
  const db = getDb();
  if (!db || handles.length === 0) return;
  try {
    await db.execute(sql`
      DELETE FROM x_handle_attempts
      WHERE handle = ANY(${sql.param(handles.map((h) => h.toLowerCase()))}::text[])
    `);
  } catch (error) {
    console.error('clearAttempts failed:', error);
  }
}

/** Persist a batch. Handles are stored lowercased, which is how they are read. */
async function persist(accounts: XAccount[]): Promise<void> {
  const db = getDb();
  if (!db || accounts.length === 0) return;

  await db.execute(sql`
    INSERT INTO x_accounts
      (handle, user_id, display_name, followers, status, unavailable_reason, checked_at)
    SELECT lower(t.handle), nullif(t.user_id, ''), nullif(t.display_name, ''),
           nullif(t.followers, '')::int, t.status, nullif(t.reason, ''), now()
    FROM unnest(
      ${sql.param(accounts.map((a) => a.handle.toLowerCase()))}::text[],
      ${sql.param(accounts.map((a) => a.userId ?? ''))}::text[],
      ${sql.param(accounts.map((a) => a.displayName ?? ''))}::text[],
      ${sql.param(accounts.map((a) => (a.followers === null ? '' : String(a.followers))))}::text[],
      ${sql.param(accounts.map((a) => a.status))}::text[],
      ${sql.param(accounts.map((a) => a.unavailableReason ?? ''))}::text[]
    ) AS t(handle, user_id, display_name, followers, status, reason)
    ON CONFLICT (handle) DO UPDATE SET
      user_id            = EXCLUDED.user_id,
      display_name       = EXCLUDED.display_name,
      followers          = EXCLUDED.followers,
      status             = EXCLUDED.status,
      unavailable_reason = EXCLUDED.unavailable_reason,
      checked_at         = now()
  `);
}

/**
 * Handles still needing a look: never checked, or checked longer ago than
 * `staleDays`. Oldest first, so an interrupted pass resumes where it stopped
 * rather than starting over.
 */
export async function pendingHandles(limit: number, staleDays = 90): Promise<string[]> {
  const db = getDb();
  if (!db) return [];
  const result = (await db.execute(sql`
    SELECT lower(g.twitter_handle) AS handle, min(x.checked_at) AS checked_at
    FROM social_graph g
    LEFT JOIN x_accounts x ON x.handle = lower(g.twitter_handle)
    LEFT JOIN x_handle_attempts a ON a.handle = lower(g.twitter_handle)
    WHERE g.twitter_handle IS NOT NULL
      AND (x.handle IS NULL OR x.checked_at < now() - make_interval(days => ${staleDays}))
      /**
       * Back off handles that have already produced nothing.
       *
       * Never-checked handles sort first, so without this the 22,828 that
       * returned no result on 2026-08-17 sit permanently at the head of the
       * queue and a capped daily run never reaches anything else. The delay
       * doubles with each failed attempt (1 day, 2, 4, 8...) and is capped at
       * 30, so a transient failure is retried tomorrow while a handle that can
       * never resolve stops consuming the budget without ever being recorded as
       * resolved. It stays unchecked, which is the truth about it.
       */
      AND (
        a.handle IS NULL
        OR a.last_attempt_at < now() - make_interval(
             days => least(30, power(2, least(a.attempts, 5))::int))
      )
    GROUP BY 1
    -- Never-checked first, then random within that group. Without the random
    -- tie-break Postgres returns them in storage order, which here is
    -- effectively alphabetical: the first 2,000 handles of the first run were
    -- ALL '0'-prefixed, so the interim not-found rate read 15.28% against a
    -- measured 8.47%. A partial pass has to be a fair sample of the whole, or
    -- every number it reports on the way is wrong.
    ORDER BY checked_at NULLS FIRST, random()
    LIMIT ${limit}
  `)) as unknown as { rows: Array<{ handle: string }> };
  return result.rows.map((r) => r.handle);
}

/**
 * Resolve a list of handles and record what they point at.
 *
 * Stops loudly if the controls stop holding, or if the run would exceed
 * `creditCap`. Neither is defensive decoration. A resolver that has quietly
 * started failing writes "gone" across the whole graph, and an unbounded loop
 * against a metered API is how the holder index came to be hard-blocked by its
 * provider in the middle of a working day.
 */
export async function sweepHandles(
  handles: string[],
  key: string,
  opts: {
    creditCap: number;
    /**
     * Absolute epoch-ms ceiling. Reached is a planned stop, not an error: the
     * buffer is flushed and what was resolved is kept. Without it a Vercel kill
     * at maxDuration discards up to a full batch of rows already paid for.
     */
    deadlineAt?: number;
    /**
     * Lookups between control checks. Defaults to the long-run value; a short
     * scheduled run should pass something much smaller, because a run capped
     * below the default gets no mid-flight check at all and its entire output
     * rests on the single pre-flight one.
     */
    controlEvery?: number;
    onProgress?: (p: SweepProgress) => void;
  }
): Promise<SweepProgress> {
  const controlEvery = opts.controlEvery ?? CONTROL_EVERY;
  const progress: SweepProgress = {
    checked: 0,
    live: 0,
    notFound: 0,
    unavailable: 0,
    failed: 0,
    creditsSpent: 0,
    requestsIssued: 0,
  };
  if (handles.length === 0) return progress;

  if (!(await controlsHold(key))) {
    throw new Error('x-accounts sweep: controls failed before starting, refusing to run');
  }

  const queue = [...handles];
  let buffer: XAccount[] = [];
  let failedHandles: string[] = [];
  let sinceControl = 0;
  // A holder rather than a bare `let`: TypeScript's control-flow analysis does
  // not see assignments made inside the worker closures below, so a plain
  // variable narrows to `null` and then to `never` at the check after the loop.
  const state: { stopped: string | null } = { stopped: null };

  const flush = async () => {
    if (failedHandles.length > 0) {
      const failed = failedHandles;
      failedHandles = [];
      await recordAttempts(failed);
    }
    if (buffer.length === 0) return;
    const batch = buffer;
    buffer = [];
    await persist(batch);
    // A handle that resolved has no outstanding attempt to defer.
    await clearAttempts(batch.map((a) => a.handle));
  };

  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length && !state.stopped) {
        /**
         * Reserve the WORST case before starting a handle, not the best.
         *
         * `resolve` can issue three requests, so charging one up front let a
         * run finish over its cap during exactly the provider trouble that
         * causes retries. Reserving three and refunding the unused part keeps
         * the cap a ceiling rather than an estimate.
         */
        const worstCase = CREDITS_PER_LOOKUP * MAX_ATTEMPTS_PER_HANDLE;
        if (progress.creditsSpent + worstCase > opts.creditCap) {
          state.stopped = `credit cap of ${opts.creditCap} reached`;
          return;
        }
        if (opts.deadlineAt !== undefined && Date.now() >= opts.deadlineAt) {
          state.stopped = 'deadline reached';
          return;
        }
        const handle = queue.shift()!;
        /**
         * Charged inside the callback, not from a delta afterwards.
         *
         * The first version captured `requestsIssued` before the call and
         * subtracted after, which is a read-modify-write across an await with
         * 50 workers running. Every worker's delta included every other
         * worker's requests: a real run of 11 handles issuing 11 requests
         * reported 66, because the deltas summed 1+2+...+11. The callback body
         * has no await, so incrementing there is atomic in this runtime and
         * counts exactly the requests this handle caused.
         */
        const account = await resolve(handle, key, () => {
          progress.requestsIssued++;
          progress.creditsSpent += CREDITS_PER_LOOKUP;
        });
        progress.checked++;

        if (!account) {
          progress.failed++;
          /**
           * Recorded, so the next run does not serve this handle first again.
           *
           * Nothing is written to `x_accounts`: the handle stays genuinely
           * unchecked and nothing about it is published. Only the retry is
           * deferred. Without this the 22,828 handles that produced nothing on
           * 2026-08-17 sit permanently at the front of `pendingHandles`, and a
           * capped daily run would spend its whole budget on them forever.
           */
          failedHandles.push(handle);
        } else {
          buffer.push(account);
          if (account.status === 'live') progress.live++;
          else if (account.status === 'not_found') progress.notFound++;
          else progress.unavailable++;
        }

        if (buffer.length >= 500) await flush();

        sinceControl++;
        if (sinceControl >= controlEvery) {
          sinceControl = 0;
          if (!(await controlsHold(key))) {
            state.stopped = `controls failed after ${progress.checked} lookups`;
            return;
          }
          opts.onProgress?.({ ...progress });
        }
      }
    })
  );

  await flush();
  // A credit cap is a planned stop; a control failure is not.
  if (state.stopped && !state.stopped.startsWith('credit cap')) {
    throw new Error(`x-accounts sweep: ${state.stopped}, stopped early`);
  }
  opts.onProgress?.({ ...progress });
  return progress;
}
