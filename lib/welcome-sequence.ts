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
        `You have ${FREE_MATCHES_PER_WINDOW} free matches every ${FREE_WINDOW_DAYS} days. A match is a wallet we resolve to an X or Farcaster account. **Wallets we can’t resolve cost nothing**, so a low-match list spends almost none of your allowance.`,
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
        'The chain decides the number more than the collection does. Measured across 26 collections and 72,318 holders: Base runs 46.2%, Ethereum 16.6%. The industry average for wallet-to-social is about 2.5%. The full coverage breakdown, ours and the average, is in our docs.',
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

export async function runWelcomeSequence(): Promise<WelcomeRunOutcome> {
  const db = getDb();
  if (!db) return { due: 0, sent: 0, failed: 0, byKey: {} };

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
      WHERE u.created_at >= ${SEQUENCE_START}
        AND u.created_at <= now() - make_interval(days => ${e.day})
        AND u.email_opt_out = false
        AND u.tier NOT IN ('pro', 'unlimited')
        AND NOT EXISTS (
          SELECT 1 FROM whitelist w WHERE lower(w.email) = lower(u.email)
        )
        AND NOT EXISTS (SELECT 1 FROM credit_lots cl WHERE cl.user_id = u.id)
        AND NOT EXISTS (
          SELECT 1 FROM lifecycle_emails le
          WHERE le.user_id = u.id AND le.email_key = ${e.key}
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
    const result = await sendLifecycleEmail(d.email, email.content);
    if (result.success) {
      await db.execute(sql`
        INSERT INTO lifecycle_emails (user_id, email_key)
        VALUES (${d.userId}, ${d.key})
        ON CONFLICT (user_id, email_key) DO NOTHING
      `);
      outcome.sent += 1;
      outcome.byKey[d.key] = (outcome.byKey[d.key] ?? 0) + 1;
    } else {
      outcome.failed += 1;
      console.error(`welcome ${d.key} failed for user ${d.userId}: ${result.error}`);
    }
    // Resend's default rate limit is 2 requests per second.
    await new Promise((r) => setTimeout(r, 600));
  }

  return outcome;
}
