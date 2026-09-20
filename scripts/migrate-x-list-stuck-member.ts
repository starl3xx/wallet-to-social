/**
 * Two columns that let a list step over one member X will not accept.
 *
 * Usage: npx tsx scripts/migrate-x-list-stuck-member.ts
 * (DATABASE_URL must be the owner role, on the direct endpoint, not the
 * pooler. Run BEFORE deploying the worker that reads these columns.)
 *
 * ## The defect these exist for
 *
 * Measured on a live job on 2026-09-20. A list of 290 stopped at 103 and sat
 * there. The cursor is `added_count + skipped_count + failed_count`, and a
 * transient failure deliberately breaks the batch WITHOUT advancing it, so
 * that a network blip cannot silently drop somebody from the list. Member 103
 * was an account X refused every single time. Every tick retried the same
 * account, failed, added nothing, and left the cursor where it was. The job
 * would have been marked `failed` after twenty such ticks, abandoning the 187
 * members behind the blockage.
 *
 * The existing counter cannot tell those two situations apart. "Twenty ticks
 * in a row added nothing" is true both when X is down and when exactly one
 * member is unacceptable, and the right response is opposite in each case:
 * wait in the first, step over in the second.
 *
 * ## Why a cursor and not just a counter
 *
 * `stuck_cursor` records WHERE the attempts are accumulating. Without it a
 * counter cannot distinguish "failed three times at member 103" from "failed
 * once each at members 103, 104 and 105", and only the first is evidence
 * about a member rather than about the service.
 *
 * It is nullable on purpose: NULL means no position is currently under
 * suspicion, which is the state after any successful add and the state every
 * existing row starts in.
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

  console.log('x_list_jobs: stuck_cursor, member_attempts');

  await sql`
    ALTER TABLE x_list_jobs
    ADD COLUMN IF NOT EXISTS stuck_cursor INTEGER
  `;
  await sql`
    ALTER TABLE x_list_jobs
    ADD COLUMN IF NOT EXISTS member_attempts INTEGER NOT NULL DEFAULT 0
  `;

  /**
   * Verification, as every migration in this directory ends with: the script
   * exits non-zero if the objects it claims to have made are not there, so a
   * silent partial run cannot be mistaken for a success.
   */
  const present = (await sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'x_list_jobs'
      AND column_name IN ('stuck_cursor', 'member_attempts')
    ORDER BY column_name
  `) as unknown as Array<{ column_name: string }>;

  const names = present.map((r) => r.column_name);
  const missing = ['member_attempts', 'stuck_cursor'].filter(
    (c) => !names.includes(c)
  );

  if (missing.length > 0) {
    console.error(`FAILED: missing column(s): ${missing.join(', ')}`);
    process.exit(1);
  }

  console.log(`  verified: ${names.join(', ')}`);
  console.log('done');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
