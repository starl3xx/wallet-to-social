import { getDb } from '@/db';
import { sql } from 'drizzle-orm';
import { sendLifecycleEmail, type LifecycleEmailContent } from '@/lib/email';
import {
  INDEXED_WALLETS_LONG,
  X_HANDLES_RESOLVED,
  CHAIN_COUNT_WORD,
} from '@/lib/public-figures';
import {
  PACKS,
  FREE_MATCHES_PER_WINDOW,
  FREE_WINDOW_DAYS,
  CREDIT_LIFETIME_MONTHS,
} from '@/lib/packs';

/**
 * The welcome sequence: five lifecycle emails from signup to the Trial ask.
 *
 * The copy is `docs/EMAIL-SEQUENCE.md`, approved by Jake on 2026-08-22, held
 * here verbatim (inline `**bold**` and `*italic*` markers render in the
 * lifecycle template). One email, one job, one CTA; email 5 is the only ask,
 * and its footnote promise ("no more sales email after this one") is kept by
 * the schedule itself: there is no email 6.
 *
 * ## Who is enrolled
 *
 * Accounts created on or after SEQUENCE_START. The ~100 signups from before
 * are deliberately excluded: they are the relaunch campaign's audience
 * (scripts/relaunch-trial-grant.ts), and enrolling them here would send a
 * 200-day-old account five emails in two weeks. If the relaunch send is ever
 * abandoned, revisit the cutoff rather than quietly moving it.
 *
 * ## Exit rules
 *
 * A purchase (any credit lot) exits the sequence: the remaining emails sell
 * what the account already has. Opt-out exits everything, checked here as
 * well as enforced by sendLifecycleEmail's caller contract. Legacy tiers are
 * never enrolled. The lifecycle_emails unique on (user, key) makes every
 * send at-most-once, and the day gates make a missed cron day catch up
 * without bunching: a user gets at most one sequence email per run.
 */
export const SEQUENCE_START = new Date('2026-08-23T00:00:00Z');

/** Sends per run, a circuit breaker rather than a quota. */
const MAX_SENDS_PER_RUN = 200;

/**
 * How long welcome-1 waits behind the magic link.
 *
 * Zero would be wrong. The account row is written at magic-link *verify*, so
 * an inline send puts welcome-1 in the inbox in the same second as the
 * sign-in link the person is still looking for, and the one email they need
 * competes with the one they did not ask for. Five minutes clears the link,
 * and it is long enough that most people have run their first lookup, which
 * is the state welcome-1's copy assumes.
 */
export const FIRST_TOUCH_DELAY_MINUTES = 5;

interface WelcomeEmail {
  key: string;
  /** Days after signup this email becomes due. */
  day: number;
  content: LifecycleEmailContent;
}

const SITE = 'https://walletlink.social';

