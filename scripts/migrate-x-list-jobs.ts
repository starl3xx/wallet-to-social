/**
 * One row per "turn this result set into an X list" request.
 *
 * Usage: npx tsx scripts/migrate-x-list-jobs.ts
 * (DATABASE_URL must be the owner role, on the direct endpoint. Run BEFORE
 * deploying the routes that write this table.)
 *
 * ## Why a job table and not a request handler
 *
 * X allows 300 member additions per 15 minutes on user auth and takes one
 * member per request, so a 319-handle list is 319 requests and cannot finish
 * inside one HTTP request. It has to survive a rate-limit window, which means
 * the work and its progress live in a row. A part-built list then resumes
 * instead of failing, which matters because the members already added are real
 * and re-adding them would spend again.
 *
 * ## Why the credentials are here and not in a connections table
 *
 * The obvious design holds a durable X connection per user: an access token, a
 * refresh token, rotation, reuse detection. That is a permanent store of
 * recoverable third-party credentials, and this repository has never had one:
 * every other secret it holds is a hash of something handed out once, so a leak
 * of those tables leaks nothing usable.
 *
 * None of it is necessary for this feature. An X access token lives two hours
 * and this job takes about sixteen minutes, so the token is needed for the life
 * of one job and no longer. `offline_access` is deliberately NOT requested,
 * there is therefore no refresh token to store, and `access_token` is nulled
 * when the job ends. The cost is that a second list needs a second
 * authorization, which for a once-per-collection action is a fair price for not
 * holding a standing ability to act as every user who ever connected.
 *
 * The token is sealed by `lib/secret-box.ts` before it is written. That is what
 * makes the suppression quarantine safe: an erase copies the whole row into
 * `suppression_quarantine` as jsonb for the undo window, and the copy has to be
 * ciphertext rather than a working credential.
 *
 * ## members, and why it is emptied
 *
 * `members` holds the X ids and handles the list is being built from: third
 * party identity data, the same category as `lookup_jobs.wallets`, and it is
 * kept only while the job needs it to resume. Emptied on completion by the same
 * statement that clears the token. The worker re-reads the suppression list
 * before each batch, so a removal that lands mid-job stops the next addition
 * rather than being noticed after the list is public.
 *
 * NOT a backup table. A row is worthless once its job has ended, and restoring
 * one would resurrect an access token somebody has finished with. It goes in
 * READ_ONLY_TABLES so CI can read it, and nowhere near BACKUP_TABLES.
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

  console.log('x_list_jobs');
  await sql`
    CREATE TABLE IF NOT EXISTS x_list_jobs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,

      -- Who authorized. Null until they have: the row is created before the
      -- consent screen, because the intent has to survive the round trip and
      -- a row is the only thing that does. The handle is stored so the UI can
      -- say whose account the list appeared in, which is the one thing a
      -- person needs to see afterwards.
      x_user_id text,
      handle text,

      -- Sealed by lib/secret-box.ts, never plaintext, and nulled when the job
      -- ends. A CHECK cannot express "is ciphertext"; check-invariants asserts
      -- the seal at the call site instead, which is where it can be enforced.
      access_token text,
      access_expires_at timestamp,

      -- The PKCE verifier and the state nonce, for the one round trip through
      -- X's consent screen. Both are nulled the moment the code is exchanged.
      --
      -- Server-side rather than in a cookie because the intent (which list,
      -- which members) is already a row, and splitting half the flow into a
      -- cookie means a person with two tabs open finishes the wrong one. The
      -- verifier is not a credential on its own: it is useless without the
      -- code, and the code only ever arrives at our own redirect URI.
      --
      -- The nonce is what stops a callback binding to somebody else's job.
      -- The state parameter is attacker-visible in a URL, so the job id on
      -- its own would let a stranger's authorization attach their X account
      -- to this row.
      code_verifier text,
      state_nonce text,

      -- What to build. X caps a list name at 25 characters and a description
      -- at 100, so both are constrained here rather than discovered as a 400
      -- from the API halfway through a job.
      list_name text NOT NULL CHECK (char_length(list_name) BETWEEN 1 AND 25),
      list_description text CHECK (char_length(list_description) <= 100),
      is_private boolean NOT NULL DEFAULT false,

      -- [{ id, handle }], emptied on completion. See the header.
      members jsonb NOT NULL DEFAULT '[]'::jsonb,

      -- Progress. added_count is the resume cursor: the worker adds members
      -- from that offset, so a rate-limited run continues rather than restarts.
      x_list_id text,
      added_count integer NOT NULL DEFAULT 0,
      skipped_count integer NOT NULL DEFAULT 0,
      failed_count integer NOT NULL DEFAULT 0,

      -- 'awaiting_auth' is the state a row is born in: created, described, and
      -- not yet permitted to do anything. Distinct from 'pending' on purpose,
      -- because a row stuck here is an abandoned consent screen and a row
      -- stuck in 'pending' is a worker that is not running, and those need
      -- opposite responses.
      --
      -- 'cancelled' keeps its spelling: it is a persisted status and an API
      -- value, the same carve-out the house-style guard already makes.
      status text NOT NULL DEFAULT 'awaiting_auth'
        CHECK (status IN ('awaiting_auth','pending','running','completed','failed','cancelled')),
      error text,

      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now(),
      started_at timestamp,
      completed_at timestamp,
      -- When the rate limit says we may ask again. The worker skips a row
      -- whose window has not reopened rather than spending a request to be
      -- told 429.
      retry_after timestamp,

      -- The tick lease, and it is not the same thing as retry_after.
      --
      -- Vercel can start the next minute's invocation while the previous one
      -- is still in flight. Without a lease both read the same cursor, both
      -- add a batch to it, and the members between the two offsets are never
      -- attempted: a list that comes back short with nothing in the log.
      --
      -- Separate from retry_after so the ops report can tell a job waiting on
      -- X from a job currently being worked. Both mean "not yet", for
      -- opposite reasons.
      leased_until timestamp,

      -- Set immediately BEFORE POST /2/lists, so a create whose response is
      -- lost can be recognised on the next tick and adopted rather than
      -- repeated. Without it a timeout after X has already made the list
      -- leaves x_list_id null, and the retry makes a second empty list in
      -- somebody's account.
      create_attempted_at timestamp,

      -- Consecutive transient failures on member adds. A timeout or a 5xx
      -- must not advance the cursor, or one blip drops a person from the list
      -- permanently; but retrying for ever is its own failure, so the job
      -- gives up after enough of them in a row.
      transient_failures integer NOT NULL DEFAULT 0
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS x_list_jobs_user_idx
      ON x_list_jobs (user_id, created_at DESC)
  `;
  // The worker's claim query: pending or running, window reopened, oldest
  // first. Partial, because a completed row is never a candidate and this
  // table is expected to be mostly completed rows.
  await sql`
    CREATE INDEX IF NOT EXISTS x_list_jobs_claim_idx
      ON x_list_jobs (created_at)
      WHERE status IN ('pending','running')
  `;

  // --- verification --------------------------------------------------------

  const cols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'x_list_jobs'
  `;
  const idx = await sql`
    SELECT indexname FROM pg_indexes WHERE tablename = 'x_list_jobs'
  `;

  console.log(`\ncolumns: ${cols.length}/26`);
  for (const c of cols) console.log(`  ${c.column_name}`);
  console.log(`indexes: ${idx.length}/3`);
  for (const i of idx) console.log(`  ${i.indexname}`);

  if (cols.length !== 26 || idx.length !== 3) {
    console.error('\nMigration did not fully apply.');
    process.exit(1);
  }

  console.log('\nOK. One follow-up, with the owner role:');
  console.log('  Add x_list_jobs to READ_ONLY_TABLES in');
  console.log('  scripts/migrate-grant-readonly.ts and run it.');
  console.log('');
  console.log('This table deliberately carries NO suppression trigger, and');
  console.log('that is not an oversight: suppression_guard_skip silently');
  console.log('discards every later UPDATE to a guarded row, and the most');
  console.log('important UPDATE here is the one that NULLs the sealed access');
  console.log('token when a job ends. A guard would preserve a working');
  console.log('third-party credential for exactly the person who asked to be');
  console.log('removed. It is in SUPPRESSION_EXCLUDED_TABLES with that');
  console.log('argument written out, and eraseIdentifier deletes the row.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
