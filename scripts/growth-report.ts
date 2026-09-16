/**
 * The growth report: one page of numbers that says whether the traffic work is
 * working.
 *
 * Usage: npx tsx --env-file=.env.local scripts/growth-report.ts
 *
 * Read-only. It writes nothing, so it is safe to run against production, and
 * `.github/workflows/growth-report.yml` runs it weekly into the job summary.
 *
 * ## Why a script and not just the admin panel
 *
 * The panel answers a question somebody went looking for. This runs whether
 * anybody looks or not, on a cadence, which is the only way a slow-moving
 * number like organic search is ever noticed changing. At 20 sessions a day a
 * channel can double and nobody sees it in a dashboard they open monthly.
 *
 * ## Markdown on purpose
 *
 * The primary reader is a GitHub Actions job summary, which renders markdown.
 * It stays legible in a terminal, which is the secondary reader.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { sql } from 'drizzle-orm';
import { getDb } from '../db';
import {
  getChannelTrend,
  getChannelSources,
  getContentPerformance,
  getGrowthTotals,
  getSeedCoverage,
} from '../lib/growth';
import {
  CHANNEL_LABELS,
  CHANNEL_ORDER,
  type Channel,
} from '../lib/first-touch';

const out: string[] = [];
const say = (line = '') => out.push(line);

/** A count beside the same count in the previous window. */
function delta(current: number, previous: number): string {
  const diff = current - previous;
  if (diff === 0) return `${current} (flat)`;
  return `${current} (${diff > 0 ? '+' : ''}${diff} vs previous)`;
}

function table(headers: string[], rows: Array<Array<string | number>>) {
  say(`| ${headers.join(' | ')} |`);
  say(`| ${headers.map(() => '---').join(' | ')} |`);
  for (const row of rows) say(`| ${row.join(' | ')} |`);
  say();
}

/**
 * Days of scheduled social posts left.
 *
 * Distribution belongs in a growth report even though `check:social` already
 * gates the queue in CI. A gate stops a bad change; it does not tell the person
 * reading the numbers that the reason next month looks flat is that the posting
 * stopped.
 */
function socialRunwayDays(): number | null {
  try {
    const raw = readFileSync(
      join(process.cwd(), 'content/social/queue.json'),
      'utf8'
    );
    const queue = JSON.parse(raw) as {
      start: string;
      days: Array<{ day: number }>;
    };
    const start = Date.parse(`${queue.start}T00:00:00Z`);
    if (!Number.isFinite(start) || !Array.isArray(queue.days)) return null;
    const lastDay = Math.max(...queue.days.map((d) => d.day));
    const endMs = start + (lastDay - 1) * 86400000;
    /**
     * Counted in whole UTC days from today, inclusive of today's own post, and
     * the inclusive part is the correction. Subtracting timestamps reports the
     * gap between now and the last post's midnight, so a queue whose final post
     * goes out a week today read as six days and the refill warning fired a day
     * late. The queue posts once per UTC day, so the unit has to be the day.
     */
    const now = new Date();
    const todayMs = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate()
    );
    return Math.round((endMs - todayMs) / 86400000) + 1;
  } catch {
    return null;
  }
}

/**
 * The first `page_view` ever recorded, or null.
 *
 * A window-over-window comparison is only a comparison if the instrument was
 * installed for both windows, and here it was not: the first `page_view` in the
 * database is 2026-08-18, so the first report to run compared 1,976 sessions
 * against 6 and announced a 329-fold rise that is entirely the tracker being
 * switched on. A growth report whose headline number is an artefact of its own
 * deployment is worse than no report, because somebody will act on it.
 *
 * Read through `growth_page_events` rather than `analytics_events`, like every
 * other query the report makes. The base table is not granted to the role the
 * weekly workflow runs as, and the failure would be silent: the catch below
 * returns null, the caveat never prints, and the run that most needs the
 * warning is the one that does not get it.
 */