export const WELCOME_EMAILS: WelcomeEmail[] = [
  {
    key: 'welcome-1',
    day: 0,
    content: {
      subject: `Your first ${FREE_MATCHES_PER_WINDOW} matches are free`,
      paragraphs: [
        'Hey, thanks for signing up for walletlink.social. Here’s what you can do with it.',
        `Paste a contract address, or upload a CSV of wallets. We resolve each wallet against a ${INDEXED_WALLETS_LONG} wallet identity index and return the people: X handles and Farcaster accounts, ranked by holdings times reach.`,
        `You have ${FREE_MATCHES_PER_WINDOW} free matches in a rolling ${FREE_WINDOW_DAYS}-day window. A match is a wallet we resolve to an X or Farcaster account. **Wallets we can’t resolve cost nothing**, so a low-match list spends almost none of your allowance.`,
      ],
      button: { label: 'Run a lookup', url: SITE },
      footnote: 'If anything is unclear, just reply to this email!',
    },
  },
  {
    key: 'welcome-2',
    day: 2,
    content: {
      subject: 'What your chain says about your match rate',
      paragraphs: [
        'Most wallet tools quote one match rate. We quote *yours*.',
        'The chain decides the number more than the collection does. Measured across 26 collections and 72,318 holders: Base runs 46.2%, Ethereum 16.6%. Typical tools publish rates in the low single digits. The full coverage breakdown is in our docs.',
        'So before you plan a campaign, check the chain your holders live on. A Base token list resolves nearly half its wallets to an X or Farcaster account. An Ethereum list resolves fewer, and every one it resolves is labelled with the evidence behind it.',
      ],
      button: { label: 'Check your list', url: SITE },
      footnote:
        'You are getting a short series of emails because you created a walletlink.social account. The unsubscribe link below stops them.',
    },
  },
  {
    key: 'welcome-3',
    day: 5,
    content: {
      subject: 'A handle that reaches nobody is not a match',
      paragraphs: [
        `Of ${X_HANDLES_RESOLVED} X handles we resolved, 69.6% are live. 20.6% are suspended, and 9.7% are names nobody holds any more.`,
        'A single coverage number counts all three groups. We label every match with its **reachability**, because a campaign sent to dead handles is obviously worse than a smaller campaign sent to real ones.',
        'The same rule applies to how a match is made. Over 99.9% of our X handles were published by the account owner, through a Farcaster verification or an onchain ENS record. Nothing is guessed from display names or bios.',
      ],
      button: { label: 'See it on your list', url: SITE },
      footnote:
        'You are getting a short series of emails because you created a walletlink.social account. The unsubscribe link below stops them.',
    },
  },
  {
    key: 'welcome-4',
    day: 9,
    content: {
      subject: 'Does that handle already hold your token?',
      paragraphs: [
        'Two things people miss on the first lookup.',
        '**Reverse lookup**. Give it an X handle or a Farcaster username and it returns the wallets attached to that person. Useful before a partnership, an allowlist, or an airdrop: does this person already hold your token?',
        '**Priority**. Every result is ranked by holdings times follower reach, so the whale with an audience sits at the top of your list, not row 4,000.',
        `Both come with any credit pack, on all ${CHAIN_COUNT_WORD} chains.`,
      ],
      button: { label: 'Run a free lookup', url: SITE },
      footnote:
        'You are getting a short series of emails because you created a walletlink.social account. The unsubscribe link below stops them.',
    },
  },
  {
    key: 'welcome-5',
    day: 14,
    content: {
      subject: `${PACKS.trial.matches} matches, once: $${PACKS.trial.priceCents / 100}`,
      paragraphs: [
        'If walletlink.social showed you real matches, here’s the price:',
        `The ${PACKS.trial.name} pack is $${PACKS.trial.priceCents / 100}, once. It covers ${PACKS.trial.matches} matches, and misses are still free. No subscription; credits last ${CREDIT_LIFETIME_MONTHS} months. Every pack includes the full CSV export, the X list export, reverse lookup, priority ranking, deep scan with onchain ENS, and API access on the same credits.`,
        'If your free lookups showed few matches, do not buy. That’s the honest read of your list, and it is why we charge for matches instead of promises.',
      ],
      button: { label: 'Buy the Trial pack', url: `${SITE}/pricing` },
      footnote: 'You won’t get another sales email from us after this one.',
    },
  },
];

export interface WelcomeRunOutcome {
  due: number;
  sent: number;
  failed: number;
  byKey: Record<string, number>;
}

/**
 * Who the sequence may write to, as one fragment so the daily runner and the
 * five-minute first-touch runner cannot drift apart. Every exit rule in the
 * file header lives here: the cutoff, the opt-out, the legacy tiers, the
 * whitelist and the purchase.
 *
 * FIRST_TOUCH_DELAY_MINUTES belongs here rather than in the first-touch
 * runner, because it is a fact about the account and not about one cron. Held
 * only in the fast runner, the daily runner's day-0 pass still computed
 * `now() - 0 days`, so an account created at 14:59:30 got welcome-1 thirty
 * seconds later at 15:00, next to its own magic link: the exact collision the
 * delay exists to prevent. As a floor on eligibility no runner can reach a
 * person inside their first five minutes. For days 2 and up the day gate
 * dominates and this changes nothing.
 */
const ELIGIBLE_USER = sql`
  u.created_at >= ${SEQUENCE_START}
  AND u.created_at <= now() - make_interval(mins => ${FIRST_TOUCH_DELAY_MINUTES})
  AND u.email_opt_out = false
  AND u.tier NOT IN ('pro', 'unlimited')
  AND NOT EXISTS (
    SELECT 1 FROM whitelist w WHERE lower(w.email) = lower(u.email)
  )
  AND NOT EXISTS (SELECT 1 FROM credit_lots cl WHERE cl.user_id = u.id)
`;

