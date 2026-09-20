/**
 * Reconstruct walk bookmarks for contracts seeded before resume_state existed.
 *
 * A success inside the novelty window with no bookmark is stuck: it is not
 * novel (30-day lockout) and not a continuation (nothing to resume), so its
 * walk cannot progress until the window expires, and then it restarts from
 * the top anyway. This applies to exactly the contracts seeded in the days
 * before the column landed. For each, the same slice is re-fetched from the
 * second index at the same cap, which lands the cursor where the original
 * seed's would have been (balance drift near the boundary repeats or skips a
 * few wallets; the wallet-keyed upserts absorb both), and the bookmark is
 * written as recordSeed would have written it.
 *
 * Read-only against the holder index, one UPDATE per row here. Idempotent:
 * rows that already carry a bookmark are never touched. DML only, so the
 * pooler URL is fine:
 *   npx tsx --env-file=.env.local scripts/backfill-seed-resume.ts
 */

import { neon } from '@neondatabase/serverless';
import {
  getContractHolders,
  hasSecondHolderIndex,
  type SupportedChain,
} from '../lib/contract-holders';

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const sql = neon(process.env.DATABASE_URL);

  const rows = (await sql`
    SELECT address, chain, name, holders_imported, total_holders
    FROM seeded_contracts
    WHERE contract_type = 'ERC-20'
      AND holders_imported > 0
      AND resume_state IS NULL
      AND total_holders > holders_imported
      AND last_seeded_at > now() - interval '30 days'
    ORDER BY last_seeded_at
  `) as Array<{
    address: string;
    chain: string;
    name: string;
    holders_imported: number;
    total_holders: number;
  }>;

  console.log(`${rows.length} bookmark-less walks inside the novelty window`);

  for (const row of rows) {
    const chain = row.chain as SupportedChain;
    if (!hasSecondHolderIndex(chain)) {
      console.log(`skip ${row.name} (${chain}): second index cannot serve it`);
      continue;
    }
    try {
      const holders = await getContractHolders(
        row.address,
        chain,
        row.holders_imported,
        { allowPublicFallback: false }
      );
      if (!holders.continuation) {
        console.log(
          `skip ${row.name} (${chain}): walk completes within the imported slice`
        );
        continue;
      }
      const state = JSON.stringify({
        source: holders.continuation.source,
        cursor: holders.continuation.cursor,
        walked: row.holders_imported,
      });
      // Guarded on resume_state still being NULL, so a concurrent seed that
      // wrote a real bookmark between our read and this write wins.
      await sql`
        UPDATE seeded_contracts
        SET resume_state = ${state}::jsonb
        WHERE address = ${row.address} AND chain = ${row.chain}
          AND resume_state IS NULL
      `;
      console.log(
        `bookmarked ${row.name} (${chain}) at ${row.holders_imported} of ${row.total_holders}`
      );
    } catch (error) {
      console.error(
        `failed ${row.name} (${chain}):`,
        error instanceof Error ? error.message : error
      );
    }
  }

  const check = await sql`
    SELECT count(*)::int AS n FROM seeded_contracts WHERE resume_state IS NOT NULL
  `;
  console.log(`${check[0].n} rows now carry a walk bookmark`);
}

main();
