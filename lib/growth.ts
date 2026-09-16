import { getDb } from '@/db';
import { sql } from 'drizzle-orm';
import { utcBound } from '@/lib/analytics';
import {
  channelFrom,
  CHANNEL_ORDER,
  type Channel,
  type OriginChannel,
} from '@/lib/first-touch';

/**
 * The growth ledger: how much traffic arrives, through which channel, what it
 * does, and whether that is moving.
 *
 * ## Why this is not more of `lib/analytics.ts`
 *
 * That file answers "how is the product doing" for a window somebody picked in
 * the admin panel. This one answers "is the growth work working", which needs a
 * different shape: the same measurement repeated on a fixed cadence so two
 * cadences can be compared. A funnel for August tells you nothing about whether
 * September's blog post earned anything.
 *
 * ## Folded in TypeScript, never in SQL
 *
 * Every rollup here groups by the raw origin string in the database and folds
 * it to a channel in JavaScript, through `channelFrom`. A `CASE` expression
 * naming hosts in SQL would be a second implementation of the same roster, free
 * to drift from the one the invariants exercise, and drift is undetectable
 * here: a misclassified channel produces a plausible number, not an error.
 * `getAcquisitionSources` folds its assistant rollup for the same reason.
 *
 * ## Sessions mean one thing
 *
 * A session is a `session_id` that recorded a `page_view` in the window. Not
 * "any event", which would count a background beacon from a tab left open, and
 * not "distinct user", which the product cannot observe for anonymous traffic.
 * Every count below uses that definition so the rates divide honestly.
 */

/** One channel or one named source, with what its sessions went on to do. */
export interface GrowthRow {
  channel: Channel;
  /** `ChatGPT`, `Google`, `qrcoin.fun`, a campaign tag, or the channel label. */
  name: string;
  sessions: number;
  ranLookup: number;
  checkout: number;
  signups: number;
  bought: number;
}

export interface ChannelWeek {
  /** The Monday the week starts on, `YYYY-MM-DD`. */
  weekStart: string;
  rows: GrowthRow[];
  sessions: number;
  ranLookup: number;
  signups: number;
}

export interface ChannelTrend {
  /** False when a query failed and the empty result below is invented. */
  ok: boolean;
  weeks: ChannelWeek[];
}

const emptyRow = (channel: Channel, name: string): GrowthRow => ({
  channel,
  name,
  sessions: 0,
  ranLookup: 0,
  checkout: 0,
  signups: 0,
  bought: 0,
});

/** The start of the ISO week `weeks` weeks before the current one, in UTC. */
export function weeksAgoUtc(weeks: number, now = new Date()): Date {
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  // Postgres `date_trunc('week')` starts on Monday, so this must too, or the
  // bucket boundaries disagree and the newest week is split across two rows.
  const dayFromMonday = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayFromMonday - weeks * 7);
  return d;
}

/**
 * Sessions by channel, one row per ISO week.
 *
 * Signups join on `users.acquisition`, which is the same summary format
 * `page_view` stores, so both sides fold through the identical classifier.
 * They are counted in the week the account was created rather than the week
 * the session arrived, because those are different facts and only the account
 * one is durable.
 */
