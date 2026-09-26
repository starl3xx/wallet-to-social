/**
 * Lift a sanctions freeze on legal advice (Linear STA-41, STA-49). Operator
 * only, and only when the lawyer says so: docs/OPERATIONS.md, the freeze
 * runbook, step 4.
 *
 *   npx tsx --env-file=.env.local scripts/sanctions-lift-freeze.ts \
 *     --account <account id> --note "<who advised it, and why>" [--commit]
 *
 * Without `--commit` it prints what it would do and writes nothing. With it,
 * `liftFreeze` (lib/sanctions.ts) records every listed payer the account has
 * now in `sanctions_freeze_releases` and clears `frozen_at`, in one
 * statement. The released pairs are then left out of every later freeze, so
 * the next refresh does not freeze the account again for them; a payer listed
 * after this still freezes it and is emailed. Keys stay deactivated: the
 * account makes a new one. Nothing is refunded.
 *
 * Prints the account's payers, which are customer data: run it in a private
 * terminal and paste nothing from it anywhere public.
 *
 * DATABASE_URL: the owner role.
 */
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { liftFreeze } from '../lib/sanctions';

function arg(name: string): string | null {
  const at = process.argv.indexOf(name);
  return at === -1 ? null : (process.argv[at + 1] ?? null);
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required (must be the owner role)');
    process.exit(1);
  }
  const account = arg('--account');
  const note = arg('--note')?.trim() ?? '';
  if (!account || !/^[0-9a-f-]{36}$/i.test(account) || !note) {
    console.error(
      'Usage: --account <account id> --note "<who advised it, and why>" [--commit]'
    );
    process.exit(1);
  }
  const commit = process.argv.includes('--commit');
  const sql = neon(databaseUrl);

  const [user] = (await sql`
    SELECT frozen_at, frozen_reason FROM users WHERE id = ${account}::uuid
  `) as unknown as Array<{
    frozen_at: string | null;
    frozen_reason: string | null;
  }>;
  if (!user) {
    console.error('No such account.');
    process.exit(1);
  }
  if (!user.frozen_at) {
    console.log('The account is not frozen. Nothing to do.');
    return;
  }
  console.log(`frozen at ${user.frozen_at}: ${user.frozen_reason ?? ''}`);

  if (!commit) {
    console.log(
      'dry run: nothing written. Re-run with --commit to release the listed payers and clear the freeze.'
    );
    return;
  }

  const result = await liftFreeze(drizzle(sql), account, note);
  console.log(
    `released ${result.released} payer(s); account unfrozen: ${result.unfrozen === 1 ? 'yes' : 'no'}`
  );
  const [after] = (await sql`
    SELECT frozen_at FROM users WHERE id = ${account}::uuid
  `) as unknown as Array<{ frozen_at: string | null }>;
  if (after?.frozen_at) {
    console.error('verification failed: the account is still frozen.');
    process.exit(1);
  }
  console.log(
    'verified. The account can make a new key; its old keys stay off.'
  );
}

main().catch((e) => {
  console.error('lift failed:', e);
  process.exit(1);
});
