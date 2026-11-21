import { getSiteUrl } from '@/lib/site-url';

/**
 * Starts a worker run now, rather than at the next safety-net tick.
 *
 * ## Why this exists: the database has to be allowed to sleep
 *
 * Neon suspends the compute after five minutes with no queries and then bills
 * storage only. Until 2026-11-21 the job worker and the X-list worker each ran
 * every minute and each idle tick read Postgres, so the compute never once
 * suspended (38 days at the time of measurement, STA-77). The ticks almost
 * always found nothing: about two customer jobs a day, and one X list ever.
 *
 * So work now starts itself. Whatever queues work kicks the worker, and a run
 * that leaves work behind kicks the next run. The crons stay, hourly, as the
 * safety net for a kick that never arrived.
 *
 * ## The shape of a kick
 *
 * A POST carrying the cron secret and the `x-worker-kick` header. The worker
 * answers 202 at once and does the work in `after()`, so this call returns in
 * well under a second and never holds the caller open for the length of the
 * run. The header value is the hop count: a run that kicks its successor
 * passes `hop + 1`, and `MAX_WORKER_HOPS` ends a chain that is not converging.
 *
 * A failed kick is logged and swallowed. The work stays queued, and the hourly
 * tick takes it. That is the trade-off of STA-77: a job whose kick fails waits
 * up to an hour rather than up to a minute.
 */
export const WORKER_KICK_HEADER = 'x-worker-kick';

/** A chain of runs longer than this stops and leaves the rest to the cron. */
export const MAX_WORKER_HOPS = 200;

export type KickTarget = '/api/jobs/worker' | '/api/cron/x-list';

/** The hop count a kicked request carries, or null for a cron or manual run. */
export function kickHopOf(headers: Headers): number | null {
  const raw = headers.get(WORKER_KICK_HEADER);
  if (raw === null) return null;
  const hop = Number.parseInt(raw, 10);
  return Number.isFinite(hop) && hop >= 0 ? hop : 0;
}

export async function kickWorker(
  target: KickTarget,
  hop: number = 0
): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    // Local development without a secret: the cron path is the only one.
    return false;
  }
  if (hop > MAX_WORKER_HOPS) {
    console.warn(
      `Worker chain for ${target} reached ${MAX_WORKER_HOPS} hops; the hourly tick takes the rest`
    );
    return false;
  }
  try {
    const response = await fetch(`${getSiteUrl()}${target}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${cronSecret}`,
        [WORKER_KICK_HEADER]: String(hop),
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status !== 202) {
      console.error(
        `Worker kick for ${target} answered ${response.status}; the hourly tick takes the work`
      );
      return false;
    }
    return true;
  } catch (error) {
    console.error(
      `Worker kick for ${target} failed; the hourly tick takes the work:`,
      error instanceof Error ? error.message : error
    );
    return false;
  }
}

/**
 * After a submit route's own pass at a job, starts a worker run. Always, not
 * only when this job is unfinished: the worker takes whatever the queue holds,
 * which includes a job deferred behind this one by another run's wallet
 * budget, or queued behind the parallel limit. A run that finds the queue
 * empty costs one query, on a database this request has already woken.
 * (Bugbot on PR #430: kicking only for an unfinished job stranded a deferred
 * job behind a finished one until the hourly tick.)
 */
export async function handOnToWorker(): Promise<void> {
  await kickWorker('/api/jobs/worker');
}