export async function getChannelTrend(weeks = 8): Promise<ChannelTrend> {
  const db = getDb();
  if (!db) return { ok: false, weeks: [] };
  const start = utcBound(weeksAgoUtc(weeks));

  try {
    const sessionRows = (await db.execute(sql`
      WITH first_view AS (
        SELECT DISTINCT ON (session_id)
          session_id,
          to_char(date_trunc('week', created_at), 'YYYY-MM-DD') AS week,
          coalesce(origin, '') AS origin
        FROM growth_page_events
        WHERE event_type = 'page_view'
          AND session_id IS NOT NULL
          AND created_at >= ${start}::timestamp
        ORDER BY session_id, created_at
      ),
      acted AS (
        SELECT
          session_id,
          bool_or(event_type = 'lookup_started') AS ran,
          bool_or(
            event_type IN ('checkout_started', 'checkout_redirected')
          ) AS checkout
        FROM growth_page_events
        WHERE session_id IS NOT NULL
          AND created_at >= ${start}::timestamp
        GROUP BY session_id
      )
      SELECT
        f.week AS "week",
        f.origin AS "origin",
        count(*)::int AS "sessions",
        count(*) FILTER (WHERE a.ran)::int AS "ranLookup",
        count(*) FILTER (WHERE a.checkout)::int AS "checkout"
      FROM first_view f
      JOIN acted a ON a.session_id = f.session_id
      GROUP BY 1, 2
    `)) as unknown as {
      rows: Array<{
        week: string;
        origin: string;
        sessions: number;
        ranLookup: number;
        checkout: number;
      }>;
    };

    const signupRows = (await db.execute(sql`
      SELECT
        to_char(date_trunc('week', created_at), 'YYYY-MM-DD') AS "week",
        coalesce(acquisition, '') AS "origin",
        count(*)::int AS "signups",
        count(*) FILTER (WHERE bought)::int AS "bought"
      FROM growth_accounts
      WHERE created_at >= ${start}::timestamp
        AND rail IS DISTINCT FROM 'x402'
      GROUP BY 1, 2
    `)) as unknown as {
      rows: Array<{
        week: string;
        origin: string;
        signups: number;
        bought: number;
      }>;
    };

    const byWeek = new Map<string, Map<Channel, GrowthRow>>();
    const bucket = (week: string, c: OriginChannel): GrowthRow => {
      let channels = byWeek.get(week);
      if (!channels) {
        channels = new Map();
        byWeek.set(week, channels);
      }
      let row = channels.get(c.channel);
      if (!row) {
        row = emptyRow(c.channel, c.channel);
        channels.set(c.channel, row);
      }
      return row;
    };

    for (const r of sessionRows.rows ?? []) {
      const row = bucket(r.week, channelFrom(r.origin));
      row.sessions += r.sessions;
      row.ranLookup += r.ranLookup;
      row.checkout += r.checkout;
    }
    for (const r of signupRows.rows ?? []) {
      const row = bucket(r.week, channelFrom(r.origin));
      row.signups += r.signups;
      row.bought += r.bought;
    }

    const out: ChannelWeek[] = [...byWeek.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([weekStart, channels]) => {
        const rows = CHANNEL_ORDER.map((c) => channels.get(c)).filter(
          (r): r is GrowthRow => r !== undefined
        );
        return {
          weekStart,
          rows,
          sessions: rows.reduce((n, r) => n + r.sessions, 0),
          ranLookup: rows.reduce((n, r) => n + r.ranLookup, 0),
          signups: rows.reduce((n, r) => n + r.signups, 0),
        };
      });

    return { ok: true, weeks: out };
  } catch (error) {
    console.error('Channel trend error:', error);
    return { ok: false, weeks: [] };
  }
}

export interface ChannelSources {
  ok: boolean;
  rows: GrowthRow[];
}

/**
 * The named sources inside each channel over one window.
 *
 * The trend above answers "is search growing"; this answers "which engine, and
 * which campaign tag", which is the half you can act on. Uncapped, because the
 * row this exists to show is the small one: an assistant or a forum sending
 * four people a month is the earliest evidence a channel is opening, and a
 * top-20 cap is exactly what hides it.
 */
