/**
 * The role the Unstoppable Domains harvest agents on Jake's Mac connect as.
 *
 * Created 2026-09-23, when the harvest moved off GitHub Actions (the UD
 * profile endpoint refuses runner IPs; see scripts/ops/ud-harvest-local.sh).
 * The workflows had used sweep_runner, but its password lives only in the
 * GitHub secret, which cannot be read back, and resetting it would break every
 * scheduled workflow that shares that secret. A laptop also should not hold
 * sweep_runner's reach: it reads credit ledgers, OAuth grants and growth data,
 * deletes from social_graph and creates tables, none of which the UD harvest
 * needs.
 *
 * So ud_harvester holds exactly what the attested-link ingest touches:
 * SELECT, INSERT and UPDATE on social_graph, handle_conflicts and
 * ingest_state, and USAGE on the schema. No DELETE, no CREATE, nothing else.
 * The suppression guard triggers on social_graph and handle_conflicts are
 * SECURITY DEFINER (scripts/migrate-suppression.ts), so the role needs no read
 * on suppressed_identifiers for its writes to be checked.
 *
 * If the harvest starts touching another table, grant it here and re-run.
 *
 * Run with the OWNER connection. The password is generated here and written
 * straight into the agents' env file, never printed:
 *   npx tsx --env-file=.env.local scripts/migrate-create-ud-harvester.ts
 *   npx tsx --env-file=.env.local scripts/migrate-create-ud-harvester.ts --rotate-password
 *
 * Idempotent: an existing role keeps its password unless --rotate-password is
 * given, and the grants are re-applied and verified every run. Rotate only
 * while no harvest is running: a run in progress read the old password at
 * start, and its next query would be refused.
 */

import { neon } from '@neondatabase/serverless';
import { randomBytes } from 'node:crypto';
import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname } from 'node:path';

const ROLE = 'ud_harvester';
const TABLES = ['social_graph', 'handle_conflicts', 'ingest_state'];
const PRIVILEGES = ['INSERT', 'SELECT', 'UPDATE'];
const ENV_FILE =
  process.env.UD_HARVEST_ENV ??
  `${homedir()}/.config/walletlink/ud-harvest.env`;

/**
 * Makes sure the env file can be written BEFORE the role's password changes.
 * The password is generated here and never printed, so a write that fails
 * after CREATE/ALTER ROLE would leave the only copy nowhere.
 */
function prepareEnvFile() {
  mkdirSync(dirname(ENV_FILE), { recursive: true, mode: 0o700 });
  if (existsSync(ENV_FILE)) accessSync(ENV_FILE, constants.W_OK);
  else writeFileSync(ENV_FILE, '', { mode: 0o600 });
}

function savePassword(ownerUrl: string, password: string) {
  const url = new URL(ownerUrl);
  url.username = ROLE;
  url.password = password;
  const line = `DATABASE_URL=${url.toString()}`;
  const env = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf8') : '';
  const next = /^DATABASE_URL=.*$/m.test(env)
    ? env.replace(/^DATABASE_URL=.*$/m, line)
    : `${env}${env && !env.endsWith('\n') ? '\n' : ''}${line}\n`;
  writeFileSync(ENV_FILE, next, { mode: 0o600 });
  chmodSync(ENV_FILE, 0o600); // the mode option applies only on creation
  console.log(`wrote the ${ROLE} DATABASE_URL to ${ENV_FILE}`);
}

async function main() {
  const ownerUrl = process.env.DATABASE_URL;
  if (!ownerUrl) {
    console.error('DATABASE_URL is required (the owner connection)');
    process.exit(1);
  }
  const rotate = process.argv.includes('--rotate-password');
  const sql = neon(ownerUrl);

  const who = await sql`SELECT current_user`;
  console.log(`Connected as ${who[0].current_user}`);

  const exists =
    (await sql`SELECT 1 FROM pg_roles WHERE rolname = ${ROLE}`).length > 0;
  if (!exists || rotate) {
    prepareEnvFile();
    // base64url is [A-Za-z0-9_-], so it needs no quoting in SQL or a URL.
    const password = randomBytes(32).toString('base64url');
    const verb = exists ? 'ALTER' : 'CREATE';
    await sql.query(
      `${verb} ROLE ${ROLE} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '${password}'`
    );
    console.log(`${exists ? 'rotated the password of' : 'created'} ${ROLE}`);
    // Saved before anything else can fail: a password that changed but was
    // not written down would lock the agents out.
    try {
      savePassword(ownerUrl, password);
    } catch (err) {
      console.error(
        `\nThe ${ROLE} password changed but could not be written to ${ENV_FILE}.` +
          ' Fix the path, then re-run with --rotate-password.'
      );
      throw err;
    }
  } else {
    console.log(`${ROLE} exists; password unchanged`);
  }

  await sql.query(`GRANT USAGE ON SCHEMA public TO ${ROLE}`);
  for (const t of TABLES) {
    await sql.query(`GRANT ${PRIVILEGES.join(', ')} ON ${t} TO ${ROLE}`);
  }

  const check = await sql`
    SELECT table_name, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privs
    FROM information_schema.role_table_grants
    WHERE grantee = ${ROLE} AND table_schema = 'public'
    GROUP BY table_name ORDER BY table_name`;
  console.log('\nVerified grants for', ROLE);
  for (const row of check) console.log(`  ${row.table_name}: ${row.privs}`);
  const want = PRIVILEGES.join(',');
  const wrong = check.filter(
    (r) => !TABLES.includes(r.table_name as string) || r.privs !== want
  );
  const missing = TABLES.filter((t) => !check.some((r) => r.table_name === t));
  if (wrong.length || missing.length) {
    console.error(
      `\nGrants differ from the intended set: extra or wrong on [${wrong
        .map((r) => r.table_name)
        .join(', ')}], missing on [${missing.join(', ')}]`
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
