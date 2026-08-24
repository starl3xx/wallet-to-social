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
 * never enrolled.
 *
 * ## How a send is made at-most-once
 *
 * Two runners now select welcome-1: the five-minute first-touch cron and the
 * daily runner's day-0 safety net. claimAndSend takes the lifecycle_emails row
 * before it sends and writes confirmed_at after, so the unique on (user, key)
 * acts as the lock rather than recording a race after the fact, and a row
 * proves delivery rather than intent.
 *
 * One stated exception: a process killed between a successful send and the
 * confirm leaves a claim that reclaimStaleClaims frees after 15 minutes, and
 * that person receives the email twice. The window resolves in favour of
 * sending on purpose.
 *
 * A failed send is recorded on the row (attempts, failed_at, last_error) and
 * retried on an exponential backoff up to RETRY_CEILING, rather than deleted.
 * Deleting it put the account straight back into the eligible set, which the
 * five-minute cadence turns into an unbounded retry loop.
 *
 * ## Pacing
 *
 * The day gates make a missed cron day catch up without bunching: within a
 * single run of the daily runner a user gets at most one sequence email. That
 * is per run, not per day, and the two runners are separate runs: a user whose
 * welcome-1 is sent by the first-touch cron at 14:58 can receive welcome-2 from
 * the daily runner at 15:00 if they are already two days old, which happens
 * only to an account whose welcome-1 was delayed for two days by a failure.
 */
export const SEQUENCE_START = new Date('2026-08-23T00:00:00Z');

/** Sends per run, a circuit breaker rather than a quota. */
const MAX_SENDS_PER_RUN = 200;

/**
 * The five-minute runner's own cap, sized to its cadence rather than borrowing
 * the daily one.
 *
 * 200 sends at 600ms each is 120 seconds of sleeping alone, and the route's
 * maxDuration is 300. Add a slow provider and the run is killed partway, which
 * with claim-before-send leaves claims the reclaim has to collect 15 minutes
 * later. 100 still clears 28,800 welcome emails a day across 288 runs, which is
 * far more signups than this product will see, and it finishes in well under
 * half the budget.
 */
const FIRST_TOUCH_MAX_SENDS = 100;

/**
 * Stop sending and return cleanly before the platform kills the run. A clean
 * exit leaves no claim behind; a kill leaves one per interrupted send.
 */
const RUN_BUDGET_MS = 240_000;

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
/**
 * How many times one email may be attempted before it is left for a person.
 *
 * Five, because the failures worth retrying are transient (a provider blip, a
 * timeout) and clear well inside five tries, while the failures that are not
 * (an unverified domain, a missing secret) never clear no matter how many
 * times they are asked. The ceiling is what turns the second kind from an
 * unbounded loop into a bounded, visible cost.
 */
const RETRY_CEILING = 5;

/** Backoff step, doubling per attempt: 10, 20, 40, 80 minutes. */
const RETRY_BACKOFF_BASE_MINUTES = 5;

/**
 * Exponential backoff on the attempt count, written against the row because
 * the delay has to grow with that row's own attempts. `power` returns double
 * precision and make_interval takes an integer, so the cast is required.
 *
 * Two spellings of one rule, differing only in the alias: the claim addresses
 * the table it is upserting into, the selection addresses its correlated `le`.
 */
const RETRY_BACKOFF = sql`make_interval(mins => (${RETRY_BACKOFF_BASE_MINUTES} * power(2, lifecycle_emails.attempts))::int)`;
const RETRY_BACKOFF_LE = sql`make_interval(mins => (${RETRY_BACKOFF_BASE_MINUTES} * power(2, le.attempts))::int)`;

/**
 * A row that blocks selection this run, for any of four reasons: it was
 * delivered, another runner holds it right now, it has used up RETRY_CEILING,
 * or its backoff has not elapsed yet.
 *
 * Selection and the claim's DO UPDATE have to agree. If selection were looser,
 * every tick would pick users the claim then refuses; if it were tighter, a
 * retry would never be offered. Both are written from the same four states, so
 * a user reaches sendLifecycleEmail exactly when the row says they should.
 */
