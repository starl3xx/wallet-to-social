/**
 * Cast the queued post that is due as @walletlink. The Farcaster half of the
 * social pipeline; the X half is scheduled in Typefully and never touches
 * this script. The name predates the cadence change: it posts three times a
 * week now, Monday, Wednesday and Friday, and was not renamed because the
 * workflow, its run history and the `daily_cast_state` checkpoint all carry
 * the old name.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/cast-daily.ts            # dry run
 *   npx tsx --env-file=.env.local scripts/cast-daily.ts --send     # publish
 *
 * The queue is `content/social/queue.json`: one entry per post, each with
 * its own UTC `date`, both platforms' texts and a card slug.
 * `lib/social-queue.ts` decides which entry is due. The cast embeds the
 * post's on-brand card, rendered live by `/social-card/[slug]` so the
 * figures on it are read at view time, and carries the CTA link in the text
 * so it stays clickable.
 *
 * ## The rules this enforces
 *
 * - **Each post is cast once, idempotent.** The last cast is checkpointed in
 *   `ingest_state` (`daily_cast_state`, its date and slug), so a re-run, a
 *   manual dispatch after the cron, or an Actions retry sends nothing twice.
 *   The checkpoint is written only after Neynar accepts the cast.
 * - **A late run still sends its slot's post.** GitHub starts this
 *   repository's crons hours late, so a post stays due for
 *   `LATE_GRACE_DAYS` after its date. Older than that, it is skipped rather
 *   than sent out of step with the X half.
 * - **Background work never outspends users.** A cast is one Neynar credit
 *   and draws on the same pool as live lookups, so it goes through
 *   `checkBackgroundBudget` like every other cron. No --force here on
 *   purpose: an automated job must never carry the override a human uses.
 * - **An exhausted queue fails the run.** Until 2026-10-13 it exited 0 with
 *   a warning annotation, and the queue ran dry on 2026-10-10 with every run
 *   after it green: nothing was cast for days and nothing looked wrong. Now
 *   a run that finds nothing left exits 1, so the run is red and GitHub
 *   emails about it. The warning still starts `LOW_RUNWAY_POSTS` posts out,
 *   because a red run is the alarm and not the plan.
 * - **320 bytes displayed, 1024 the wall.** Farcaster truncates display past
 *   ~320 UTF-8 bytes and rejects past 1024. The queue checker enforces 320
 *   at PR time; this re-checks 1024 at send time as the last line.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { sql } from 'drizzle-orm';

import { getDb } from '../db';
import { checkBackgroundBudget, recordSpend } from '../lib/neynar-budget';
import {
  duePost,
  LATE_GRACE_DAYS,
  LOW_RUNWAY_POSTS,
  type SocialQueue,
} from '../lib/social-queue';

const API = 'https://api.neynar.com';
const STATE_KEY = 'daily_cast_state';
const CARD_BASE = 'https://walletlink.social/social-card';

function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The last cast's date and slug, or nulls when nothing has been cast. */
async function lastCast(): Promise<{
  last: string | null;
  slug: string | null;
}> {
  const db = getDb();
  if (!db) return { last: null, slug: null };
  const result = (await db.execute(sql`
    SELECT value->>'last' AS last, value->>'slug' AS slug
    FROM ingest_state WHERE name = ${STATE_KEY}
  `)) as unknown as {
    rows: Array<{ last: string | null; slug: string | null }>;
  };
  return result.rows[0] ?? { last: null, slug: null };
}

async function markCast(today: string, slug: string): Promise<void> {
  const db = getDb();
  // Throwing, not returning: a cast that cannot be checkpointed would be
  // re-sent by the next retry, and the send path refuses to start without a
  // database for exactly that reason, so reaching here without one is a bug.
  if (!db) throw new Error('no database; checkpoint cannot be written');
  await db.execute(sql`
    INSERT INTO ingest_state (name, value, updated_at)
    VALUES (
      ${STATE_KEY},
      jsonb_build_object('last', ${today}::text, 'slug', ${slug}::text),
      now()
    )
    ON CONFLICT (name) DO UPDATE SET
      value = jsonb_build_object('last', ${today}::text, 'slug', ${slug}::text),
      updated_at = now()
  `);
}

const REFILL = 'Refill content/social/queue.json by PR.';