async function firstPageViewDay(): Promise<string | null> {
  const db = getDb();
  if (!db) return null;
  try {
    const result = (await db.execute(sql`
      SELECT to_char(min(created_at), 'YYYY-MM-DD') AS "day"
      FROM growth_page_events WHERE event_type = 'page_view'
    `)) as unknown as { rows: Array<{ day: string | null }> };
    return result.rows?.[0]?.day ?? null;
  } catch {
    return null;
  }
}

/**
 * Paths that exist to bring strangers in, as opposed to the app itself.
 *
 * Passed to the query as prefixes so the row cap applies to these pages only.
 * Filtering after a cap shared with the homepage would discard the quietest
 * content rows first, which are the ones worth reading.
 */
const CONTENT_PREFIXES = [
  '/blog',
  '/vs',
  '/holders',
  '/check',
  '/pricing',
  '/mcp',
] as const;

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  say(`# Growth report, ${today}`);
  say();

  const totals = await getGrowthTotals(28);
  if (!totals.ok) {
    say('**No database.** Every table below would be invented, so none ran.');
    console.log(out.join('\n'));
    process.exitCode = 1;
    return;
  }

  const { current: c, previous: p } = totals;
  say(`## Last 28 days (${c.start} to ${c.end})`);
  say();
  table(
    ['Measure', 'This window', 'Previous'],
    [
      ['Sessions', delta(c.sessions, p.sessions), p.sessions],
      [
        'Sessions that ran a lookup',
        delta(c.lookupSessions, p.lookupSessions),
        p.lookupSessions,
      ],
      ['Signups', delta(c.signups, p.signups), p.signups],
      ['Purchases', delta(c.purchases, p.purchases), p.purchases],
      [
        'Revenue',
        `$${(c.revenueCents / 100).toFixed(2)}`,
        `$${(p.revenueCents / 100).toFixed(2)}`,
      ],
    ]
  );

  // The onchain rail is a different funnel with a different buyer, so it sits
  // beside this table rather than inside it. Printed whenever it is non-zero,
  // because a silent exclusion is how revenue goes missing from a report.
  if (c.agentPurchases > 0 || p.agentPurchases > 0) {
    say(
      `Onchain rail, counted separately and excluded from the rows above: ` +
        `${c.agentPurchases} settlements worth ` +
        `$${(c.agentRevenueCents / 100).toFixed(2)} this window, ` +
        `${p.agentPurchases} worth ` +
        `$${(p.agentRevenueCents / 100).toFixed(2)} in the previous one.`
    );
    say();
  }

  const firstView = await firstPageViewDay();
  if (firstView && firstView > p.start) {
    say(
      `**The previous column is not a comparison.** Page views were first ` +
        `recorded on ${firstView}, inside that window, so it is missing most ` +
        `of its own traffic. Ignore every delta above until a report runs ` +
        `with both windows starting after that date.`
    );
    say();
  }

  const trend = await getChannelTrend(8);
  if (trend.ok && trend.weeks.length > 0) {
    say('## Sessions by channel, by week');
    say();
    // Columns in the roster's own order, not the order the weeks happened to
    // introduce them: a table whose columns reshuffle between runs cannot be
    // compared with last week's copy, which is the only thing it is for.
    const seen = new Set<Channel>();
    for (const week of trend.weeks) {
      for (const row of week.rows) if (row.sessions > 0) seen.add(row.channel);
    }
    const channels = CHANNEL_ORDER.filter((ch) => seen.has(ch));
    table(
      [
        'Week of',
        ...channels.map((ch) => CHANNEL_LABELS[ch]),
        'Total',
        'Signups',
      ],
      trend.weeks.map((week) => [
        week.weekStart,
        ...channels.map(
          (ch) => week.rows.find((r) => r.channel === ch)?.sessions ?? 0
        ),
        week.sessions,
        week.signups,
      ])
    );
  }

  const sources = await getChannelSources(30);
  if (sources.ok && sources.rows.length > 0) {
    say('## Named sources, last 30 days');
    say();
    table(
      ['Channel', 'Source', 'Sessions', 'Ran a lookup', 'Checkout', 'Signups'],
      sources.rows.map((r) => [
        CHANNEL_LABELS[r.channel],
        r.name,
        r.sessions,
        r.ranLookup,
        r.checkout,
        r.signups,
      ])
    );
  }

  const content = await getContentPerformance(30, 400, CONTENT_PREFIXES);
  if (content.ok) {
    const rows = content.rows;
    const entries = rows.reduce((n, r) => n + r.entries, 0);
    const views = rows.reduce((n, r) => n + r.views, 0);
    say('## Content pages, last 30 days');
    say();
    say(
      `${rows.length} pages drew ${views} views and ${entries} entries. ` +
        'An entry is a session that arrived on that page; a view without ' +
        'entries is a page the site showed to somebody it already had.'
    );
    say();
    table(
      ['Path', 'Entries', 'Views', 'Ran a lookup'],
      rows
        .sort((a, b) => b.entries - a.entries || b.views - a.views)
        .slice(0, 30)
        .map((r) => [r.path, r.entries, r.views, r.ranLookup])
    );
  }

  const seeds = await getSeedCoverage(7);
  if (seeds.ok) {
    say('## Programmatic pages');
    say();
    say(
      `${seeds.imported} of ${seeds.recognized} named contracts imported ` +
        'holders on their most recent attempt. The seeder resets that count ' +
        'at the start of every attempt, so this is the state of the last try ' +
        'rather than a running total, and a failed refresh moves a live page ' +
        'out of it. Importing holders is also necessary for a page and not ' +
        'sufficient: a report is listed only once it clears the reachability ' +
        'floor, so the live page count runs behind this one.'
    );
    say();
    say(
      `Buckets: ${seeds.imported} imported, ${seeds.failing.length} failing, ` +
        `${seeds.stale.length} stale, ${seeds.untried.length} untried. ` +
        'They sum to the named list by construction, so a contract behind the ' +
        'gap is never simply absent.'
    );
    say();
    if (seeds.failing.length > 0) {
      say(
        `**${seeds.failing.length} were attempted in the last 7 days and ` +
          'imported nothing.** That is a pipeline fault, not a gap.'
      );
      say();
      table(
        ['Chain', 'Contract', 'Last attempt'],
        seeds.failing.map((f) => [f.chain, f.label, f.lastAttempt ?? '?'])
      );
    }
    if (seeds.stale.length > 0) {
      say(
        `${seeds.stale.length} last failed before the window and have not been ` +
          'retried since: ' +
          seeds.stale
            .map((t) => `${t.label} (${t.lastAttempt ?? '?'})`)
            .join(', ') +
          '.'
      );
      say();
    }
    if (seeds.untried.length > 0) {
      say(
        `${seeds.untried.length} have never been attempted: ` +
          seeds.untried.map((u) => u.label).join(', ') +
          '.'
      );
      say();
    }
  }

  say('## Watchlist');
  say();
  const runway = socialRunwayDays();
  if (runway === null) {
    say('- Social queue: could not be read.');
  } else if (runway < 0) {
    say(`- **Social queue ran dry ${-runway} days ago.** Nothing is posting.`);
  } else {
    say(
      `- Social queue: ${runway} days left${runway <= 5 ? ' (refill now)' : ''}.`
    );
  }
  if (c.sessions < p.sessions) {
    say(
      `- Sessions fell from ${p.sessions} to ${c.sessions} against the previous window.`
    );
  }
  if (seeds.ok && seeds.failing.length > 0) {
    say(
      `- **${seeds.failing.length} named contracts failed to import holders ` +
        `this week.** The programmatic surface cannot grow into the searches ` +
        `they answer while that is true.`
    );
  }
  if (c.purchases === 0) {
    say(
      `- No purchases in 28 days. ${c.signups} accounts were created in the ` +
        `same window.${
          c.agentPurchases > 0
            ? ` The ${c.agentPurchases} onchain settlements are a different funnel and are not counted here.`
            : ''
        }`
    );
  }

  console.log(out.join('\n'));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
