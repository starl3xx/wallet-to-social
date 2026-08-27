import { getDb } from '@/db';
import { sql } from 'drizzle-orm';
import { sendPlainEmail } from '@/lib/email';

/**
 * The non-buyer check-in: selection, copy and the daily drip.
 *
 * Extracted from `scripts/checkin-nonbuyers.ts` when the run was automated, so
 * the cron and the CLI cannot drift into two campaigns. The script is now a
 * front end for a dry run, a preview and a manual push; this file decides who
 * gets what, and is the only thing that sends.
 *
 * ## Why there are three variants
 *
 * The obvious version offers a free Trial pack to everyone who has not bought.
 * Measured on 2026-08-27 that would have offered a $29 pack to 96 people who
 * were given one on 2026-08-23 and had not touched it: of 25,000 granted
 * matches, 3 were consumed, across 2 accounts. Offering somebody a gift they
 * are already sitting on is the one thing a message opening "I wanted to
 * personally check in" cannot survive, because it proves nobody looked.
 *
 * ## Running beside the welcome sequence is deliberate
 *
 * Accounts created on or after `SEQUENCE_START` are mid-onboarding when this
 * reaches them, so a `no-credits` reader can get this between welcome-2 and
 * welcome-3. Jake's call on 2026-08-27: a plain note from a person is a
 * different kind of mail from the branded sequence and the two can interleave.
 *
 * The one collision that would have mattered is already closed. This email
 * offers a free pack; welcome-5 asks the reader to buy one. Accepting the
 * offer gives the account credits, and welcome-5 stands down for credit
 * holders, so nobody is offered a pack free and then asked for $29.
 */

/** Written to `lifecycle_emails.email_key`. One check-in per account, ever. */
export const EMAIL_KEY = 'checkin-nonbuyers-2026-08';

/**
 * Five a variant a day, Jake's call on 2026-08-27.
 *
 * Small enough that a reply can be answered by a person the same day, which is
 * the entire point of a check-in, and small enough that copy landing badly is
 * discovered on the fifth recipient rather than the ninety-fourth.
 */
export const DEFAULT_PER_VARIANT = 5;

/**
 * From and reply-to are the same human address, which is the point.
 *
 * `sendLifecycleEmail` sends as `noreply@` with a `help@` reply-to, correct for
 * a campaign. A note asking "let me know" that arrives from `noreply@`
 * contradicts itself in the header before the first line is read.
 */
const FROM = 'starl3xx <starl3xx@walletlink.social>';
const REPLY_TO = 'starl3xx@walletlink.social';

/**
 * A copy of every send, because a script's mail exists in nobody's Sent
 * folder. Without it the only record is a ledger row asserting it happened.
 */
const ARCHIVE_BCC = 'help@walletlink.social';

export type Variant = 'has-credits' | 'used-credits' | 'no-credits';

export interface Recipient {
  id: string;
  email: string;
  variant: Variant;
}

export interface CampaignContent {
  subject: string;
  text: string;
}

/**
 * The check-in for somebody who has the pack and has not spent it.
 *
 * No offer, and no apology for the grant either. It names what is already
 * true, asks one question, and stops. The question is about the obstacle
 * rather than the product: "what did you think" is answerable with nothing,
 * "what got in the way" is not.
 */
function hasCreditsContent(): CampaignContent {
  return {
    subject: 'your walletlink account',
    text: `Hey there,

I wanted to check in personally. You have a Trial pack sitting on your walletlink.social account, 250 matches, and it looks like you haven't had a chance to use it yet.

That's usually a sign something got in the way rather than a lack of interest, and I'd genuinely like to know what it was. Too fiddly to get a wallet list together? Not the kind of data you needed? Something broke?

Whatever it is, I'd rather hear it than guess. Just hit reply, it comes straight to me.

- starl3xx
starl3xx@walletlink.social`,
  };
}

/**
 * For somebody who was granted a pack and has used it. The only variant
 * written to a reader with a real experience of the product, so the only one
 * that can ask about results rather than obstacles.
 */
function usedCreditsContent(): CampaignContent {
  return {
    subject: 'your walletlink account',
    text: `Hey there,

I wanted to check in personally. You've run some lookups on walletlink.social with the Trial pack that's on your account, so you're one of the few people who can tell me whether it actually did the job.

Did the matches you got back turn out to be useful? Anything obviously missing, or wrong?

The rest of the pack is still on your account either way. But I'd really like to hear how it went. Just hit reply, it comes straight to me.

- starl3xx
starl3xx@walletlink.social`,
  };
}

/** For somebody holding nothing. Jake's original draft, offer intact. */
function noCreditsContent(): CampaignContent {
  return {
    subject: 'your walletlink account',
    text: `Hey there,

I wanted to personally check in on your experience so far with walletlink.social.

What do you think? Have you run into any issues?

If you'd like to give it a more thorough evaluation, I'd be happy to gift you a Trial pack for free. It's the $29 pack: 250 social matches for wallets, and misses don't count. Just say the word.

- starl3xx
starl3xx@walletlink.social`,
  };
}

export const CONTENT: Record<Variant, () => CampaignContent> = {
  'has-credits': hasCreditsContent,
  'used-credits': usedCreditsContent,
  'no-credits': noCreditsContent,
};