export async function getChannelSources(days = 30): Promise<ChannelSources> {
  const db = getDb();
  if (!db) return { ok: false, rows: [] };
  const start = utcBound(new Date(Date.now() - days * 24 * 60 * 60 * 1000));

  try {
    const sessionRows = (await db.execute(sql`
      WITH first_view AS (
        SELECT DISTINCT ON (session_id)
          session_id,
          coalesce(origin, '') AS origin
        FROM growth_page_events
        WHERE event_type = 'page_view'
          AND session_id IS NOT NULL
          AND created_at >= ${start}::timestamp
        ORDER BY session_id, created_at
      ),
      acted AS (
        SELECT
          session_id,
          bool_or(event_type = 'lookup_started') AS ran,
          bool_or(
            event_type IN ('checkout_started', 'checkout_redirected')
          ) AS checkout
        FROM growth_page_events
        WHERE session_id IS NOT NULL
          AND created_at >= ${start}::timestamp
        GROUP BY session_id
      )
      SELECT
        f.origin AS "origin",
        count(*)::int AS "sessions",
        count(*) FILTER (WHERE a.ran)::int AS "ranLookup",
        count(*) FILTER (WHERE a.checkout)::int AS "checkout"
      FROM first_view f
      JOIN acted a ON a.session_id = f.session_id
      GROUP BY 1
    `)) as unknown as {
      rows: Array<{
        origin: string;
        sessions: number;
        ranLookup: number;
        checkout: number;
      }>;
    };

    const signupRows = (await db.execute(sql`
      SELECT
        coalesce(acquisition, '') AS "origin",
        count(*)::int AS "signups",
        count(*) FILTER (WHERE bought)::int AS "bought"
      FROM growth_accounts
      WHERE created_at >= ${start}::timestamp
        AND rail IS DISTINCT FROM 'x402'
      GROUP BY 1
    `)) as unknown as {
      rows: Array<{ origin: string; signups: number; bought: number }>;
    };

    const byName = new Map<string, GrowthRow>();
    const bucket = (c: OriginChannel): GrowthRow => {
      const key = `${c.channel}:${c.name}`;
      let row = byName.get(key);
      if (!row) {
        row = emptyRow(c.channel, c.name);
        byName.set(key, row);
      }
      return row;
    };

    for (const r of sessionRows.rows ?? []) {
      const row = bucket(channelFrom(r.origin));
      row.sessions += r.sessions;
      row.ranLookup += r.ranLookup;
      row.checkout += r.checkout;
    }
    for (const r of signupRows.rows ?? []) {
      const row = bucket(channelFrom(r.origin));
      row.signups += r.signups;
      row.bought += r.bought;
    }

    const order = new Map(CHANNEL_ORDER.map((c, i) => [c, i]));
    return {
      ok: true,
      rows: [...byName.values()].sort(
        (a, b) =>
          (order.get(a.channel) ?? 99) - (order.get(b.channel) ?? 99) ||
          b.sessions - a.sessions ||
          a.name.localeCompare(b.name)
      ),
    };
  } catch (error) {
    console.error('Channel sources error:', error);
    return { ok: false, rows: [] };
  }
}

export interface PagePerformance {
  path: string;
  /** Sessions whose first page view in the window was this path. */
  entries: number;
  views: number;
  /** Of the entering sessions, how many went on to start a lookup. */
  ranLookup: number;
}

export interface ContentPerformance {
  ok: boolean;
  rows: PagePerformance[];
}

/**
 * What each page earns.
 *
 * `entries` and `views` are both here because they answer different questions
 * and the difference is the finding. A page with many views and no entries is
 * read by people the site already had; a page with entries is doing acquisition
 * work. On 2026-09-16 the whole content estate, 29 posts and 7 comparison pages
 * and 66 holder reports, had 40 entries between them in 30 days, against 1,852
 * on the homepage.
 */
export async function getContentPerformance(
  days = 30,
  limit = 60
): Promise<ContentPerformance> {
  const db = getDb();
  if (!db) return { ok: false, rows: [] };
  const start = utcBound(new Date(Date.now() - days * 24 * 60 * 60 * 1000));

  try {
    const result = (await db.execute(sql`
      WITH first_view AS (
        SELECT DISTINCT ON (session_id)
          session_id,
          coalesce(path, '(none)') AS path
        FROM growth_page_events
        WHERE event_type = 'page_view'
          AND session_id IS NOT NULL
          AND created_at >= ${start}::timestamp
        ORDER BY session_id, created_at
      ),
      acted AS (
        SELECT session_id, bool_or(event_type = 'lookup_started') AS ran
        FROM growth_page_events
        WHERE session_id IS NOT NULL
          AND created_at >= ${start}::timestamp
        GROUP BY session_id
      ),
      entries AS (
        SELECT
          f.path,
          count(*)::int AS entries,
          count(*) FILTER (WHERE a.ran)::int AS ran
        FROM first_view f
        JOIN acted a ON a.session_id = f.session_id
        GROUP BY f.path
      ),
      views AS (
        SELECT
          coalesce(path, '(none)') AS path,
          count(*)::int AS views
        FROM growth_page_events
        WHERE event_type = 'page_view'
          AND created_at >= ${start}::timestamp
        GROUP BY 1
      )
      SELECT
        v.path AS "path",
        v.views AS "views",
        coalesce(e.entries, 0) AS "entries",
        coalesce(e.ran, 0) AS "ranLookup"
      FROM views v
      LEFT JOIN entries e ON e.path = v.path
      ORDER BY v.views DESC
      LIMIT ${limit}
    `)) as unknown as { rows: PagePerformance[] };

    return { ok: true, rows: result.rows ?? [] };
  } catch (error) {
    console.error('Content performance error:', error);
    return { ok: false, rows: [] };
  }
}

