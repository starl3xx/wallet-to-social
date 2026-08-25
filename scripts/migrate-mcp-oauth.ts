/**
 * The three tables and one column that make the MCP server an OAuth resource.
 *
 * `oauth_clients` holds two kinds of row. A dynamically registered client, whose
 * every field is self-asserted and unverified, and a cached Client ID Metadata
 * Document, where the `client_id` is the HTTPS URL the document was served from
 * and is therefore the one fact a consent screen can rely on.
 *
 * `oauth_authorization_requests` is one row per request, from arrival to spent
 * code. A single table rather than a pending table and a code table, because a
 * pending request and an issued code are the same request at two ages, and
 * splitting them invites a code that exists with no record of what it approved.
 *
 * `oauth_grants` is one row per consent. The access token is deliberately not
 * here: it is an `api_keys` row carrying `oauth_grant_id`, which is the column
 * added below, so that metering, the three rate-limit windows, the balance
 * check and the usage ledger all work with no second implementation.
 *
 * None of these are backup tables. A grant is a live credential, not a record
 * worth restoring: restoring one from last night would resurrect a connection
 * somebody revoked this morning. They go in READ_ONLY_TABLES so CI can read
 * them, and nowhere near BACKUP_TABLES.
 *
 * DATABASE_URL: the owner role, and the direct endpoint rather than the pooler.
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

  console.log('oauth_clients');
  await sql`
    CREATE TABLE IF NOT EXISTS oauth_clients (
      client_id text PRIMARY KEY,
      client_name text,
      client_uri text,
      logo_uri text,
      redirect_uris jsonb NOT NULL,
      grant_types jsonb NOT NULL,
      token_endpoint_auth_method text NOT NULL DEFAULT 'none',
      scope text,
      is_cimd boolean NOT NULL DEFAULT false,
      fetched_at timestamp,
      created_at timestamp NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS oauth_clients_is_cimd_idx
      ON oauth_clients (is_cimd)
  `;

  console.log('oauth_grants');
  await sql`
    CREATE TABLE IF NOT EXISTS oauth_grants (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_id text NOT NULL,
      client_label text NOT NULL,
      scope text NOT NULL,
      resource text,
      refresh_token_hash text,
      previous_refresh_token_hash text,
      refresh_expires_at timestamp,
      created_at timestamp NOT NULL DEFAULT now(),
      last_used_at timestamp,
      revoked_at timestamp,
      revoked_reason text
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS oauth_grants_user_idx
      ON oauth_grants (user_id)
  `;
  // Unique, not merely indexed. Two live grants sharing a refresh token would
  // make the rotation update ambiguous, and the reuse detection below it
  // meaningless.
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS oauth_grants_refresh_hash_idx
      ON oauth_grants (refresh_token_hash)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS oauth_grants_prev_refresh_hash_idx
      ON oauth_grants (previous_refresh_token_hash)
  `;

  console.log('oauth_authorization_requests');
  await sql`
    CREATE TABLE IF NOT EXISTS oauth_authorization_requests (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id text NOT NULL,
      redirect_uri text NOT NULL,
      code_challenge text NOT NULL,
      scope text NOT NULL,
      resource text,
      state text,
      user_id uuid REFERENCES users(id) ON DELETE CASCADE,
      code_hash text,
      code_expires_at timestamp,
      consumed_at timestamp,
      grant_id uuid,
      created_at timestamp NOT NULL DEFAULT now(),
      expires_at timestamp NOT NULL
    )
  `;
  // Unique so one code cannot name two requests. `redeemCode` consumes with a
  // conditional UPDATE and then reads the row back to tell a replay from an
  // unknown code; that read has to find one row or nothing.
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS oauth_authorization_requests_code_hash_idx
      ON oauth_authorization_requests (code_hash)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS oauth_authorization_requests_expires_idx
      ON oauth_authorization_requests (expires_at)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS oauth_authorization_requests_user_idx
      ON oauth_authorization_requests (user_id)
  `;

  console.log('api_keys.oauth_grant_id');
  await sql`
    ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS oauth_grant_id uuid
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS api_keys_oauth_grant_idx
      ON api_keys (oauth_grant_id)
  `;

  // --- verification --------------------------------------------------------

  const expected: Record<string, number> = {
    oauth_clients: 11,
    oauth_grants: 13,
    oauth_authorization_requests: 14,
  };

  let ok = true;
  for (const [table, count] of Object.entries(expected)) {
    const cols = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = ${table}
    `;
    console.log(`\n${table}: ${cols.length}/${count} columns`);
    if (cols.length !== count) ok = false;
  }

  const grantColumn = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'api_keys' AND column_name = 'oauth_grant_id'
  `;
  console.log(`api_keys.oauth_grant_id: ${grantColumn.length}/1`);
  if (grantColumn.length !== 1) ok = false;

  const indexes = await sql`
    SELECT indexname FROM pg_indexes
    WHERE indexname IN (
      'oauth_clients_is_cimd_idx',
      'oauth_grants_user_idx',
      'oauth_grants_refresh_hash_idx',
      'oauth_grants_prev_refresh_hash_idx',
      'oauth_authorization_requests_code_hash_idx',
      'oauth_authorization_requests_expires_idx',
      'oauth_authorization_requests_user_idx',
      'api_keys_oauth_grant_idx'
    )
  `;
  console.log(`indexes: ${indexes.length}/8`);
  for (const i of indexes) console.log(`  ${i.indexname}`);
  if (indexes.length !== 8) ok = false;

  if (!ok) {
    console.error('\nMigration did not fully apply.');
    process.exit(1);
  }

  console.log('\nOK. The three oauth_* tables are already in READ_ONLY_TABLES');
  console.log('in scripts/migrate-grant-readonly.ts; run it with the owner');
  console.log('role so the sweep_runner role can read them.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
