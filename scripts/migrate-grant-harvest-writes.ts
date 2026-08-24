/**
 * Write grants for the scheduled harvest workflows.
 *
 * The attested-link ingest (lib/attested-links.ts) writes three tables:
 * social_graph, handle_conflicts and ingest_state. sweep_runner, the role
 * the scheduled workflows are meant to connect as, held write on
 * social_graph only — no ingest_state row at all and read-only
 * handle_conflicts — so a harvest cron running as that role would die with
 * "permission denied", and only in CI (the exact trap CLAUDE.md documents
 * for reads). This grants the missing writes. No DELETE: the harvests
 * insert and update, and a scheduled job holds nothing it does not need.
 *
 * Idempotent; verifies what it granted. Run with the OWNER DATABASE_URL:
 *   npx tsx --env-file=.env.local scripts/migrate-grant-harvest-writes.ts
 */

import { neon } from '@neondatabase/serverless';

const GRANTS: Array<{ table: string; privileges: string[] }> = [
  { table: 'handle_conflicts', privileges: ['SELECT', 'INSERT', 'UPDATE'] },
  { table: 'ingest_state', privileges: ['SELECT', 'INSERT', 'UPDATE'] },
];

const ROLE = 'sweep_runner';

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required (the owner connection)');
    process.exit(1);
  }
  const sql = neon(process.env.DATABASE_URL);

  const who = await sql`SELECT current_user`;
  console.log(`Connected as ${who[0].current_user}`);

  for (const g of GRANTS) {
    await sql.query(
      `GRANT ${g.privileges.join(', ')} ON ${g.table} TO ${ROLE}`
    );
    console.log(`granted ${g.privileges.join(', ')} on ${g.table} to ${ROLE}`);
  }

  const check = await sql`
    SELECT table_name, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privs
    FROM information_schema.role_table_grants
    WHERE grantee = ${ROLE}
      AND table_name IN ('social_graph', 'handle_conflicts', 'ingest_state')
    GROUP BY table_name ORDER BY table_name`;
  console.log('\nVerified grants for', ROLE);
  for (const row of check) console.log(`  ${row.table_name}: ${row.privs}`);

  const missing = GRANTS.filter((g) => {
    const row = check.find((c) => c.table_name === g.table);
    return (
      !row || !g.privileges.every((p) => (row.privs as string).includes(p))
    );
  });
  if (missing.length > 0) {
    console.error(
      `\nMissing grants on: ${missing.map((m) => m.table).join(', ')}`
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