export interface GrowthWindow {
  start: string;
  end: string;
  sessions: number;
  lookupSessions: number;
  signups: number;
  purchases: number;
  revenueCents: number;
}

export interface GrowthTotals {
  ok: boolean;
  current: GrowthWindow;
  previous: GrowthWindow;
}

const emptyWindow = (start: Date, end: Date): GrowthWindow => ({
  start: start.toISOString().slice(0, 10),
  end: end.toISOString().slice(0, 10),
  sessions: 0,
  lookupSessions: 0,
  signups: 0,
  purchases: 0,
  revenueCents: 0,
});

async function windowTotals(
  db: NonNullable<ReturnType<typeof getDb>>,
  start: Date,
  end: Date
): Promise<GrowthWindow> {
  const a = utcBound(start);
  const b = utcBound(end);
  const result = (await db.execute(sql`
    WITH seen AS (
      SELECT DISTINCT session_id
      FROM growth_page_events
      WHERE event_type = 'page_view'
        AND session_id IS NOT NULL
        AND created_at >= ${a}::timestamp
        AND created_at < ${b}::timestamp
    ),
    ran AS (
      SELECT DISTINCT session_id
      FROM growth_page_events
      WHERE event_type = 'lookup_started'
        AND session_id IS NOT NULL
        AND created_at >= ${a}::timestamp
        AND created_at < ${b}::timestamp
    )
    SELECT
      (SELECT count(*)::int FROM seen) AS "sessions",
      (
        SELECT count(*)::int FROM seen
        WHERE session_id IN (SELECT session_id FROM ran)
      ) AS "lookupSessions",
      (
        SELECT count(*)::int FROM growth_accounts
        WHERE created_at >= ${a}::timestamp
          AND created_at < ${b}::timestamp
          AND rail IS DISTINCT FROM 'x402'
      ) AS "signups",
      (
        SELECT count(*)::int FROM credit_lots
        WHERE created_at >= ${a}::timestamp
          AND created_at < ${b}::timestamp
          AND amount_cents > 0
      ) AS "purchases",
      (
        SELECT coalesce(sum(amount_cents), 0)::int FROM credit_lots
        WHERE created_at >= ${a}::timestamp
          AND created_at < ${b}::timestamp
          AND amount_cents > 0
      ) AS "revenueCents"
  `)) as unknown as {
    rows: Array<Omit<GrowthWindow, 'start' | 'end'>>;
  };

  const row = result.rows?.[0];
  return { ...emptyWindow(start, end), ...(row ?? {}) };
}

/**
 * This window against the one before it, the same length.
 *
 * Two windows rather than a percentage, because at this volume a percentage is
 * theatre: 14 search sessions becoming 21 is "up 50%" and is also seven people.
 * Both raw counts are printed and the reader does the division if they want it.
 */
export async function getGrowthTotals(days = 28): Promise<GrowthTotals> {
  const now = new Date();
  const currentStart = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const previousStart = new Date(
    now.getTime() - 2 * days * 24 * 60 * 60 * 1000
  );

  const db = getDb();
  if (!db) {
    return {
      ok: false,
      current: emptyWindow(currentStart, now),
      previous: emptyWindow(previousStart, currentStart),
    };
  }

  try {
    const [current, previous] = await Promise.all([
      windowTotals(db, currentStart, now),
      windowTotals(db, previousStart, currentStart),
    ]);
    return { ok: true, current, previous };
  } catch (error) {
    console.error('Growth totals error:', error);
    return {
      ok: false,
      current: emptyWindow(currentStart, now),
      previous: emptyWindow(previousStart, currentStart),
    };
  }
}
