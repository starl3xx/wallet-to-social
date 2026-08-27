/**
 * A personal check-in to every account that signed in and never bought.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/checkin-nonbuyers.ts                # dry run, prints the split and every draft
 *   npx tsx --env-file=.env.local scripts/checkin-nonbuyers.ts --to a@b.c     # preview EVERY variant to one address
 *   npx tsx --env-file=.env.local scripts/checkin-nonbuyers.ts --send         # send
 *   npx tsx --env-file=.env.local scripts/checkin-nonbuyers.ts --send --per-variant 10
 *   npx tsx --env-file=.env.local scripts/checkin-nonbuyers.ts --send --variant has-credits
 *
 * ## Why there are three variants and not one
 *
 * The obvious version of this email offers a free Trial pack to everyone who
 * has not bought. Measured on 2026-08-27, that would have offered a $29 pack
 * to 96 people who were given one on 2026-08-23 and have not touched it: of
 * 25,000 granted matches, 3 were consumed, across 2 accounts. Offering someone
 * a gift they are already sitting on is the one thing a message that opens
 * "I wanted to personally check in" cannot survive, because it proves nobody
 * looked.
 *
 * So the segment splits on what the account already holds:
 *
 *   has-credits   holds a granted pack, untouched. No offer. The unused pack
 *                 IS the reason for writing, and the question is what got in
 *                 the way.
 *   used-credits  holds a granted pack and has spent some of it. No offer
 *                 either, and no "you haven't used it": they have, so they are
 *                 the only ones with an experience to report, and the email
 *                 asks about that instead. Two accounts today, and the most
 *                 valuable two replies available.
 *   no-credits    holds nothing at all. The offer stands, as originally
 *                 drafted.
 *
 * The first version of this split had two variants keyed on `consumed = 0`,
 * which routed a partly-spent grant into `no-credits` and offered those two
 * accounts a pack they were already holding: the precise failure the split
 * exists to prevent, reintroduced by the split itself.
 *
 * All three are plain text from a person, sent through `sendPlainEmail`, so
 * none of them arrives inside the campaign template.
 *
 * ## What "never bought" means here
 *
 * `amount_cents > 0` on any lot. A hand-issued grant is not a sale, which is
 * the same test `getUserCohorts` uses and the same sentence CHANGELOG uses for
 * `bookSale`. Legacy tiers and whitelisted accounts are excluded because they
 * hold access they did not buy through this path, and opted-out accounts
 * because they said not to.
 *
 * ## Idempotency
 *
 * One `lifecycle_emails` row per account under this key, written after a
 * successful send, so a re-run retries only the failures. That ledger is also
 * what makes the daily drip resumable: an account already written to is not
 * selected again, so running this once a day walks the queue without holding
 * any state of its own. The key is shared by
 * all three variants: a person gets this check-in once, whichever version they
 * were eligible for on the day.
 *
 * Requires in .env.local: DATABASE_URL (owner), RESEND_API_KEY,
 * EMAIL_UNSUBSCRIBE_SECRET. The secret must match Vercel's, or the unsubscribe
 * links in delivered mail will not verify.
 */

import { neon } from '@neondatabase/serverless';

// The unsubscribe links must carry the production origin unconditionally:
// `.env.local` legitimately points NEXT_PUBLIC_URL at localhost for `next
// dev`, and a defaulting `||=` would mail people links to a dead port.
process.env.NEXT_PUBLIC_URL = 'https://walletlink.social';

const EMAIL_KEY = 'checkin-nonbuyers-2026-08';

/**
 * From and reply-to are the same human address, which is the whole point.
 *
 * `sendLifecycleEmail` sends as `noreply@` with a `help@` reply-to, correct
 * for a campaign. A note asking "let me know" that arrives from `noreply@`
 * contradicts itself in the header before the first line is read.
 */
const FROM = 'starl3xx <starl3xx@walletlink.social>';
const REPLY_TO = 'starl3xx@walletlink.social';

/**
 * A copy of every send, because a script's mail exists in nobody's Sent
 * folder. Without this the only record is a ledger row asserting it happened.
 */
const ARCHIVE_BCC = 'help@walletlink.social';

type Variant = 'has-credits' | 'used-credits' | 'no-credits';

interface Recipient {
  id: string;
  email: string;
  variant: Variant;
}

/**
 * The check-in for somebody who already has the pack and has not spent it.
 *
 * No offer, and no apology for the grant either. It names the thing that is
 * already true, asks one question, and stops. The question is deliberately
 * about the obstacle rather than about the product: "what did you think" is
 * answerable with nothing, and "what got in the way" is not.
 */