/**
 * The pause switch, and why it is a row rather than an environment variable.
 *
 * An env var on Vercel takes effect on the next deployment, so stopping an
 * outbound campaign with one means waiting for a build while it keeps sending.
 * This is read at the top of every run, so a single UPDATE stops the campaign
 * before the next one:
 *
 *     INSERT INTO ingest_state (name, value, updated_at)
 *     VALUES ('checkin_campaign', '{"paused":true}'::jsonb, now())
 *     ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
 *
 * Absent means running. A campaign that has to be stopped is exactly the
 * campaign nobody wants to redeploy first.
 */
export async function isPaused(): Promise<boolean> {
  const db = getDb();
  if (!db) return true;
  try {
    const r = (await db.execute(sql`
      SELECT value->>'paused' AS paused
      FROM ingest_state WHERE name = 'checkin_campaign'
    `)) as unknown as { rows: Array<{ paused: string | null }> };
    return r.rows[0]?.paused === 'true';
  } catch (error) {
    // A campaign that cannot read its own switch does not send. The failure
    // mode of a pause switch has to be "stopped", or it is not a switch.
    console.error('check-in pause check failed, refusing to send:', error);
    return true;
  }
}

/**
 * Everyone still owed the check-in, oldest signup first.
 *
 * "Never bought" is `amount_cents > 0` on any lot: a hand-issued grant is not
 * a sale, the same test `getUserCohorts` uses. Legacy tiers and whitelisted
 * accounts hold access they did not buy through this path; opted-out accounts
 * said not to.
 *
 * The variant is decided by holding a lot at all, never by having spent
 * nothing. Keying it on `consumed = 0` puts a partly-spent grant in the offer
 * arm and offers those accounts a pack they are holding.
 */
export async function selectPending(): Promise<Recipient[]> {
  const db = getDb();
  if (!db) return [];

  const result = (await db.execute(sql`
    SELECT u.id, u.email,
           EXISTS (
             SELECT 1 FROM credit_lots cl WHERE cl.user_id = u.id
           ) AS holds_lot,
           EXISTS (
             SELECT 1 FROM credit_lots cl
             WHERE cl.user_id = u.id AND cl.consumed > 0
           ) AS spent_lot
    FROM users u
    WHERE u.tier NOT IN ('pro', 'unlimited')
      AND u.email_opt_out = false
      AND NOT EXISTS (
        SELECT 1 FROM credit_lots cl
        WHERE cl.user_id = u.id AND cl.amount_cents > 0
      )
      AND NOT EXISTS (
        SELECT 1 FROM whitelist w WHERE lower(w.email) = lower(u.email)
      )
      AND NOT EXISTS (
        SELECT 1 FROM lifecycle_emails le
        WHERE le.user_id = u.id AND le.email_key = ${EMAIL_KEY}
      )
    ORDER BY u.created_at
  `)) as unknown as {
    rows: Array<{
      id: string;
      email: string;
      holds_lot: boolean;
      spent_lot: boolean;
    }>;
  };

  return result.rows.map((r) => ({
    id: r.id,
    email: r.email,
    variant: !r.holds_lot
      ? 'no-credits'
      : r.spent_lot
        ? 'used-credits'
        : 'has-credits',
  }));
}

/**
 * Today's slice: up to `perVariant` from each arm.
 *
 * Per variant, not per run. A shared cap takes its rows in signup order, so it
 * would spend the whole day's quota on whichever variant holds the oldest
 * accounts: `has-credits` was 94 of 133, so a shared five would have sent
 * nothing to the other two arms for eighteen days.
 */
export function takeDaily(
  pending: Recipient[],
  perVariant: number
): Recipient[] {
  const taken = new Map<Variant, number>();
  return pending.filter((r) => {
    const n = taken.get(r.variant) ?? 0;
    if (n >= perVariant) return false;
    taken.set(r.variant, n + 1);
    return true;
  });
}

export interface CampaignOutcome {
  paused: boolean;
  pending: number;
  attempted: number;
  sent: number;
  failed: number;
  byVariant: Record<string, number>;
}

/** Send one day's slice. The ledger row is written only after a send lands. */
export async function runCheckinCampaign(
  perVariant: number = DEFAULT_PER_VARIANT
): Promise<CampaignOutcome> {
  const outcome: CampaignOutcome = {
    paused: false,
    pending: 0,
    attempted: 0,
    sent: 0,
    failed: 0,
    byVariant: {},
  };

  if (await isPaused()) {
    outcome.paused = true;
    return outcome;
  }

  const db = getDb();
  if (!db) return outcome;

  const pending = await selectPending();
  outcome.pending = pending.length;

  const today = takeDaily(pending, perVariant);
  outcome.attempted = today.length;

  for (const r of today) {
    const content = CONTENT[r.variant]();
    const result = await sendPlainEmail({
      to: r.email,
      from: FROM,
      replyTo: REPLY_TO,
      subject: content.subject,
      text: content.text,
      bcc: ARCHIVE_BCC,
    });

    if (result.success) {
      // After the send, never before: this row records a delivery, not a
      // claim, so a failure leaves nothing to reclaim and simply retries
      // tomorrow.
      await db.execute(sql`
        INSERT INTO lifecycle_emails (user_id, email_key, confirmed_at)
        VALUES (${r.id}, ${EMAIL_KEY}, now())
        ON CONFLICT (user_id, email_key) DO NOTHING
      `);
      outcome.sent += 1;
      outcome.byVariant[r.variant] = (outcome.byVariant[r.variant] ?? 0) + 1;
    } else {
      outcome.failed += 1;
      console.error(`check-in send failed for ${r.id}: ${result.error}`);
    }

    // Resend's default rate limit is 2 requests per second.
    await new Promise((res) => setTimeout(res, 600));
  }

  return outcome;
}
