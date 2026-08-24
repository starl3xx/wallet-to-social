/**
 * Cast as @walletlink through the approved Neynar managed signer.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/cast-farcaster.ts "text"                    # dry run: prints, sends nothing
 *   npx tsx --env-file=.env.local scripts/cast-farcaster.ts "text" --send             # publish
 *   npx tsx --env-file=.env.local scripts/cast-farcaster.ts "text" --send --channel base
 *   npx tsx --env-file=.env.local scripts/cast-farcaster.ts "text" --send --embed https://walletlink.social/check
 *
 * Setup first: scripts/setup-farcaster-signer.ts (needs the signer approved).
 *
 * ## The budget rule this enforces
 *
 * Neynar pauses ALL API requests on overage, and lib/neynar.ts sits in the
 * live lookup path, so nothing optional spends while the period counter is
 * over the plan limit (the 2026-08 counter is; it resets 2026-09-01, UTC
 * month key). A cast is one credit, but the rule is the rule: the script
 * refuses over-limit sends without --force, and records its spend either
 * way. Channel note: pass the channel id ('base', not '/base'); posting to
 * a channel uses channel_id, the parent_url lesson from the Cubs bot does
 * not apply to Neynar's cast endpoint.
 */

import {
  getPeriodSpend,
  recordSpend,
  MONTHLY_CREDIT_LIMIT,
} from '../lib/neynar-budget';

const API = 'https://api.neynar.com';

async function main() {
  // One pass, so a value that belongs to --channel or --embed can never be
  // mistaken for the cast text however the flags are ordered.
  const args = process.argv.slice(2);
  let text: string | null = null;
  let send = false;
  let force = false;
  let channel: string | null = null;
  let embed: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--send') send = true;
    else if (a === '--force') force = true;
    else if (a === '--channel') channel = args[++i] ?? null;
    else if (a === '--embed') embed = args[++i] ?? null;
    else if (!a.startsWith('--') && text === null) text = a;
    else {
      console.error(`unknown argument: ${a}`);
      process.exit(1);
    }
  }

  if (!text) {
    console.error(
      'usage: cast-farcaster.ts "text" [--send] [--channel id] [--embed url] [--force]'
    );
    process.exit(1);
  }
  // Farcaster's limit is UTF-8 bytes; string length counts UTF-16 code
  // units, which undercounts emoji and would pass casts the API rejects.
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > 1024) {
    console.error(`cast is ${bytes} bytes; the limit is 1024`);
    process.exit(1);
  }
  const signerUuid = process.env.NEYNAR_SIGNER_UUID;
  if (!process.env.NEYNAR_API_KEY || !signerUuid) {
    console.error(
      'NEYNAR_API_KEY and NEYNAR_SIGNER_UUID are required (run setup-farcaster-signer.ts)'
    );
    process.exit(1);
  }

  console.log(`cast as @walletlink${channel ? ` in /${channel}` : ''}:`);
  console.log(`  ${text}`);
  if (embed) console.log(`  embed: ${embed}`);

  if (!send) {
    console.log('\ndry run: nothing sent. Re-run with --send to publish.');
    return;
  }

  // The same counter every other spender uses (lib/neynar-budget.ts).
  const spent = await getPeriodSpend();
  if (spent >= MONTHLY_CREDIT_LIMIT && !force) {
    console.error(
      `refused: this period's spend ${spent.toLocaleString()} is over the ` +
        `${MONTHLY_CREDIT_LIMIT.toLocaleString()} plan limit, and overage pauses ` +
        `every API call including live lookups. Wait for the month to reset ` +
        `(UTC month key, so 2026-09-01), or pass --force.`
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
      ...(channel ? { channel_id: channel } : {}),
      ...(embed ? { embeds: [{ url: embed }] } : {}),
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`cast failed: ${res.status} ${JSON.stringify(body)}`);
    process.exit(1);
  }

  console.log(`\npublished: hash ${body.cast?.hash}`);
  console.log(
    `https://farcaster.xyz/${body.cast?.author?.username}/${(body.cast?.hash ?? '').slice(0, 10)}`
  );

  // One credit, recorded against the shared counter like every other spend.
  await recordSpend(1);
}

main().catch((e) => {
  console.error('cast failed:', e.message ?? e);
  process.exit(1);
});