function hasCreditsContent(): { subject: string; text: string } {
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
 * The check-in for somebody who was granted a pack and has actually used it.
 *
 * The only variant written to somebody with a real experience of the product,
 * so it is the only one that can ask about the results rather than about the
 * obstacle. No offer: they are holding the pack, and the rest of it is still
 * there.
 */
function usedCreditsContent(): { subject: string; text: string } {
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

/**
 * The check-in for somebody holding nothing. Jake's original draft, with the
 * offer intact.
 */
function noCreditsContent(): { subject: string; text: string } {
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

const CONTENT: Record<Variant, () => { subject: string; text: string }> = {
  'has-credits': hasCreditsContent,
  'used-credits': usedCreditsContent,
  'no-credits': noCreditsContent,
};

async function main() {
  const args = process.argv.slice(2);
  const send = args.includes('--send');
  const capIdx = args.indexOf('--per-variant');
  const parsedCap = capIdx >= 0 ? parseInt(args[capIdx + 1], 10) : NaN;
  /**
   * Five a variant a day, Jake's call on 2026-08-27. Small enough that a reply
   * can be answered by a person the same day, which is the entire point of a
   * check-in, and small enough that copy that lands badly is discovered on the
   * fifth recipient rather than the ninety-fourth.
   */
  const dailyCap = Number.isFinite(parsedCap) && parsedCap > 0 ? parsedCap : 5;
  const toIdx = args.indexOf('--to');
  const previewTo = toIdx >= 0 ? args[toIdx + 1] : null;
  const variantIdx = args.indexOf('--variant');
  const onlyVariant =
    variantIdx >= 0 ? (args[variantIdx + 1] as Variant) : null;

  if (onlyVariant && !(onlyVariant in CONTENT)) {
    console.error(
      `--variant must be one of: ${Object.keys(CONTENT).join(', ')}`
    );
    process.exit(1);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const { sendPlainEmail } = await import('../lib/email');

  if (previewTo) {
    for (const variant of Object.keys(CONTENT) as Variant[]) {
      if (onlyVariant && variant !== onlyVariant) continue;
      const c = CONTENT[variant]();
      console.log(`preview [${variant}] to ${previewTo}`);
      const result = await sendPlainEmail({
        to: previewTo,
        from: FROM,
        replyTo: REPLY_TO,
        subject: `[${variant}] ${c.subject}`,
        text: c.text,
      });
      console.log(result.success ? '  sent' : `  failed: ${result.error}`);
      await new Promise((r) => setTimeout(r, 600));
    }
    return;
  }

  const sql = neon(databaseUrl);

  /**
   * Two questions, in this order: do they hold anything, and did they use it.
   *
   * `holds_lot` is what decides whether the offer appears, and it must be
   * "any lot at all" rather than "an unspent one". Keying the offer on
   * `consumed = 0` puts a partly-spent grant into the no-credits arm and
   * offers those accounts a pack they are holding, which is the failure this
   * whole split exists to prevent.
   *
   * `spent_lot` then only chooses which no-offer wording is true of them.
   */
  const rows = (await sql`
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
      -- Never bought. A hand-issued grant is not a sale.
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
  `) as unknown as Array<{
    id: string;
    email: string;
    holds_lot: boolean;
    spent_lot: boolean;
  }>;

  const recipients: Recipient[] = rows.map((r) => ({
    id: r.id,
    email: r.email,
    variant: !r.holds_lot
      ? 'no-credits'
      : r.spent_lot
        ? 'used-credits'
        : 'has-credits',
  }));

  const eligible = recipients.filter(
    (r) => !onlyVariant || r.variant === onlyVariant
  );

  /**
   * The daily cap is per variant, not per run.
   *
   * `--limit` bounds the whole run and takes its rows in signup order, so on a
   * mixed set it would spend the entire day's quota on whichever variant
   * happens to hold the oldest accounts: `has-credits` is 94 of the 133, so a
   * shared cap of five would have sent nothing to the other two arms for
   * eighteen days. Each arm gets its own five so all three start today, and
   * the batch that finishes first simply stops.
   *
   * Ordering inside a variant stays signup order, oldest first, which is the
   * order these accounts have been waiting in.
   */
  const perVariant = new Map<Variant, number>();
  const selected = eligible.filter((r) => {
    const taken = perVariant.get(r.variant) ?? 0;
    if (taken >= dailyCap) return false;
    perVariant.set(r.variant, taken + 1);
    return true;
  });

  const remaining = eligible.reduce<Record<string, number>>((acc, r) => {
    acc[r.variant] = (acc[r.variant] ?? 0) + 1;
    return acc;
  }, {});
  const counts = selected.reduce<Record<string, number>>((acc, r) => {
    acc[r.variant] = (acc[r.variant] ?? 0) + 1;
    return acc;
  }, {});
  console.log(
    'still to reach:',
    JSON.stringify(remaining),
    `total ${eligible.length}`
  );
  console.log(
    `this run (cap ${dailyCap}/variant):`,
    JSON.stringify(counts),
    `total ${selected.length}`
  );

  if (!send) {
    for (const variant of Object.keys(CONTENT) as Variant[]) {
      if (onlyVariant && variant !== onlyVariant) continue;
      const c = CONTENT[variant]();
      console.log(
        `\n──────── ${variant} (${counts[variant] ?? 0} recipients) ────────`
      );
      console.log(`From:     ${FROM}`);
      console.log(`Reply-To: ${REPLY_TO}`);
      console.log(`Bcc:      ${ARCHIVE_BCC}`);
      console.log(`Subject:  ${c.subject}\n`);
      console.log(c.text);
    }
    console.log('\ndry run: nothing sent. Re-run with --send to execute.');
    return;
  }

  let sent = 0;
  let failed = 0;

  for (const r of selected) {
    const c = CONTENT[r.variant]();
    const result = await sendPlainEmail({
      to: r.email,
      from: FROM,
      replyTo: REPLY_TO,
      subject: c.subject,
      text: c.text,
      bcc: ARCHIVE_BCC,
    });

    if (result.success) {
      // After the send, never before: this row records a delivery, not a
      // claim, so a failed send leaves nothing to reclaim and simply retries.
      await sql`
        INSERT INTO lifecycle_emails (user_id, email_key, confirmed_at)
        VALUES (${r.id}, ${EMAIL_KEY}, now())
        ON CONFLICT (user_id, email_key) DO NOTHING
      `;
      sent += 1;
    } else {
      failed += 1;
      console.error(`send failed for ${r.id}: ${result.error}`);
    }

    // Resend's default rate limit is 2 requests per second.
    await new Promise((res) => setTimeout(res, 600));
  }

  console.log(`\nsent: ${sent}, failed: ${failed}`);
  if (failed > 0) {
    console.log('re-run with --send to retry the failures.');
  }
}

main().catch((e) => {
  console.error('check-in campaign failed:', e);
  process.exit(1);
});