async function main() {
  const send = process.argv.includes('--send');
  const today = utcToday();

  const queue: SocialQueue = JSON.parse(
    readFileSync(join(process.cwd(), 'content/social/queue.json'), 'utf8')
  );
  const due = duePost(queue.days, today);

  switch (due.kind) {
    case 'empty':
      console.log(
        `::error::the social queue is empty. Nothing was cast. ${REFILL}`
      );
      process.exit(1);
    case 'exhausted':
      // A failure, deliberately: see "An exhausted queue fails the run".
      console.log(
        `::error::the social queue ran dry. Its last post (${due.last.day}, ${due.last.slug}) was due ${due.last.date}, ${due.daysSince} days ago, and nothing is queued after it. Nothing was cast. ${REFILL}`
      );
      process.exit(1);
    case 'not-started':
      console.log(
        `nothing to cast yet: the first post (${due.next.day}, ${due.next.slug}) is due ${due.next.date}`
      );
      return;
    case 'between':
      console.log(
        `no post is due today (${today}); the next (${due.next.day}, ${due.next.slug}) is due ${due.next.date}`
      );
      return;
    case 'due':
      break;
  }

  const { post: entry, remaining } = due;
  if (remaining === 0) {
    console.log(
      `::warning::this is the last post in the social queue, and the first run more than ${LATE_GRACE_DAYS} day(s) after ${entry.date} fails until it is refilled. ${REFILL}`
    );
  } else if (remaining <= LOW_RUNWAY_POSTS) {
    const last = queue.days[queue.days.length - 1];
    console.log(
      `::warning::${remaining} post(s) left in the social queue after this one, the last due ${last.date}. ${REFILL}`
    );
  }

  const text = entry.fc.text;
  const embed = `${CARD_BASE}/${entry.slug}`;

  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > 1024) {
    console.error(`cast is ${bytes} bytes; the hard limit is 1024`);
    process.exit(1);
  }

  console.log(
    `post ${entry.day} (${entry.slug}), due ${entry.date}, as @walletlink:`
  );
  console.log(text.replace(/^/gm, '  '));
  console.log(`  embed: ${embed}`);

  // Two conditions, and both are needed. The slug says this post went out,
  // which is what a late run or a retry needs to know. The date keeps a UTC
  // day to one cast even if the queue changed under it: a PR that renames
  // the day's slug, or slots a post in for today after today's has gone,
  // would otherwise pass the slug test and post twice.
  const previous = await lastCast();
  if (previous.slug === entry.slug || previous.last === today) {
    console.log(
      `already cast (${previous.slug} on ${previous.last}); nothing to do`
    );
    return;
  }

  if (!send) {
    console.log('\ndry run: nothing sent. Re-run with --send to publish.');
    return;
  }

  const signerUuid = process.env.NEYNAR_SIGNER_UUID;
  if (!process.env.NEYNAR_API_KEY || !signerUuid) {
    console.error('NEYNAR_API_KEY and NEYNAR_SIGNER_UUID are required');
    process.exit(1);
  }

  // No database means no idempotency checkpoint and no budget counter: the
  // budget guard fails open by design, so without this gate a missing
  // DATABASE_URL would publish AND forget it published, and the next retry
  // would send the same day again. Dry runs stay allowed; sending does not.
  if (!getDb()) {
    console.error(
      'refused: DATABASE_URL is not set, so the daily checkpoint cannot be written and a retry would double-post'
    );
    process.exit(1);
  }

  const budget = await checkBackgroundBudget(1);
  if (!budget.allowed) {
    console.error(
      `refused by the background budget: ${budget.reason ?? 'over ceiling'} ` +
        `(spent ${budget.spent.toLocaleString()} of ${budget.ceiling.toLocaleString()})`
    );
    process.exit(1);
  }

  const res = await fetch(`${API}/v2/farcaster/cast`, {
    method: 'POST',
    headers: {
      'x-api-key': process.env.NEYNAR_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      signer_uuid: signerUuid,
      text,
      embeds: [{ url: embed }],
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`cast failed: ${res.status} ${JSON.stringify(body)}`);
    process.exit(1);
  }

  console.log(`\npublished: hash ${body.cast?.hash}`);
  await recordSpend(1);
  await markCast(today, entry.slug);
}

main().catch((e) => {
  console.error('daily cast failed:', e.message ?? e);
  process.exit(1);
});
