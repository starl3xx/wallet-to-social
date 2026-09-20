/**
 * One row per `/claim`: the owner proving a wallet and an account together.
 *
 * Usage: npx tsx scripts/migrate-identity-attestations.ts
 * (DATABASE_URL must be the owner role, on the direct endpoint, not the
 * pooler. Run BEFORE deploying anything that reads this table.)
 *
 * ## Why a table and not a column on `users`
 *
 * A person can attest more than one wallet, and the same wallet can in
 * principle be attested by different accounts over time. Both facts are rows,
 * not fields, and the second one is the interesting one: it is how a change of
 * ownership becomes visible rather than silently overwriting a claim.
 *
 * ## It is also the pending state for the X round trip
 *
 * Same shape as `x_list_jobs`, for the same reason: the intent has to survive
 * a trip through x.com, and a row is the only thing here that does. It is born
 * unable to do anything, holding a verifier and a nonce and no proof of
 * anything, and only the callback can move it out of `awaiting_x`.
 *
 * ## Why the account id is hashed and the wallet is not
 *
 * `x_user_id_hmac` is what enforces one grant per account, ever, and it has to
 * keep working after the plaintext is erased. A withdrawal removes the link
 * this row records, and the whole point of removal is that we stop holding the
 * identity, so the uniqueness key cannot be the identity. An HMAC under a
 * separate pepper survives the erase and still answers "has this account
 * claimed before" without being reversible into the account.
 *
 * The wallet stays plaintext because it is the join key into `social_graph`,
 * which already holds it in the clear; hashing it here would protect nothing
 * and break every query that matters.
 *
 * ## What it deliberately does NOT hold
 *
 * No access token. The X round trip reads `/2/users/me` once, takes the id and
 * the handle, and drops the token in the same request. `x_list_jobs` has to
 * keep one because it spends sixteen minutes adding members; this flow has
 * nothing to do after the read, so storing a credential would be storing it
 * for no reason.
 */
import { neon } from '@neondatabase/serverless';

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required (must be the owner role)');
    process.exit(1);
  }
  if (databaseUrl.includes('-pooler')) {
    console.error(
      'Refusing to run against the pooler. Drop "-pooler" from the host.'
    );
    process.exit(1);
  }

  const sql = neon(databaseUrl);

  console.log('identity_attestations');

  await sql`
    CREATE TABLE IF NOT EXISTS identity_attestations (
      id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,

      -- The wallet half. Plaintext: it is the join key into social_graph.
      wallet             text NOT NULL,
      signature          text,
      challenge_issued_at timestamp,

      -- The account half, filled only by the callback.
      x_user_id          text,
      x_user_id_hmac     text,
      x_handle           text,

      -- What they agreed to, frozen. A consent record that cannot say which
      -- words were on the page is not a consent record.
      consent_version    text NOT NULL,
      consent_sha256     text NOT NULL,

      status             text NOT NULL DEFAULT 'awaiting_x',
      code_verifier      text,
      state_nonce        text,

      -- Set when a grant is made, so the grant is idempotent against THIS row
      -- rather than against credit_lots, whose grant rail deliberately allows
      -- repeats.
      grant_claimed_at   timestamp,
      granted_matches    integer,

      error              text,
      created_at         timestamp NOT NULL DEFAULT now(),
      updated_at         timestamp NOT NULL DEFAULT now(),
      completed_at       timestamp,

      CONSTRAINT identity_attestations_wallet_lower
        CHECK (wallet = lower(wallet)),
      CONSTRAINT identity_attestations_status
        CHECK (status IN ('awaiting_x','completed','failed','cancelled','withdrawn'))
    )
  `;

  /**
   * One grant per X account, ever. A partial index so rows that never reached
   * an account do not collide with each other on NULL.
   */
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS identity_attestations_account_grant_idx
    ON identity_attestations (x_user_id_hmac)
    WHERE x_user_id_hmac IS NOT NULL AND grant_claimed_at IS NOT NULL
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS identity_attestations_user_idx
    ON identity_attestations (user_id, created_at DESC)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS identity_attestations_wallet_idx
    ON identity_attestations (wallet)
  `;

  /**
   * Verification, as every migration here ends: exit non-zero if what the
   * script claims to have made is not there, so a silent partial run cannot
   * be mistaken for a success.
   */
  const table = (await sql`
    SELECT to_regclass('public.identity_attestations') AS reg
  `) as unknown as Array<{ reg: string | null }>;
  if (!table[0]?.reg) {
    console.error('FAILED: identity_attestations was not created');
    process.exit(1);
  }

  const wanted = [
    'identity_attestations_account_grant_idx',
    'identity_attestations_user_idx',
    'identity_attestations_wallet_idx',
  ];
  const present = (await sql`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'identity_attestations'
  `) as unknown as Array<{ indexname: string }>;
  const names = present.map((r) => r.indexname);
  const missing = wanted.filter((i) => !names.includes(i));
  if (missing.length > 0) {
    console.error(`FAILED: missing index/indexes: ${missing.join(', ')}`);
    process.exit(1);
  }

  console.log(`  verified: table plus ${wanted.length} indexes`);
  console.log('');
  console.log(
    'Next: add identity_attestations to READ_ONLY_TABLES in ' +
      'scripts/migrate-grant-readonly.ts and run that with the owner ' +
      'DATABASE_URL, or a scheduled workflow reading it fails in CI as ' +
      'permission denied on a run that passed locally.'
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
