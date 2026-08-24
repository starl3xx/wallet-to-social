/**
 * Read-only: how big are the lists people actually bring?
 * Usage: npx tsx --env-file=.env.local scripts/size-distribution.ts
 */
import { neon } from '@neondatabase/serverless';
async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  console.log('--- every lookup of 250+ wallets, ever ---');
  console.table(
    await sql`
    SELECT wallet_count, to_char(created_at,'YYYY-MM-DD') AS day, input_source
    FROM lookup_history WHERE wallet_count >= 250 ORDER BY wallet_count DESC
  `
  );
  console.log('--- how many lookups fall under each candidate ceiling ---');
  console.table(
    await sql`
    SELECT count(*) AS total,
           count(*) FILTER (WHERE wallet_count <= 500)   AS under_500,
           count(*) FILTER (WHERE wallet_count <= 1000)  AS under_1000,
           count(*) FILTER (WHERE wallet_count <= 5000)  AS under_5000,
           count(*) FILTER (WHERE wallet_count <= 10000) AS under_10000,
           count(*) FILTER (WHERE wallet_count > 5000)   AS over_5000
    FROM lookup_history
  `
  );
}
main();
