/**
 * Re-measure the cross-collection match rate against our own social graph.
 *
 * The published 11.5% figure (9 Robinhood Chain collections, 14,773 holders,
 * 2026-08-12) was measured with live Neynar lookups only — it was explicitly a
 * *floor*, not a match rate. Since then the graph grew from ~5k rows to 4.7M
 * via the Farcaster protocol sweep, the ENS onchain harvest and the daily seed.
 *
 * This script answers a different and more useful question: what do we now
 * resolve **from our own database alone**, with zero external API calls at
 * measurement time? That is the number that matters for both the API product
 * and the cost story, and it is reproducible without burning provider credits.
 *
 * The original nine contract addresses were never recorded, so this rediscovers
 * the top Robinhood collections the same way the seed cron does (Blockscout,
 * ranked by holder count) and reports exactly which ones it measured.
 *
 * Usage: npx tsx --env-file=.env.local scripts/benchmark-match-rate.ts [count]
 */
import { inArray } from 'drizzle-orm';
import { getDb } from '../db';
import { socialGraph } from '../db/schema';
import { discoverNftCandidates } from '../lib/seed-collections';
import { getContractHolders } from '../lib/contract-holders';
import type { SupportedChain } from '../lib/chains';

const CHAIN = (process.argv[2] ?? 'robinhood') as SupportedChain;
const COLLECTION_COUNT = Number(process.argv[3] ?? 9);
const HOLDER_CAP = 10000;
const CHUNK = 1000;

interface Row {
  name: string;
  address: string;
  holders: number;
  farcaster: number;
  twitter: number;
  either: number;
  anyIdentity: number;
  fcReach: number;
}

/** Look the wallets up in our own graph, nothing else. */
async function measure(wallets: string[]) {
  const db = getDb();
  if (!db) throw new Error('DATABASE_URL required');

  let farcaster = 0;
  let twitter = 0;
  let either = 0;
  let anyIdentity = 0;
  let fcReach = 0;

  for (let i = 0; i < wallets.length; i += CHUNK) {
    const batch = wallets.slice(i, i + CHUNK);
    const rows = await db
      .select({
        farcaster: socialGraph.farcaster,
        twitterHandle: socialGraph.twitterHandle,
        ensName: socialGraph.ensName,
        lens: socialGraph.lens,
        github: socialGraph.github,
        fcFollowers: socialGraph.fcFollowers,
      })
      .from(socialGraph)
      .where(inArray(socialGraph.wallet, batch));

    for (const r of rows) {
      const hasFc = !!r.farcaster;
      const hasTw = !!r.twitterHandle;
      if (hasFc) {
        farcaster++;
        fcReach += r.fcFollowers ?? 0;
      }
      if (hasTw) twitter++;
      if (hasFc || hasTw) either++;
      if (hasFc || hasTw || r.ensName || r.lens || r.github) anyIdentity++;
    }
  }

  return { farcaster, twitter, either, anyIdentity, fcReach };
}

async function main() {
  console.log(`Discovering top ${CHAIN} collections…`);
  const candidates = await discoverNftCandidates(CHAIN);
  const picked = candidates.slice(0, COLLECTION_COUNT);
  console.log(
    `  ${candidates.length} discovered, measuring top ${picked.length}\n`
  );

  const results: Row[] = [];

  for (const c of picked) {
    process.stdout.write(`  ${c.label} … `);
    try {
      const held = await getContractHolders(c.address, CHAIN, HOLDER_CAP);
      // Normalize to match how social_graph stores wallets
      const wallets = [...new Set(held.wallets.map((w) => w.toLowerCase()))];
      if (wallets.length === 0) {
        console.log('SKIPPED (no holders returned)');
        continue;
      }
      const m = await measure(wallets);
      results.push({
        name: held.tokenName || c.label,
        address: c.address,
        holders: wallets.length,
        ...m,
      });
      console.log(
        `${wallets.length} holders, ${m.farcaster} FC (${((m.farcaster / wallets.length) * 100).toFixed(1)}%), ${m.either} either (${((m.either / wallets.length) * 100).toFixed(1)}%)`
      );
    } catch (err) {
      console.log(`SKIPPED (${(err as Error).message})`);
    }
  }

  if (results.length === 0) {
    console.error('\nNo collections measured.');
    process.exit(1);
  }

  const t = results.reduce(
    (a, r) => ({
      holders: a.holders + r.holders,
      farcaster: a.farcaster + r.farcaster,
      twitter: a.twitter + r.twitter,
      either: a.either + r.either,
      anyIdentity: a.anyIdentity + r.anyIdentity,
      fcReach: a.fcReach + r.fcReach,
    }),
    {
      holders: 0,
      farcaster: 0,
      twitter: 0,
      either: 0,
      anyIdentity: 0,
      fcReach: 0,
    }
  );

  const pct = (n: number) => `${((n / t.holders) * 100).toFixed(1)}%`;

  console.log(
    '\n| Collection | Holders | On Farcaster | Rate | With X | X-or-FC | Any identity | FC reach |'
  );
  console.log('|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    console.log(
      `| ${r.name} | ${r.holders.toLocaleString()} | ${r.farcaster} | ${((r.farcaster / r.holders) * 100).toFixed(1)}% | ${r.twitter} | ${((r.either / r.holders) * 100).toFixed(1)}% | ${((r.anyIdentity / r.holders) * 100).toFixed(1)}% | ${r.fcReach.toLocaleString()} |`
    );
  }
  console.log(
    `| **TOTAL** | **${t.holders.toLocaleString()}** | **${t.farcaster.toLocaleString()}** | **${pct(t.farcaster)}** | **${t.twitter.toLocaleString()}** | **${pct(t.either)}** | **${pct(t.anyIdentity)}** | **${t.fcReach.toLocaleString()}** |`
  );

  console.log(
    `\nMeasured ${results.length} collections, ${t.holders.toLocaleString()} unique holders`
  );
  console.log(
    'Source: our own social_graph only — zero external API calls at measurement time.'
  );
  console.log('Contracts measured:');
  for (const r of results) console.log(`  ${r.name}  ${r.address}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
