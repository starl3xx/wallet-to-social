/**
 * Holder-walk bookmarks for the seed cron.
 *
 * Adds `seeded_contracts.resume_state jsonb`: the `{source, cursor, walked}`
 * bookmark an unfinished ERC-20 holder walk resumes from (2026-09-20). Before
 * this column, every re-seed after the novelty window re-imported the same
 * top-2,000 holders by balance, so a large token's tail was unreachable
 * forever; with it, each slice continues where the last one stopped.
 *
 * No grant work: grants are table-level and both writers (the Vercel runtime
 * role and the owner) already hold them on seeded_contracts.
 *
 * Idempotent; verifies the column it added. Run with the OWNER DATABASE_URL
 * against the DIRECT endpoint (drop `-pooler` from the host):
 *   npx tsx --env-file=.env.local scripts/migrate-seed-resume.ts
 */

import { neon } from '@neondatabase/serverless';

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required (the owner connection)');
    process.exit(1);
  }
  // DDL goes to the direct endpoint: the pooler shares server backends
  // across clients, which is a hazard for session state, not for this one
  // statement, but the rule is the rule so nobody has to re-derive it.
  const url = process.env.DATABASE_URL.replace('-pooler', '');
  const sql = neon(url);

  const who = await sql`SELECT current_user`;
  console.log(`Connected as ${who[0].current_user}`);

  await sql`ALTER TABLE seeded_contracts ADD COLUMN IF NOT EXISTS resume_state jsonb`;
  console.log('resume_state column ensured');

  const check = await sql`
    SELECT data_type FROM information_schema.columns
    WHERE table_name = 'seeded_contracts' AND column_name = 'resume_state'
  `;
  if (check.length !== 1 || check[0].data_type !== 'jsonb') {
    console.error('VERIFY FAILED: resume_state is missing or not jsonb');
    process.exit(1);
  }
  console.log('verified: seeded_contracts.resume_state jsonb exists');
}

main();
