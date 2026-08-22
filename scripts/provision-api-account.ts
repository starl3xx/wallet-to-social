/**
 * Give a first-party project its own API account, tier and key.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/provision-api-account.ts \
 *     --email project@example.com --tier pro --name "Project" \
 *     --out ../project/.walletlink-key [--revoke-existing]
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
 * This is the one sanctioned way to set a legacy tier on an account, and it is
 * for first-party service accounts only (the admin API refuses to grant one).
 * A customer gets credits, never a tier.
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
 *
 * ## Minting does not revoke
 *
 * Re-running mints an ADDITIONAL key. Existing active keys keep working, which
 * is right for adding a second consumer and wrong for rotating after a leak, so
 * the script names them and does nothing else unless `--revoke-existing` says
 * to. A rotation that leaves the stolen credential valid is not a rotation, and
 * the operator has to be the one who decides which of the two this is.
 */
import { neon } from '@neondatabase/serverless';
import { writeFileSync, chmodSync } from 'node:fs';
import { createApiKey, revokeApiKey } from '../lib/api-keys';
import { apiPlanForTier, TIER_RANK } from '../lib/api-plans';

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
  const revokeExisting = process.argv.includes('--revoke-existing');

  if (!email || !name || !out) {
    console.error(
      'Usage: --email <addr> --name <label> --out <path> [--tier pro|unlimited]'
    );
    process.exit(1);
  }

  // Validates the REQUESTED tier early; the plan actually issued is derived
  // from the tier the account ends up holding, below.
  if (!apiPlanForTier(tier)) {
    console.error(
      `Tier "${tier}" carries no API access. Use pro or unlimited.`
    );
    process.exit(1);
  }

  const sql = neon(url);

  /**
   * Upsert, and never downgrade.
   *
   * Re-running to mint a replacement key must not fail on an account that
   * already exists, and must not undo a tier somebody raised by hand. The
   * default `--tier pro` makes that the likely case rather than the exotic one:
   * an operator rotating a key after a leak is thinking about the key, not
   * about re-stating the tier, and a plain `SET tier = EXCLUDED.tier` would
   * drop an `unlimited` account to Developer limits without saying so.
   */
  const [user] = (await sql`
    INSERT INTO users (email, tier) VALUES (${email}, ${tier})
    ON CONFLICT (email) DO UPDATE SET tier =
      CASE
        WHEN ${TIER_RANK[tier] ?? 0} >
             CASE users.tier WHEN 'unlimited' THEN 2 WHEN 'pro' THEN 1 ELSE 0 END
        THEN EXCLUDED.tier
        ELSE users.tier
      END
    RETURNING id, email, tier
  `) as unknown as Array<{ id: string; email: string; tier: string }>;

  if (user.tier !== tier) {
    console.log(
      `note    : account already holds "${user.tier}"; kept it rather than`
    );
    console.log(
      `          applying "${tier}". Pass --tier ${user.tier} to silence this.`
    );
  }

  /**
   * The plan comes from the tier the account ACTUALLY holds, not from the CLI
   * argument. Deriving it from the argument would hand a Developer-limited key
   * to an Unlimited account, which is the same downgrade by another route.
   */
  const effectivePlanId = apiPlanForTier(user.tier);
  if (!effectivePlanId) {
    console.error(`Account tier "${user.tier}" carries no API access.`);
    process.exit(1);
  }

  console.log(`account : ${user.email} (tier ${user.tier})`);
  console.log(`plan    : ${effectivePlanId}`);

  /**
   * Existing keys are named, because minting does not revoke.
   *
   * An operator rotating after a leak who sees only "key written" can
   * reasonably conclude the old one is dead. It is not: it stays active and
   * keeps working. Say so, and offer `--revoke-existing` to actually do it.
   */
  const existing = (await sql`
    SELECT id, key_prefix, name, created_at FROM api_keys
    WHERE user_id = ${user.id} AND is_active = true AND revoked_at IS NULL
    ORDER BY created_at
  `) as unknown as Array<{
    id: string;
    key_prefix: string;
    name: string;
    created_at: string;
  }>;

  if (existing.length > 0) {
    console.log(`\nexisting active keys (${existing.length}):`);
    for (const k of existing) console.log(`  ${k.key_prefix}… ${k.name}`);
    if (revokeExisting) {
      for (const k of existing) await revokeApiKey(k.id, user.id);
      console.log(`revoked : ${existing.length} key(s)`);
    } else {
      console.log(
        '  STILL VALID. Pass --revoke-existing to revoke them as part of a rotation.'
      );
    }
    console.log('');
  }

  const created = await createApiKey(user.id, name, effectivePlanId);
  if (!created) {
    console.error('Key creation failed.');
    process.exit(1);
  }

  writeFileSync(out, created.rawKey + '\n', { mode: 0o600 });
  chmodSync(out, 0o600);

  console.log(`key     : ${created.key.keyPrefix}… (${name})`);
  console.log(`written : ${out} (0600)`);
  console.log(
    "\nPut the value in the consumer's deploy target, then delete the file."
  );
}

main().catch((e) => {
  console.error('provisioning failed:', e);
  process.exit(1);
});