const NOT_SENDABLE = sql`(
  le.confirmed_at IS NOT NULL
  OR le.failed_at IS NULL
  OR le.attempts >= ${RETRY_CEILING}
  OR le.failed_at >= now() - ${RETRY_BACKOFF_LE}
)`;

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
   * `failed_at IS NULL` keeps it off recorded failures. Those rows are also
   * unconfirmed, but they are a retry schedule rather than an abandoned claim,
   * and deleting one would reset its attempt count and restart the loop this
   * whole mechanism exists to bound.
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
      AND failed_at IS NULL
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
 * ## Why a failure is written down instead of erased
 *
 * The first version deleted its claim when a send failed, which put the
 * account back in exactly the state that made it eligible. Under one daily
 * cron that was a retry a day. Under the five-minute runner it is 288 a day,
 * per account, forever, for any failure that does not fix itself: an
 * unverified sending domain, a rotated EMAIL_UNSUBSCRIBE_SECRET, a provider
 * outage. Nothing counted the attempts, so nothing could ever give up, and
 * `isEmailConfigured` only checks RESEND_API_KEY, so a whole class of
 * permanent refusal passes the route's precondition and lands in that loop.
 *
 * So the row stays and records the failure. The conflict target does double
 * duty: a fresh account inserts, and a previously failed one is re-taken by
 * the DO UPDATE, but only once its backoff has elapsed and only while it is
 * under RETRY_CEILING. A row held by another runner right now (unconfirmed,
 * not failed) matches neither and is left alone, which is the same mutual
 * exclusion the plain insert gave.
 *
 * The ceiling is the part that matters. A permanently broken configuration
 * costs RETRY_CEILING attempts per account and then stops, leaving a row a
 * person can see, rather than an unbounded loop against the provider.
 */
async function claimAndSend(
  db: NonNullable<ReturnType<typeof getDb>>,
  userId: string,
  email: string,
  emailKey: string,
  content: LifecycleEmailContent
): Promise<SendOutcome> {
  const claim = (await db.execute(sql`
    INSERT INTO lifecycle_emails (user_id, email_key, attempts)
    VALUES (${userId}, ${emailKey}, 1)
    ON CONFLICT (user_id, email_key) DO UPDATE
      SET sent_at    = now(),
          attempts   = lifecycle_emails.attempts + 1,
          failed_at  = NULL,
          last_error = NULL
      WHERE lifecycle_emails.confirmed_at IS NULL
        AND lifecycle_emails.failed_at IS NOT NULL
        AND lifecycle_emails.attempts < ${RETRY_CEILING}
        AND lifecycle_emails.failed_at < now() - ${RETRY_BACKOFF}
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
    UPDATE lifecycle_emails
    SET failed_at = now(), last_error = ${result.error ?? 'unknown'}
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
          AND ${NOT_SENDABLE}
      )
    ORDER BY u.created_at
    LIMIT ${FIRST_TOUCH_MAX_SENDS}
  `)) as unknown as { rows: Array<{ userId: string; email: string }> };

  const outcome: WelcomeRunOutcome = {
    due: rows.rows.length,
    sent: 0,
    failed: 0,
    byKey: {},
  };

  const startedAt = Date.now();
  for (const r of rows.rows) {
    if (Date.now() - startedAt > RUN_BUDGET_MS) {
      console.warn('welcome first-touch stopped on the run budget');
      break;
    }
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
   * One pass per email, lowest number first, and each pass demands that every
   * earlier email was *delivered*.
   *
   * That second half is not decoration. While selection asked only whether a
   * row existed, an undelivered welcome-1 still held the user on the first
   * pass, so they could never reach the second. Once selection started asking
   * whether the row was sendable, a welcome-1 that was backing off or
   * exhausted stopped matching that pass, the user fell through to welcome-2,
   * and they would have received the second email of a sequence whose first
   * email never arrived. The hold has to be stated rather than inherited from
   * the shape of another predicate.
   *
   * `delivered among the earlier keys = index` is the whole rule. At index 0
   * the array is empty and the count is 0, so it is vacuously true; at index 3
   * it demands welcome-1, welcome-2 and welcome-3 all confirmed. Exactly one
   * index can satisfy it for a given user, which is what makes the pacing
   * below a safety net rather than the mechanism.
   */
  const due: Array<{ userId: string; email: string; key: string }> = [];
  for (const [index, e] of WELCOME_EMAILS.entries()) {
    const earlierKeys = WELCOME_EMAILS.slice(0, index).map((p) => p.key);
    const rows = (await db.execute(sql`
      SELECT u.id AS "userId", u.email
      FROM users u
      WHERE ${ELIGIBLE_USER}
        AND u.created_at <= now() - make_interval(days => ${e.day})
        AND (
          SELECT count(*) FROM lifecycle_emails prev
          WHERE prev.user_id = u.id
            AND prev.email_key = ANY(${sql.param(earlierKeys)}::text[])
            AND prev.confirmed_at IS NOT NULL
        ) = ${index}
        AND NOT EXISTS (
          SELECT 1 FROM lifecycle_emails le
          WHERE le.user_id = u.id AND le.email_key = ${e.key}
            AND ${NOT_SENDABLE}
        )
      ORDER BY u.created_at
    `)) as unknown as { rows: Array<{ userId: string; email: string }> };
    for (const r of rows.rows) {
      // Belt and braces: the predicate above already admits a user to at most
      // one pass, so this can no longer fire. It stays because it is cheap and
      // because the last two bugs here were both a user reaching two passes.
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
