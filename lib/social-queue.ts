/**
 * The social queue's calendar: which post in `content/social/queue.json` is
 * due on a given UTC day.
 *
 * ## Why every entry carries its own date
 *
 * The queue started on 2026-09-10 as a start date plus one entry per day, so
 * entry N went out on `start + (N - 1)`. On 2026-10-13 the cadence dropped to
 * three posts a week, Monday, Wednesday and Friday (the reasons are in the
 * `docs/GROWTH.md` log for that date).
 *
 * A start date cannot describe that. The first 30 posts went out daily and
 * every post after them goes out on a cadence day, and the arithmetic that
 * would map an index onto "the Nth Monday, Wednesday or Friday" is exactly
 * the kind nobody checks twice. So each entry names its own date. The X half
 * is scheduled in Typefully by hand from the same field, which makes it the
 * one value both platforms read.
 *
 * `scripts/check-social-queue.ts` holds the dates to the cadence the
 * `daily-cast` workflow actually runs on, so the calendar and the cron cannot
 * disagree silently.
 *
 * Pure functions only, no file access, so the checker can drive them with
 * synthetic queues and assert what they refuse.
 */

export interface QueuePost {
  /** The post's ordinal, 1..N. Not a day count since the cadence change. */
  day: number;
  /** YYYY-MM-DD, UTC: the day this post goes out on both platforms. */
  date: string;
  slug: string;
  x: { text: string; link: string };
  fc: { text: string; link: string };
}

export interface SocialQueue {
  days: QueuePost[];
}

/**
 * How late a run may be and still send the post it was scheduled for.
 *
 * GitHub runs this repository's crons hours behind their slot (measured in
 * `docs/GROWTH.md`), so a 17:35 UTC run can land after midnight. A grace of
 * one day lets that run still send the slot's post. Anything older is
 * skipped rather than sent late, because the X half went out on its date
 * whatever happened here, and a cast days behind it would be out of step.
 */
export const LATE_GRACE_DAYS = 1;

/**
 * Posts left after today's at which the cast warns. Six is two weeks at
 * three a week, which is about how long a refill takes to write, review and
 * schedule on X.
 */
export const LOW_RUNWAY_POSTS = 6;

/** Whole days since the epoch for a YYYY-MM-DD date, read as UTC. */
export function utcDayNumber(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
}

/** 0 for Sunday through 6 for Saturday, as cron counts them. */
export function utcWeekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export type DuePost =
  /** No posts at all. */
  | { kind: 'empty' }
  /** The first post is still in the future. */
  | { kind: 'not-started'; next: QueuePost }
  /** A post is due: today's, or a late run's within the grace. */
  | {
      kind: 'due';
      post: QueuePost;
      /** Posts queued after this one. */
      remaining: number;
      next: QueuePost | null;
    }
  /** Nothing is due today and a later post exists: an off day. */
  | { kind: 'between'; next: QueuePost }
  /** The last post is past its grace and nothing follows it. */
  | { kind: 'exhausted'; last: QueuePost; daysSince: number };

/**
 * The post a run on `today` should send, or why there is none.
 *
 * `days` must be in date order, which the checker enforces. Callers treat
 * `empty` and `exhausted` the same way, because "nothing queued" and
 * "nothing left" need the same response: refill it.
 */
export function duePost(days: QueuePost[], today: string): DuePost {
  if (days.length === 0) return { kind: 'empty' };
  const t = utcDayNumber(today);

  let latest = -1;
  for (let i = 0; i < days.length; i++) {
    if (utcDayNumber(days[i].date) <= t) latest = i;
    else break;
  }
  const next = days[latest + 1] ?? null;

  if (latest === -1) return { kind: 'not-started', next: days[0] };

  const post = days[latest];
  const age = t - utcDayNumber(post.date);
  if (age <= LATE_GRACE_DAYS) {
    return { kind: 'due', post, remaining: days.length - latest - 1, next };
  }
  if (next) return { kind: 'between', next };
  return { kind: 'exhausted', last: post, daysSince: age };
}