/**
 * Selection asks whether an email was *delivered*, never whether a row exists.
 *
 * Once claimAndSend takes the row before sending, a bare `NOT EXISTS` reads an
 * in-flight claim as a completed send. The daily runner would then find no
 * welcome-1 pending, fall through to welcome-2, and deliver the second email
 * beside the first while the first was still leaving. The lowest-pending
 * ordering is the whole reason the daily runner loops in key order, so this is
 * the predicate that has to carry it.
 *
 * Selecting on `confirmed_at IS NOT NULL` holds that user at welcome-1 for the
 * run. If the other runner is mid-send, this run's INSERT loses the conflict
 * and sends nothing; if that send failed and released the claim, this run
 * retries it. Either way the user advances only after an email actually left.
 */
const DELIVERED = sql`le.confirmed_at IS NOT NULL`;

type SendOutcome = 'sent' | 'claimed-elsewhere' | 'failed';

/**
 * How long a claim may sit unredeemed before it is treated as abandoned.
 * Comfortably above the route's maxDuration of 300s, so a slow run in
 * progress is never mistaken for a dead one.
 */
const CLAIM_RECLAIM_MINUTES = 15;

/**
 * Delete claims that were taken and never confirmed.
 *
 * claimAndSend deletes its own claim when the send *returns* a failure, but it
 * cannot delete anything when the process does not return at all: a timeout, an
 * OOM or a deploy between the INSERT and the send leaves a row that every
 * runner reads as "already emailed". Nothing retries it and nobody is told.
 * That is the one failure mode claim-before-send introduced, and this is its
 * counterweight.
 *
 * The residual risk is deliberate and the other way round: if the process dies
 * after the send succeeded but before confirmed_at was written, the reclaim
 * frees the row and the person receives that email twice. One duplicate
 * greeting is a better failure than a welcome email that silently never
 * arrives, so the window resolves in favour of sending.
 */
async function reclaimStaleClaims(
  db: NonNullable<ReturnType<typeof getDb>>
): Promise<number> {
  /**
   * Scoped to this sequence's own keys, and that scope is load-bearing.
   *
   * lifecycle_emails is a shared ledger: the relaunch campaign writes to it
   * under its own key. An unscoped delete would treat any other sender's row
   * as an abandoned claim of ours, remove it, and let that campaign re-send to
   * accounts it had already mailed. A reclaim may only ever collect claims the
   * runner that reclaims could itself have taken.
   *
   * `sql.param(...)::text[]` and not a bare array. Drizzle expands a plain JS
   * array into one placeholder per element, so `ANY($1, $2, ...)` reaches
   * Postgres as "op ANY/ALL (array) requires array on right side" and the
   * statement throws. This runs first in both crons with nothing catching it,
   * so the bare form would have failed every run before a single send. It is
   * the same binding lib/x-accounts.ts and lib/clanker.ts already use.
   */
  const reclaimed = (await db.execute(sql`
    DELETE FROM lifecycle_emails
    WHERE confirmed_at IS NULL
      AND email_key = ANY(${sql.param(WELCOME_EMAILS.map((e) => e.key))}::text[])
      AND sent_at < now() - make_interval(mins => ${CLAIM_RECLAIM_MINUTES})
    RETURNING id
  `)) as unknown as { rows: Array<{ id: string }> };
  if (reclaimed.rows.length > 0) {
    console.warn(
      `reclaimed ${reclaimed.rows.length} abandoned lifecycle claim(s)`
    );
  }
  return reclaimed.rows.length;
}

/**
 * Take the row, then send.
 *
 * Both runners select welcome-1, and at 15:00 UTC they select it in the same
 * second. The unique on (user_id, email_key) already makes the *row*
 * at-most-once, but the row was written after the send, so two runners racing
 * delivered twice and inserted once: the constraint was recording the race,
 * not preventing it. Inserting first turns that unique into the lock. The
 * loser's INSERT hits the conflict, returns no row, and it does not send.
 *
 * A failed send releases the claim, so the next run retries it rather than
 * marking a person as emailed by an email that never left.
 */
