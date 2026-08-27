/**
 * The non-buyer check-in, by hand: inspect it, preview it, or push a slice.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/checkin-nonbuyers.ts                    # dry run: the split and every draft
 *   npx tsx --env-file=.env.local scripts/checkin-nonbuyers.ts --to a@b.c         # preview every variant to one address
 *   npx tsx --env-file=.env.local scripts/checkin-nonbuyers.ts --send             # send today's slice by hand
 *   npx tsx --env-file=.env.local scripts/checkin-nonbuyers.ts --send --per-variant 10
 *
 * The campaign itself lives in `lib/checkin-campaign.ts` and runs daily at
 * 16:00 UTC through `/api/cron/checkin-nonbuyers`. This file holds no copy and
 * no selection rules of its own: a second copy of either is how a campaign
 * ends up sending two different emails depending on who pressed what.
 *
 * A manual `--send` is safe beside the cron. Selection excludes anyone with a
 * `lifecycle_emails` row for the key, so the two cannot send the same person
 * twice; they only race for who sends today's slice.
 *
 * Requires in .env.local: DATABASE_URL, RESEND_API_KEY, EMAIL_UNSUBSCRIBE_SECRET.
 * The secret must match Vercel's, or delivered unsubscribe links will not verify.
 */

// Type-only, so it is erased at compile time and cannot load the module
// before NEXT_PUBLIC_URL is pinned below.
import type { Variant } from '../lib/checkin-campaign';

// The unsubscribe links must carry the production origin unconditionally:
// `.env.local` legitimately points NEXT_PUBLIC_URL at localhost for `next dev`,
// and a defaulting `||=` would mail people links to a dead port.
process.env.NEXT_PUBLIC_URL = 'https://walletlink.social';

async function main() {
  const args = process.argv.slice(2);
  const send = args.includes('--send');
  const capIdx = args.indexOf('--per-variant');
  const parsedCap = capIdx >= 0 ? parseInt(args[capIdx + 1], 10) : NaN;
  const toIdx = args.indexOf('--to');
  const previewTo = toIdx >= 0 ? args[toIdx + 1] : null;

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  // Imported after NEXT_PUBLIC_URL is pinned above.
  const {
    CONTENT,
    DEFAULT_PER_VARIANT,
    isPaused,
    runCheckinCampaign,
    selectPending,
    takeDaily,
  } = await import('../lib/checkin-campaign');
  const { sendPlainEmail } = await import('../lib/email');

  const perVariant =
    Number.isFinite(parsedCap) && parsedCap > 0
      ? parsedCap
      : DEFAULT_PER_VARIANT;

  if (previewTo) {
    for (const variant of Object.keys(CONTENT) as Variant[]) {
      const c = CONTENT[variant]();
      console.log(`preview [${variant}] to ${previewTo}`);
      const result = await sendPlainEmail({
        to: previewTo,
        from: 'starl3xx <starl3xx@walletlink.social>',
        replyTo: 'starl3xx@walletlink.social',
        subject: `[${variant}] ${c.subject}`,
        text: c.text,
      });
      console.log(result.success ? '  sent' : `  failed: ${result.error}`);
      await new Promise((r) => setTimeout(r, 600));
    }
    return;
  }

  if (await isPaused()) {
    console.log(
      'campaign is PAUSED in ingest_state. Nothing will send, by cron or by hand.'
    );
    if (send) return;
  }

  const pending = await selectPending();
  const today = takeDaily(pending, perVariant);

  const tally = (rows: { variant: string }[]) =>
    rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.variant] = (acc[r.variant] ?? 0) + 1;
      return acc;
    }, {});

  console.log(
    'still to reach:',
    JSON.stringify(tally(pending)),
    `total ${pending.length}`
  );
  console.log(
    `next slice (cap ${perVariant}/variant):`,
    JSON.stringify(tally(today)),
    `total ${today.length}`
  );

  if (!send) {
    for (const variant of Object.keys(CONTENT) as Variant[]) {
      const c = CONTENT[variant]();
      console.log(`\n──────── ${variant} ────────`);
      console.log(`Subject: ${c.subject}\n`);
      console.log(c.text);
    }
    console.log('\ndry run: nothing sent. Re-run with --send to execute.');
    return;
  }

  const outcome = await runCheckinCampaign(perVariant);
  console.log(`\n${JSON.stringify(outcome)}`);
}

main().catch((e) => {
  console.error('check-in campaign failed:', e);
  process.exit(1);
});
