/**
 * Foreign keys on the two tables that record money.
 *
 * Usage: npx tsx --env-file=.env.local scripts/migrate-money-fks.ts
 *        (must be the OWNER DATABASE_URL)
 *
 * ## Why these two, and why now
 *
 * The database has six foreign keys and all six are in the auth/API cluster.
 * `credit_lots` (what somebody bought) and `credit_ledger` (what they spent) had
 * none, so nothing stopped a row pointing at a user that does not exist.
 *
 * They are the cheapest correctness gain available here: both columns are
 * already `uuid` and already `NOT NULL`, and both have zero violations across
 * 100 and 6 rows. Nothing is rewritten; `ADD CONSTRAINT` on a validated key
 * mutates the catalog and scans, and the scan is 106 rows against `users_pkey`.
 *
 * ## NO ACTION, deliberately, where the other four cascade
 *
 * The four existing keys to `users` are `ON DELETE CASCADE`. These two must not
 * be. A purchase record and a debit record have to outlive the account they
 * belong to. 22 user rows were deleted in the current stats window by something
 * outside this repo; had any of them held credit lots, cascade would have
 * removed the evidence of a payment as a side effect of an unrelated delete,
 * and nothing would have reported it.
 *
 * The consequence, stated plainly: **deleting a user who holds credit lots now
 * fails** rather than silently deleting their purchase history. That is the
 * intended behaviour. A failed delete is a safe failure; a silent one is not.
 * Deleting such an account becomes a two-step operation.
 *
 * ## The direct endpoint, not the pooler
 *
 * `.env.local`'s `DATABASE_URL` is the pooler, and Neon's pooler keeps a bare
 * `SET` on a shared server backend across client connections: a migration that
 * ran `SET lock_timeout` through it could leave that timeout on a backend the
 * app then uses. This strips `-pooler` from the host and runs `SET LOCAL` inside
 * an explicit transaction on one client, so nothing outlives the transaction.
 *
 * ## Rollback
 *
 * ALTER TABLE credit_lots   DROP CONSTRAINT credit_lots_user_id_users_id_fk;
 * ALTER TABLE credit_ledger DROP CONSTRAINT credit_ledger_user_id_users_id_fk;
 *
 * Instant, and the heap is never touched. If the ALTER cannot take its lock
 * within `lock_timeout` it aborts and nothing changed.
 */
import { Pool } from '@neondatabase/serverless';

interface Fk {
  name: string;
  table: string;
  column: string;
}

const FKS: Fk[] = [
  {
    name: 'credit_lots_user_id_users_id_fk',
    table: 'credit_lots',
    column: 'user_id',
  },
  {
    name: 'credit_ledger_user_id_users_id_fk',
    table: 'credit_ledger',
    column: 'user_id',
  },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required (must be the owner role)');
    process.exit(1);
  }

  // See the header: DDL never goes through the pooler.
  const direct = url.replace('-pooler.', '.');
  if (direct !== url) {
    console.log(
      'DATABASE_URL is the pooler; using the direct endpoint for DDL'
    );
  }

  const pool = new Pool({ connectionString: direct });
  const client = await pool.connect();

  try {
    const who = await client.query('SELECT current_user');
    console.log(`connected as ${who.rows[0].current_user}\n`);

    /**
     * Refuse rather than fail halfway.
     *
     * `ADD CONSTRAINT` would abort on a violation anyway, but it would do so
     * with Postgres's message about one offending row, and the useful number is
     * how many there are. Counting first turns "it broke" into "there are N of
     * these, go and look at them".
     */
    for (const fk of FKS) {
      const { rows } = await client.query(
        `SELECT count(*)::int AS n FROM ${fk.table} t
         WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = t.${fk.column})`
      );
      const orphans = rows[0].n;
      if (orphans > 0) {
        console.error(
          `${fk.table}.${fk.column}: ${orphans} row(s) point at a user that does not exist.\n` +
            'Refusing to add the constraint. Investigate those rows first: they are\n' +
            'payment or debit records with no account, which is a data question, not\n' +
            'a schema one.'
        );
        process.exit(1);
      }
      console.log(`  ${fk.table}.${fk.column}: 0 orphans`);
    }

    console.log();

    for (const fk of FKS) {
      const exists = await client.query(
        `SELECT 1 FROM pg_constraint WHERE conname = $1 AND conrelid = $2::regclass`,
        [fk.name, fk.table]
      );
      if (exists.rowCount) {
        console.log(`  ${fk.name}: already present, skipping`);
        continue;
      }

      // SET LOCAL, inside the transaction, so it cannot outlive it.
      await client.query('BEGIN');
      try {
        await client.query("SET LOCAL lock_timeout = '3s'");
        await client.query(
          `ALTER TABLE ${fk.table}
             ADD CONSTRAINT ${fk.name}
             FOREIGN KEY (${fk.column}) REFERENCES users(id)`
        );
        await client.query('COMMIT');
        console.log(`  ${fk.name}: added`);
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
    }

    // Verify against the catalog rather than trusting the statements above.
    const { rows: found } = await client.query(
      `SELECT conname, confdeltype FROM pg_constraint
       WHERE conname = ANY($1) AND contype = 'f'`,
      [FKS.map((f) => f.name)]
    );
    console.log('\nverified:');
    for (const r of found) {
      // 'a' is NO ACTION, which is what the header argues for.
      console.log(
        `  ${r.conname}  on delete ${r.confdeltype === 'a' ? 'NO ACTION' : r.confdeltype}`
      );
    }
    if (found.length !== FKS.length) {
      console.error(
        `expected ${FKS.length} constraints, found ${found.length}`
      );
      process.exit(1);
    }
    console.log(`\nall ${FKS.length} money foreign keys in place`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
