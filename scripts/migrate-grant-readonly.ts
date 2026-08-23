/**
 * Grant the CI role read access to the tables added since the role split.
 *
 * Usage: npx tsx --env-file=.env.local scripts/migrate-grant-readonly.ts
 *
 * `sweep_runner` is the role CI uses. It was granted on `social_graph` when the
 * split was made, and every table created afterwards inherited nothing, so
 * `check-published-figures.ts` failed with "permission denied for table
 * x_accounts" while passing locally against the owner role.
 *
 * SELECT only, deliberately. The figures check reads counts and writes nothing,
 * and a guard that needed write access to verify a number would be a strange
 * guard.
 *
 * Idempotent. A new table needs adding here, which is the same shape of
 * obligation as adding a figure to the published-figures registry: a step that
 * nothing fails without until CI runs.
 */
import { neon } from '@neondatabase/serverless';

const READ_ONLY_TABLES = [
  'x_accounts',
  'handle_conflicts',
  'x_handle_attempts',
  'clanker_unresolved_ids',
  'credit_lots',
  'credit_ledger',
  'lifecycle_emails',
  // Added 2026-08-23. The known-agents claim joined the figures registry on
  // 2026-08-22 and the table was never granted, so `published-figures` has
  // failed on every PR since with `permission denied for table known_agents`
  // while passing locally against the owner role. Exactly the case the
  // CLAUDE.md note describes, caught the way it says it will be: later, in CI,
  // on a run that was green on the machine that wrote it.
  'known_agents',
];
const ROLE = 'sweep_runner';

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required (must be the owner role)');
    process.exit(1);
  }
  const sql = neon(databaseUrl);

  const [role] = (await sql`
    SELECT count(*)::int AS n FROM pg_roles WHERE rolname = ${ROLE}
  `) as unknown as Array<{ n: number }>;
  if (role.n !== 1) {
    console.error(`role ${ROLE} does not exist; nothing to grant`);
    process.exit(1);
  }

  // GRANT takes an identifier, not a value, so it cannot be parameterised. The
  // table and role names are constants in this file rather than input, and
  // `sql.query` is the documented escape hatch for a non-template statement.
  for (const table of READ_ONLY_TABLES) {
    await sql.query(`GRANT SELECT ON TABLE ${table} TO ${ROLE}`);
    console.log(`GRANT SELECT ON ${table} TO ${ROLE}: ok`);
  }

  const rows = (await sql`
    SELECT table_name, privilege_type FROM information_schema.role_table_grants
    WHERE grantee = ${ROLE} AND table_name = ANY(${READ_ONLY_TABLES})
    ORDER BY table_name, privilege_type
  `) as unknown as Array<{ table_name: string; privilege_type: string }>;
  console.log('\nverified:');
  for (const r of rows) console.log(`  ${r.table_name}: ${r.privilege_type}`);

  /**
   * Count the tables that carry SELECT, not the privilege rows.
   *
   * This compared `rows.length` against the table count, which is only the same
   * number while every table has exactly one grant. `handle_conflicts` carries
   * INSERT and UPDATE as well, granted elsewhere for the conflict queue, so the
   * query returned three rows for it and the script exited 1 reporting failure
   * on a run where every grant had in fact been made. The GRANTs autocommit
   * before this check, so the effect was purely to teach whoever ran it that
   * the red line at the end means nothing.
   *
   * What the check is actually for is "every table in the list is now readable
   * by the role", and a table holding MORE than SELECT does not violate that.
   */
  const withSelect = new Set(
    rows.filter((r) => r.privilege_type === 'SELECT').map((r) => r.table_name)
  );
  const missing = READ_ONLY_TABLES.filter((t) => !withSelect.has(t));
  if (missing.length > 0) {
    console.error(`no SELECT grant for: ${missing.join(', ')}`);
    process.exit(1);
  }
  console.log(`\nall ${READ_ONLY_TABLES.length} tables readable by ${ROLE}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