async function claimAndSend(
  db: NonNullable<ReturnType<typeof getDb>>,
  userId: string,
  email: string,
  emailKey: string,
  content: LifecycleEmailContent
): Promise<SendOutcome> {
  const claim = (await db.execute(sql`
    INSERT INTO lifecycle_emails (user_id, email_key)
    VALUES (${userId}, ${emailKey})
    ON CONFLICT (user_id, email_key) DO NOTHING
    RETURNING id
  `)) as unknown as { rows: Array<{ id: string }> };

  if (claim.rows.length === 0) return 'claimed-elsewhere';

  const result = await sendLifecycleEmail(email, content);
  if (result.success) {
    // The row is now proof of delivery rather than of intent.
    await db.execute(sql`
      UPDATE lifecycle_emails
      SET confirmed_at = now()
      WHERE user_id = ${userId} AND email_key = ${emailKey}
    `);
    return 'sent';
  }

  await db.execute(sql`
    DELETE FROM lifecycle_emails
    WHERE user_id = ${userId} AND email_key = ${emailKey}
  `);
  console.error(`welcome ${emailKey} failed for user ${userId}: ${result.error}`);
  return 'failed';
}

/**
 * Welcome-1 only, every five minutes, for accounts that cleared
 * FIRST_TOUCH_DELAY_MINUTES. The daily runner still has a day-0 pass and is
 * left in place as the safety net: if this route stops, the first email is
 * late rather than lost, and claimAndSend keeps the overlap from doubling.
 */
export async function runWelcomeFirstTouch(): Promise<WelcomeRunOutcome> {
  const db = getDb();
  if (!db) return { due: 0, sent: 0, failed: 0, byKey: {} };

  await reclaimStaleClaims(db);

  const first = WELCOME_EMAILS[0];

  const rows = (await db.execute(sql`
    SELECT u.id AS "userId", u.email
    FROM users u
    WHERE ${ELIGIBLE_USER}
      AND NOT EXISTS (
        SELECT 1 FROM lifecycle_emails le
        WHERE le.user_id = u.id AND le.email_key = ${first.key}
          AND ${DELIVERED}
      )
    ORDER BY u.created_at
    LIMIT ${MAX_SENDS_PER_RUN}
  `)) as unknown as { rows: Array<{ userId: string; email: string }> };

  const outcome: WelcomeRunOutcome = {
    due: rows.rows.length,
    sent: 0,
    failed: 0,
    byKey: {},
  };

  for (const r of rows.rows) {
    const result = await claimAndSend(
      db,
      r.userId,
      r.email,
      first.key,
      first.content
    );
    if (result === 'sent') {
      outcome.sent += 1;
      outcome.byKey[first.key] = (outcome.byKey[first.key] ?? 0) + 1;
    } else if (result === 'failed') {
      outcome.failed += 1;
    }
    // Resend's default rate limit is 2 requests per second.
    await new Promise((r) => setTimeout(r, 600));
  }

  return outcome;
}

export async function runWelcomeSequence(): Promise<WelcomeRunOutcome> {
  const db = getDb();
  if (!db) return { due: 0, sent: 0, failed: 0, byKey: {} };

  await reclaimStaleClaims(db);

  /**
   * One pass per email, lowest number first: a user appears once per run
   * with their smallest pending email, so a missed cron day catches up one
   * email per user per run instead of bunching three into one morning.
   */
  const due: Array<{ userId: string; email: string; key: string }> = [];
  for (const e of WELCOME_EMAILS) {
    const rows = (await db.execute(sql`
      SELECT u.id AS "userId", u.email
      FROM users u
      WHERE ${ELIGIBLE_USER}
        AND u.created_at <= now() - make_interval(days => ${e.day})
        AND NOT EXISTS (
          SELECT 1 FROM lifecycle_emails le
          WHERE le.user_id = u.id AND le.email_key = ${e.key}
            AND ${DELIVERED}
        )
      ORDER BY u.created_at
    `)) as unknown as { rows: Array<{ userId: string; email: string }> };
    for (const r of rows.rows) {
      // Lowest pending email wins; a user already queued this run is skipped.
      if (!due.some((d) => d.userId === r.userId)) {
        due.push({ userId: r.userId, email: r.email, key: e.key });
      }
    }
  }

  const outcome: WelcomeRunOutcome = {
    due: due.length,
    sent: 0,
    failed: 0,
    byKey: {},
  };

  for (const d of due.slice(0, MAX_SENDS_PER_RUN)) {
    const email = WELCOME_EMAILS.find((e) => e.key === d.key)!;
    const result = await claimAndSend(db, d.userId, d.email, d.key, email.content);
    if (result === 'sent') {
      outcome.sent += 1;
      outcome.byKey[d.key] = (outcome.byKey[d.key] ?? 0) + 1;
    } else if (result === 'failed') {
      outcome.failed += 1;
    }
    // Resend's default rate limit is 2 requests per second.
    await new Promise((r) => setTimeout(r, 600));
  }

  return outcome;
}
