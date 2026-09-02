/**
 * Grant the read-only roles access to the tables they need.
 *
 * Usage: npx tsx --env-file=.env.local scripts/migrate-grant-readonly.ts
 *
 * Two roles, because the database has two read-only consumers and they want
 * different tables. `sweep_runner` is CI; `backup_reader` is the nightly dump.
 * One script rather than two, because the obligation is identical and two files
 * with one table list each is how the second one stops being maintained.
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
  // Added 2026-08-25 with the recovery endpoint, so CI can read it.
  //
  // Read-only only. It is deliberately absent from BACKUP_TABLES below: every
  // row is a spent challenge that was worthless five minutes after it was
  // written, so a nightly dump would restore a day-old list of expired hashes.
  // An earlier version of this comment claimed the opposite and was wrong.
  'x402_recovery_redemptions',
  // Added 2026-08-25 with the MCP server's OAuth flow.
  //
  // Read-only only, and deliberately absent from BACKUP_TABLES. A grant is a
  // live credential rather than a record: restoring one from last night would
  // resurrect a connection somebody revoked this morning, which is the exact
  // opposite of what a person expects a disconnect button to have done. The
  // authorization requests expire in half an hour and the client rows are
  // re-registered or re-fetched on demand, so neither is worth a dump either.
  'oauth_clients',
  'oauth_grants',
  'oauth_authorization_requests',
  // Added 2026-09-01 with Idempotency-Key support on POST /v1/batch.
  //
  // Read-only only, and deliberately absent from BACKUP_TABLES: every row
  // expires 24 hours after it is written, and restoring last night's rows
  // would resurrect replayable responses for keys already retried.
  'idempotency_keys',
];

/**
 * What the nightly dump can read, and therefore what a restore contains.
 *
 * `.github/workflows/db-backup.yml` names the same tables in its `pg_dump -t`
 * list. The two must agree: a table in the dump list that the role cannot read
 * makes `pg_dump` fail, and a table the role can read but the dump does not
 * name is simply absent from the backup, silently.
 *
 * `credit_lots` and `credit_ledger` were added 2026-08-24. They are the only
 * record of who paid and what they spent, the workflow's own header says it
 * captures "the irreplaceable tables", and they were not in it. 24 of 30 tables
 * are still outside the dump; the rest are either rebuildable (`social_graph`,
 * `wallet_cache`) or ephemeral (rate-limit buckets, sessions), and that is a
 * judgment worth revisiting separately rather than by adding everything.
 */
const BACKUP_TABLES = [
  'users',
  'api_keys',
  'api_plans',
  'whitelist',
  'lookup_history',
  'known_agents',
  'credit_lots',
  'credit_ledger',
];

const GRANTS: { role: string; tables: string[] }[] = [
  { role: 'sweep_runner', tables: READ_ONLY_TABLES },
  { role: 'backup_reader', tables: BACKUP_TABLES },
];

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required (must be the owner role)');
    process.exit(1);
  }
  const sql = neon(databaseUrl);

  let failures = 0;

  for (const { role: ROLE, tables } of GRANTS) {
    const [exists] = (await sql`
      SELECT count(*)::int AS n FROM pg_roles WHERE rolname = ${ROLE}
    `) as unknown as Array<{ n: number }>;
    if (exists.n !== 1) {
      console.error(`role ${ROLE} does not exist; nothing to grant`);
      process.exit(1);
    }

    console.log(`\n${ROLE}:`);

    // GRANT takes an identifier, not a value, so it cannot be parameterised.
    // The table and role names are constants in this file rather than input,
    // and `sql.query` is the documented escape hatch for a non-template
    // statement.
    for (const table of tables) {
      await sql.query(`GRANT SELECT ON TABLE ${table} TO ${ROLE}`);
      console.log(`  GRANT SELECT ON ${table}: ok`);
    }

    const rows = (await sql`
      SELECT table_name, privilege_type FROM information_schema.role_table_grants
      WHERE grantee = ${ROLE} AND table_name = ANY(${tables})
      ORDER BY table_name, privilege_type
    `) as unknown as Array<{ table_name: string; privilege_type: string }>;

    /**
     * Count the tables that carry SELECT, not the privilege rows.
     *
     * This compared `rows.length` against the table count, which is only the
     * same number while every table has exactly one grant. `handle_conflicts`
     * carries INSERT and UPDATE as well, granted elsewhere for the conflict
     * queue, so the query returned three rows for it and the script exited 1
     * reporting failure on a run where every grant had in fact been made. The
     * GRANTs autocommit before this check, so the effect was purely to teach
     * whoever ran it that the red line at the end means nothing.
     *
     * What the check is actually for is "every table in the list is now
     * readable by the role", and a table holding MORE than SELECT does not
     * violate that.
     */
    const withSelect = new Set(
      rows.filter((r) => r.privilege_type === 'SELECT').map((r) => r.table_name)
    );
    const missing = tables.filter((t) => !withSelect.has(t));
    if (missing.length > 0) {
      console.error(`  no SELECT grant for: ${missing.join(', ')}`);
      failures++;
      continue;
    }
    console.log(`  all ${tables.length} tables readable by ${ROLE}`);
  }

  if (failures > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
