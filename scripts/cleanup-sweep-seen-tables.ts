/**
 * Drop the scratch tables left behind by incomplete full sweeps.
 *
 * Usage: npx tsx --env-file=.env.local scripts/cleanup-sweep-seen-tables.ts
 *        npx tsx --env-file=.env.local scripts/cleanup-sweep-seen-tables.ts --apply
 *
 * Dry run by default. Nothing is dropped without `--apply`.
 *
 * ## What these tables are
 *
 * A full sweep only upserts wallets CURRENTLY attached to a FID, so a wallet
 * whose verification was removed would keep its stale mapping forever. To catch
 * that, `beginSeenTracking()` creates `farcaster_sweep_seen_<epoch_ms>` and
 * records every wallet the run sees; afterwards, pure-sweep rows absent from it
 * are cleared as revoked.
 *
 * The name carries a timestamp so a scheduled run and a manual one can never
 * truncate each other's set. On a clean, complete sweep the table is dropped at
 * the end of `cleanupRevokedWallets`. On an incomplete one it is deliberately
 * KEPT: `scripts/farcaster-sweep.ts` logs "seen table <name> kept", because a
 * partial seen set is evidence, and because clearing on a partial sweep would
 * treat every FID the run never reached as revoked.
 *
 * ## Why they need collecting
 *
 * Kept is not the same as useful. Cleanup can only ever run against the table
 * the same process just created, and only when the sweep covered its whole
 * range, so a retained table from a previous run is unreachable by design: no
 * code path can consume it. It is forensic material with no expiry, and each
 * budget-stopped sweep leaves another one.
 *
 * The first was `farcaster_sweep_seen_1786631580832`, 3,676,509 rows and 580 MB
 * (18% of the database) from a sweep that started 2026-08-13 14:33 UTC and hit
 * the Neynar credit ceiling ~6.5 hours in.
 *
 * ## Why an age threshold rather than a running-sweep check
 *
 * A sweep in flight owns its table and must not lose it. `pg_stat_activity`
 * would only see a sweep connected to this database at this instant, and the
 * job runs for up to 350 minutes across many connections, so it is the wrong
 * signal. Age is the right one: the table name IS the run's start time, the
 * workflow's own timeout bounds a run at under six hours, and its `concurrency`
 * group means only one runs at a time. A table whose name is more than
 * `MIN_AGE_HOURS` old cannot belong to a live run.
 *
 * ## Ownership
 *
 * These are created by whichever role ran the sweep, which in CI is
 * `sweep_runner`, so `neondb_owner` does not own them.
 *
 * It can still drop them, and NOT by assuming the role: the membership is
 * `set=false, inherit=false, admin=true`, so `SET ROLE sweep_runner` is refused
 * with 42501. What works is a plain `DROP`, because `neondb_owner` inherits
 * `neon_superuser` (`set=true, inherit=true`), and that is enough. Probed
 * against production inside a transaction that rolled back, rather than
 * reasoned about: `SET ROLE neon_superuser` then dropping also fails, with
 * "must be owner of table", because assuming a role discards the inherited
 * privileges that made it possible.
 *
 * So: no `SET ROLE`, and no `GRANT ... WITH SET TRUE` to widen anything. The
 * simplest statement is the one with the privileges.
 */
import { Pool } from '@neondatabase/serverless';

/**
 * Comfortably past the workflow's 350-minute timeout. A table younger than this
 * may belong to a sweep that is still running.
 */
const MIN_AGE_HOURS = 24;

/** Digits only, anchored: this is interpolated as an identifier. */
const SEEN_TABLE_RE = /^farcaster_sweep_seen_(\d+)$/;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required (must be the owner role)');
    process.exit(1);
  }
  const apply = process.argv.includes('--apply');

  // DDL never goes through the pooler: a bare SET there outlives the client.
  const pool = new Pool({ connectionString: url.replace('-pooler.', '.') });
  const client = await pool.connect();

  try {
    const { rows } = await client.query(`
      SELECT c.relname,
             pg_total_relation_size(c.oid) AS bytes,
             pg_size_pretty(pg_total_relation_size(c.oid)) AS size,
             pg_get_userbyid(c.relowner) AS owner
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND c.relname ~ '^farcaster_sweep_seen_[0-9]+$'
      ORDER BY c.relname
    `);

    if (rows.length === 0) {
      console.log('No timestamped sweep-seen tables. Nothing to collect.');
      return;
    }

    /**
     * No checkpoint exclusion, because a checkpoint no longer names a table.
     *
     * An earlier draft carried the seen table across resumed segments, so this
     * had to skip whichever one the checkpoint pointed at. That design was
     * withdrawn: accumulating the table across months let a final segment that
     * silently returned nothing pass cleanup's integrity guards on an earlier
     * segment's rows. A resume now never tracks, and a budget-stopped `--full`
     * drops its own table on the way out, so everything this collector finds is
     * genuinely abandoned.
     */
    const now = Date.now();
    let reclaimable = 0;
    const doomed: { name: string; owner: string; size: string }[] = [];

    for (const r of rows) {
      const m = SEEN_TABLE_RE.exec(r.relname);
      // The query pattern already guarantees this, but the value is about to be
      // interpolated into DDL, so it is re-checked here rather than assumed.
      if (!m) continue;
      const ageHours = (now - Number(m[1])) / 3_600_000;
      const [{ count }] = (
        await client.query(`SELECT count(*)::int AS count FROM ${r.relname}`)
      ).rows;

      if (ageHours < MIN_AGE_HOURS) {
        console.log(
          `  keep  ${r.relname}  ${r.size}  ${count.toLocaleString()} rows  ` +
            `(${ageHours.toFixed(1)}h old, under the ${MIN_AGE_HOURS}h floor: a sweep may still own it)`
        );
        continue;
      }
      console.log(
        `  drop  ${r.relname}  ${r.size}  ${count.toLocaleString()} rows  ` +
          `(${(ageHours / 24).toFixed(1)} days old, owner ${r.owner})`
      );
      reclaimable += Number(r.bytes);
      doomed.push({ name: r.relname, owner: r.owner, size: r.size });
    }

    if (doomed.length === 0) {
      console.log('\nNothing old enough to collect.');
      return;
    }

    console.log(
      `\n${doomed.length} table(s), ${(reclaimable / 1024 ** 3).toFixed(2)} GB`
    );

    if (!apply) {
      console.log('\nDry run. Re-run with --apply to drop them.');
      return;
    }

    for (const t of doomed) {
      // No SET ROLE: see the header. The inherited neon_superuser privileges
      // are what allow this, and assuming a role would discard them.
      await client.query(`DROP TABLE IF EXISTS ${t.name}`);
      console.log(`  dropped ${t.name} (${t.size}, owner was ${t.owner})`);
    }

    const { rows: after } = await client.query(
      `SELECT count(*)::int AS n FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname='public' AND c.relkind='r'
         AND c.relname = ANY($1)`,
      [doomed.map((d) => d.name)]
    );
    if (after[0].n !== 0) {
      console.error(`${after[0].n} table(s) still present after the drop`);
      process.exit(1);
    }
    const { rows: sz } = await client.query(
      `SELECT pg_size_pretty(pg_database_size(current_database())) AS s`
    );
    console.log(`\nall dropped. database is now ${sz[0].s}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
