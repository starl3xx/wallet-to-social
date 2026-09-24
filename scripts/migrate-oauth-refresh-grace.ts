/**
 * `oauth_grants.refresh_rotated_at`: when a grant's refresh token last rotated,
 * and `refresh_grace_hashes`: the refresh hashes rotated out in the current
 * burst of rotations, with a GIN index for the lookup by hash.
 *
 * Within 30 seconds of it, a replay of the token the rotation replaced is held
 * off instead of revoking the grant (`refreshGrant` in lib/oauth/grants.ts).
 * No backfill: NULL is never recent, so a grant rotated before this revokes on
 * a replay exactly as it always did.
 *
 * Run it BEFORE the code that names the columns deploys. Drizzle's `select()`
 * and `.returning()` name every column in the schema, so the builder calls
 * that select whole rows fail with 42703 against a database without them: the
 * refresh pre-read (every refresh answers 503), `createGrant`'s `returning()`
 * (consent) and `listGrants` (the connected-apps list and Disconnect).
 * Access-token validation and `/api/oauth/revoke` name their columns and keep
 * working. The columns are nullable and the code before them never names
 * them, so adding them early is safe.
 *
 * Idempotent. A fresh database gets the column from `migrate-mcp-oauth.ts`,
 * whose CREATE TABLE carries it; this adds it where that table already exists.
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

  await sql`
    ALTER TABLE oauth_grants
      ADD COLUMN IF NOT EXISTS refresh_rotated_at timestamp
  `;
  await sql`
    ALTER TABLE oauth_grants
      ADD COLUMN IF NOT EXISTS refresh_grace_hashes text[]
  `;
  // GIN, so the refresh lookup's `@> ARRAY[hash]` is an index probe.
  await sql`
    CREATE INDEX IF NOT EXISTS oauth_grants_refresh_grace_hashes_idx
      ON oauth_grants USING gin (refresh_grace_hashes)
  `;

  const cols = await sql`
    SELECT data_type, is_nullable FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'oauth_grants'
      AND column_name = 'refresh_rotated_at'
  `;
  const col = cols[0] as { data_type: string; is_nullable: string } | undefined;
  if (
    !col ||
    col.data_type !== 'timestamp without time zone' ||
    col.is_nullable !== 'YES'
  ) {
    console.error('oauth_grants.refresh_rotated_at is missing or wrong:', col);
    process.exit(1);
  }
  console.log('oauth_grants.refresh_rotated_at: timestamp, nullable. OK.');

  const arr = await sql`
    SELECT data_type, udt_name, is_nullable FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'oauth_grants'
      AND column_name = 'refresh_grace_hashes'
  `;
  const a = arr[0] as
    { data_type: string; udt_name: string; is_nullable: string } | undefined;
  const idx = await sql`
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'oauth_grants'
      AND indexname = 'oauth_grants_refresh_grace_hashes_idx'
  `;
  if (!a || a.udt_name !== '_text' || a.is_nullable !== 'YES' || !idx.length) {
    console.error(
      'oauth_grants.refresh_grace_hashes or its index is missing or wrong:',
      a,
      idx.length
    );
    process.exit(1);
  }
  console.log(
    'oauth_grants.refresh_grace_hashes: text[], nullable, GIN index. OK.'
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
