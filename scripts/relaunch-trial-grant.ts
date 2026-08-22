/**
 * The relaunch campaign: grant a Trial pack to every signup that never
 * bought, and tell them by email. One email, once, per account.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/relaunch-trial-grant.ts             # dry run
 *   npx tsx --env-file=.env.local scripts/relaunch-trial-grant.ts --to a@b.c  # send ONE preview email, no grant
 *   npx tsx --env-file=.env.local scripts/relaunch-trial-grant.ts --send      # grant + send to everyone eligible
 *   npx tsx --env-file=.env.local scripts/relaunch-trial-grant.ts --send --limit 5
 *
 * Eligible: an account that is not a legacy tier (pro/unlimited), holds no
 * credit lot of any kind, has not opted out of lifecycle mail, and has not
 * already received this email (lifecycle_emails key below).
 *
 * Idempotent at both steps. The grant carries the synthetic payment id
 * `grant-relaunch-2026-08:<userId>`, so the unique index on
 * credit_lots.stripe_payment_id makes a re-run skip it; the send is guarded
 * by the lifecycle_emails unique (user_id, email_key). Grant lands before
 * the email, so the email never announces credits that do not exist; a send
 * failure re-runs cleanly (grant skips, email retries).
 *
 * Requires in .env.local: DATABASE_URL (owner), RESEND_API_KEY,
 * EMAIL_UNSUBSCRIBE_SECRET. The same EMAIL_UNSUBSCRIBE_SECRET must be set in
 * Vercel before sending, or the unsubscribe links in delivered mail will not
 * verify.
 */

import { neon } from '@neondatabase/serverless';

// The unsubscribe and CTA links in a real send must carry the production
// origin. A local run would otherwise resolve getSiteUrl() to localhost,
// which is the class of bug lib/site-url.ts exists to prevent.
process.env.NEXT_PUBLIC_URL ||= 'https://walletlink.social';

const EMAIL_KEY = 'relaunch-trial-2026-08';
const GRANT_ID_PREFIX = 'grant-relaunch-2026-08:';

function campaignContent() {
  return {
    subject: 'We put 250 matches on your account',
    paragraphs: [
      'You signed up for walletlink.social a while back. The product has grown up since, and we would like you to see it, so we put a Trial pack on your account: 250 matches, the pack we sell for $29. Nothing to claim and no card to enter: sign in and the credits are there. They last 12 months like any pack.',
      'What changed since you signed up: the identity index reached 4.8 million wallets. Farcaster coverage is complete and refreshed daily. Every X handle carries a reachability label, live, suspended, or unclaimed, so you can drop the dead ones before you send. And reverse lookup answers the other direction: an X handle or Farcaster username in, the wallets behind it out.',
      'A match is a wallet we resolve to an X or Farcaster account, and misses cost nothing, so a low-match list barely spends the pack. Paste a contract address or upload a CSV. The pack unlocks priority ranking, the X list export, reverse lookup, deep scan, and all seven chains.',
    ],
    button: { label: 'Use your 250 matches', url: 'https://walletlink.social' },
    footnote:
      'You are getting this one email because you have a walletlink.social account and the credits are already on it. Questions: reply, a person reads it.',
  };
}

async function main() {
  const args = process.argv.slice(2);
  const send = args.includes('--send');
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : Infinity;
  const toIdx = args.indexOf('--to');
  const previewTo = toIdx >= 0 ? args[toIdx + 1] : null;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  // Imported here, after NEXT_PUBLIC_URL is pinned above.
  const { sendLifecycleEmail } = await import('../lib/email');

  if (previewTo) {
    console.log(`preview send to ${previewTo} (no grant, no ledger row)`);
    const result = await sendLifecycleEmail(previewTo, campaignContent());
    console.log(result.success ? 'sent' : `failed: ${result.error}`);
    return;
  }

  const sql = neon(databaseUrl);

  const eligible = (await sql`
    SELECT u.id, u.email
    FROM users u
    WHERE u.tier NOT IN ('pro', 'unlimited')
      AND u.email_opt_out = false
      AND NOT EXISTS (SELECT 1 FROM credit_lots cl WHERE cl.user_id = u.id)
      AND NOT EXISTS (
        SELECT 1 FROM lifecycle_emails le
        WHERE le.user_id = u.id AND le.email_key = ${EMAIL_KEY}
      )
    ORDER BY u.created_at
  `) as unknown as Array<{ id: string; email: string }>;

  console.log(`eligible accounts: ${eligible.length}`);

  if (!send) {
    console.log('dry run: no grants, no sends. Re-run with --send to execute.');
    return;
  }

  let granted = 0;
  let sent = 0;
  let failed = 0;

  for (const user of eligible.slice(0, limit === Infinity ? undefined : limit)) {
    const grantId = `${GRANT_ID_PREFIX}${user.id}`;

    const existing = (await sql`
      SELECT 1 FROM credit_lots WHERE stripe_payment_id = ${grantId}
    `) as unknown as unknown[];
    if (existing.length === 0) {
      await sql`
        INSERT INTO credit_lots
          (user_id, granted, pack, amount_cents, stripe_payment_id, note, expires_at)
        VALUES
          (${user.id}, 250, 'trial', 0, ${grantId},
           'Relaunch grant 2026-08: Trial pack for every signup that never bought',
           now() + interval '365 days')
      `;
      granted += 1;
    }

    const result = await sendLifecycleEmail(user.email, campaignContent());
    if (result.success) {
      await sql`
        INSERT INTO lifecycle_emails (user_id, email_key)
        VALUES (${user.id}, ${EMAIL_KEY})
        ON CONFLICT (user_id, email_key) DO NOTHING
      `;
      sent += 1;
    } else {
      failed += 1;
      console.error(`send failed for user ${user.id}: ${result.error}`);
    }

    // Resend's default rate limit is 2 requests per second.
    await new Promise((r) => setTimeout(r, 600));
  }

  console.log(`\ngranted: ${granted}, sent: ${sent}, failed: ${failed}`);
  if (failed > 0) {
    console.log('re-run with --send to retry the failures; grants and sends both skip what already succeeded.');
  }
}

main().catch((e) => {
  console.error('campaign failed:', e);
  process.exit(1);
});
