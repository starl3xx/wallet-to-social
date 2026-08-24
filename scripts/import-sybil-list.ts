/**
 * Uniswap Sybil list import.
 *
 * Sybil was Uniswap's governance-delegate verification: the delegate signed
 * their address, posted the signature in a tweet from their own account, and
 * the Sybil verifier checked both before adding the pair to a public JSON
 * file on GitHub. Both halves owner-established, so it is an attested-link
 * peer. The project is deprecated, which makes the corpus frozen, complete,
 * and free: 2,783 wallet-to-handle pairs (checked 2026-08-22), many of them
 * DAO delegates a campaign would actually want to reach.
 *
 * One fetch, one ingest, idempotent; no checkpoint. The shared ingest
 * (lib/attested-links.ts) owns the fill-only rules, the agreement gate,
 * conflict recording, and the quality contract.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/import-sybil-list.ts             # dry run
 *   npx tsx --env-file=.env.local scripts/import-sybil-list.ts --commit
 */

import {
  ingestLinks,
  dedupeByWallet,
  classifyLinks,
  type AttestedLink,
  type LinkSource,
} from '../lib/attested-links';

const SOURCE: LinkSource = {
  id: 'sybil_list',
  /** twitter(20) + sybil_list(25) in `calculateQualityScore`. */
  quality: 45,
};

const VERIFIED_JSON =
  'https://raw.githubusercontent.com/Uniswap/sybil-list/master/verified.json';

interface SybilEntry {
  twitter?: { timestamp: number; tweetID: string; handle: string };
}

async function main() {
  const commit = process.argv.includes('--commit');
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const res = await fetch(VERIFIED_JSON);
  if (!res.ok) {
    throw new Error(`Sybil list fetch failed: ${res.status}`);
  }
  const entries = (await res.json()) as Record<string, SybilEntry>;

  const links: AttestedLink[] = [];
  let noTwitter = 0;
  for (const [wallet, entry] of Object.entries(entries)) {
    if (!entry.twitter?.handle) {
      noTwitter++;
      continue;
    }
    links.push({ wallet, handle: entry.twitter.handle });
  }
  console.log(
    `${commit ? 'COMMIT' : 'dry run'}: ${Object.keys(entries).length} entries, ` +
      `${links.length} with a handle, ${noTwitter} without`
  );

  if (commit) {
    const stats = await ingestLinks(links, SOURCE);
    console.log('Done:', JSON.stringify(stats, null, 2));
  } else {
    const { links: deduped, contested, rejected } = dedupeByWallet(links);
    const counts = await classifyLinks(deduped);
    console.log(
      'Would ingest:',
      JSON.stringify(
        { links: deduped.length, contested, rejected, ...counts },
        null,
        2
      )
    );
    console.log('\nDry run: nothing written. Re-run with --commit.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
