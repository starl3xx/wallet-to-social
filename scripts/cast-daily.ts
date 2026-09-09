/**
 * Cast today's queued post as @walletlink. The Farcaster half of the daily
 * social pipeline; the X half is scheduled in Typefully and never touches
 * this script.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/cast-daily.ts            # dry run
 *   npx tsx --env-file=.env.local scripts/cast-daily.ts --send     # publish
 *
 * The queue is `content/social/queue.json`: a start date plus one entry per
 * day, each carrying both platforms' texts and a card slug. Day N is
 * `start + (N-1)` in UTC. The cast embeds the day's on-brand card, rendered
 * live by `/social-card/[slug]` so the figures on it are read at view time,
 * and carries the CTA link in the text so it stays clickable.
 *
 * ## The rules this enforces
 *
 * - **One cast per UTC day, idempotent.** The last cast date is checkpointed
 *   in `ingest_state` (`daily_cast_state`), so a re-run, a manual dispatch
 *   after the cron, or an Actions retry sends nothing twice. The checkpoint
 *   is written only after Neynar accepts the cast.
 * - **Background work never outspends users.** A cast is one Neynar credit
 *   and draws on the same pool as live lookups, so it goes through
 *   `checkBackgroundBudget` like every other cron. No --force here on
 *   purpose: an automated job must never carry the override a human uses.
 * - **An exhausted queue is loud, not silent.** The job exits 0 (an empty
 *   queue is not a failure) but prints a GitHub Actions warning from three
 *   days out, because the failure mode of every content pipeline is quietly
 *   running dry.
 * - **320 bytes displayed, 1024 the wall.** Farcaster truncates display past
 *   ~320 UTF-8 bytes and rejects past 1024. The queue checker enforces 320
 *   at PR time; this re-checks 1024 at send time as the last line.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { sql } from 'drizzle-orm';

import { getDb } from '../db';
import { checkBackgroundBudget, recordSpend } from '../lib/neynar-budget';

const API = 'https://api.neynar.com';
const STATE_KEY = 'daily_cast_state';
const CARD_BASE = 'https://walletlink.social/social-card';

interface QueueDay {
  day: number;
  slug: string;
  x: { text: string; link: string };
  fc: { text: string; link: string };
}
interface Queue {
  start: string; // YYYY-MM-DD, UTC, day 1
  days: QueueDay[];
}

function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function dayIndex(start: string, today: string): number {
  const ms =
    Date.parse(`${today}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`);
  return Math.floor(ms / 86_400_000);
}

async function lastCastDate(): Promise<string | null> {
  const db = getDb();
  if (!db) return null;
  const result = (await db.execute(sql`
    SELECT value->>'last' AS last FROM ingest_state WHERE name = ${STATE_KEY}
  `)) as unknown as { rows: Array<{ last: string | null }> };
  return result.rows[0]?.last ?? null;
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

async function main() {
  const send = process.argv.includes('--send');
  const today = utcToday();

  const queue: Queue = JSON.parse(
    readFileSync(join(process.cwd(), 'content/social/queue.json'), 'utf8')
  );
  const idx = dayIndex(queue.start, today);

  if (idx < 0) {
    console.log(`queue starts ${queue.start}; nothing to cast yet`);
    return;
  }
  if (idx >= queue.days.length) {
    console.log(
      `::warning::the social queue is exhausted (ended ${queue.days.length} days after ${queue.start}). Nothing was cast today; refill content/social/queue.json.`
    );
    return;
  }
  const remaining = queue.days.length - idx - 1;
  if (remaining <= 3) {
    console.log(
      `::warning::${remaining} day(s) of social queue left after today. Refill content/social/queue.json.`
    );
  }

  const entry = queue.days[idx];
  const text = entry.fc.text;
  const embed = `${CARD_BASE}/${entry.slug}`;

  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > 1024) {
    console.error(`cast is ${bytes} bytes; the hard limit is 1024`);
    process.exit(1);
  }

  console.log(`day ${entry.day} (${entry.slug}) as @walletlink:`);
  console.log(text.replace(/^/gm, '  '));
  console.log(`  embed: ${embed}`);

  const already = await lastCastDate();
  if (already === today) {
    console.log(`already cast today (${today}); nothing to do`);
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
