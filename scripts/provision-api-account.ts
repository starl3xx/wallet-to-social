/**
 * Give a first-party project its own API account, tier and key.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/provision-api-account.ts \
 *     --email starl3xx.mail+lhaw@gmail.com --tier pro --name "Let's Have A Word" \
 *     --out ../lets-have-a-word/.walletlink-key
 *
 * ## Why a service account and not your own
 *
 * One account per consuming project. Revoking a project's access then touches
 * nothing else, and `/api/admin/usage` attributes load to the project that
 * caused it rather than to a person who owns several. The alternative, reusing
 * a personal account, makes both of those impossible to do later without
 * reissuing keys to everything at once.
 *
 * ## Why a real tier and not an unmetered internal path
 *
 * The rate limiter is the only thing standing between a first-party consumer
 * and the live lookup path a paying customer is on. An internal bypass would
 * hide that load until it cost somebody real. `pro` maps to the Developer plan
 * (60/min, 5,000/day), which is ample for an announce-time lookup and tight
 * enough to catch a runaway retry loop, which is the actual failure mode of a
 * key wired into a bot.
 *
 * ## The key is written to a file, never printed
 *
 * `wts_live_…` is a bearer credential and this prints only its prefix. Terminal
 * scrollback gets copied into issues and pasted into chats; a file with 0600
 * permissions does not. Delete the file once the value is in the deploy target.
 */
import { neon } from '@neondatabase/serverless';
import { writeFileSync, chmodSync } from 'node:fs';
import { createApiKey } from '../lib/api-keys';
import { apiPlanForTier } from '../lib/api-plans';

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required (must be the owner role)');
    process.exit(1);
  }

  const email = arg('--email')?.toLowerCase();
  const tier = arg('--tier') ?? 'pro';
  const name = arg('--name');
  const out = arg('--out');

  if (!email || !name || !out) {
    console.error('Usage: --email <addr> --name <label> --out <path> [--tier pro|unlimited]');
    process.exit(1);
  }

  const planId = apiPlanForTier(tier);
  if (!planId) {
    console.error(`Tier "${tier}" carries no API access. Use pro or unlimited.`);
    process.exit(1);
  }

  const sql = neon(url);

  /**
   * Upsert rather than insert. Re-running this to mint a replacement key after
   * a leak must not fail on the account that already exists, and must not
   * silently downgrade a tier somebody raised by hand.
   */
  const [user] = (await sql`
    INSERT INTO users (email, tier) VALUES (${email}, ${tier})
    ON CONFLICT (email) DO UPDATE SET tier = EXCLUDED.tier
    RETURNING id, email, tier
  `) as unknown as Array<{ id: string; email: string; tier: string }>;

  console.log(`account : ${user.email} (tier ${user.tier})`);
  console.log(`plan    : ${planId}`);

  const created = await createApiKey(user.id, name, planId);
  if (!created) {
    console.error('Key creation failed.');
    process.exit(1);
  }

  writeFileSync(out, created.rawKey + '\n', { mode: 0o600 });
  chmodSync(out, 0o600);

  console.log(`key     : ${created.key.keyPrefix}… (${name})`);
  console.log(`written : ${out} (0600)`);
  console.log('\nPut the value in the consumer\'s deploy target, then delete the file.');
}

main().catch((e) => {
  console.error('provisioning failed:', e);
  process.exit(1);
});
